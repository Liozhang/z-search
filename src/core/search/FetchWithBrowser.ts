/**
 * fetch-with-browser — JS rendering via Zotero HiddenBrowser
 *
 * When static HTML extraction yields insufficient results (SPA pages),
 * uses Zotero's built-in HiddenBrowser API to load the page and execute
 * JavaScript, obtaining rendered content.
 *
 * Overall flow: static extraction → SPA detection → HiddenBrowser rendering → quality comparison → return best result
 * Any step failure transparently degrades to static results.
 */

import { truncate } from "../../utils/truncate";
import { sleep } from "../../utils/sleep";
import { Semaphore } from "../../utils/Semaphore";
import { safeDebug } from "../../utils/logger";

/** Global semaphore, max 2 concurrent browser instances */
const browserSemaphore = new Semaphore(2);

/** HiddenBrowser availability cache */
let _hiddenBrowserAvailable: boolean | null = null;

/**
 * Check if HiddenBrowser API is available.
 * Result is cached; import failure sets to false to prevent repeated attempts.
 */
function isHiddenBrowserAvailable(): boolean {
  if (_hiddenBrowserAvailable !== null) return _hiddenBrowserAvailable;
  try {
    const mod = ChromeUtils.importESModule(
      "chrome://zotero/content/HiddenBrowser.mjs",
    );
    _hiddenBrowserAvailable = typeof mod.HiddenBrowser === "function";
  } catch (e) {
    safeDebug("[z-search] isHiddenBrowserAvailable: " + e);
    _hiddenBrowserAvailable = false;
  }
  return _hiddenBrowserAvailable;
}

/** Overall timeout wrapper: limits the wall time of the entire operation */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  const timer = sleep(ms).then(() => null as T | null);
  return Promise.race([promise, timer]);
}

/**
 * SPA detection DOM snapshot data.
 * Extracted by the caller before removeSelectors cleanup to avoid reference alias bugs.
 */
export interface SpaCheckData {
  scriptCount: number;
  bodyChildCount: number;
  bodyTextLen: number;
  hasSpaRoot: boolean;
  hasNoscript: boolean;
  generatorMeta: string;
}

/**
 * SPA detection: determines whether static HTML extraction results are likely
 * from a page that requires JS rendering.
 *
 * @param html Raw HTML string
 * @param spaData DOM snapshot extracted before removeSelectors cleanup
 * @param extractedText Text content from static extraction
 * @returns Whether JS rendering is needed
 */
function needsJsRendering(
  html: string,
  spaData: SpaCheckData,
  extractedText: string,
): boolean {
  // Rule 1: Large HTML but very little extracted text
  const textLen = extractedText.replace(/\s+/g, "").length;
  if (html.length > 5000 && textLen < 50) return true;

  // Rule 2: Common SPA framework root nodes
  if (spaData.hasSpaRoot) return true;

  // Rule 3: <noscript> suggesting JavaScript is required
  if (spaData.hasNoscript) return true;

  // Rule 4: Many scripts but very little body content
  if (
    spaData.scriptCount > 3 &&
    spaData.bodyChildCount <= 2 &&
    spaData.bodyTextLen < 50
  )
    return true;

  // Rule 5: meta generator contains SPA framework identifiers
  if (/next\.js|nuxt|gatsby|create\s*react\s*app/.test(spaData.generatorMeta))
    return true;

  // Rule 6: Unnatural characters (code characters) ratio too high
  if (extractedText.length > 100) {
    const codeChars = (extractedText.match(/[{}()[\]=<>!&|+\-*/\\]/g) || [])
      .length;
    if (codeChars / extractedText.length > 0.3) return true;
  }

  // Rule 7: Too many unrendered template variables
  const templateVars = (extractedText.match(/\{\{[^}]*\}\}/g) || []).length;
  const wordCount = extractedText.split(/\s+/).length;
  if (templateVars > 3 && wordCount > 0 && templateVars > wordCount / 10)
    return true;

  return false;
}

/**
 * Text density algorithm: find the main content area from the DOM.
 *
 * @param doc DOM Document
 * @returns The element most likely to contain the body text
 */
function findBestContent(doc: Document): Element {
  // Prefer semantic tags
  const article = doc.querySelector("article");
  if (article && (article.textContent || "").length > 200) return article;

  const main = doc.querySelector("main");
  if (main && main !== article && (main.textContent || "").length > 200)
    return main;

  // Text density fallback: find the div/section with the highest text density
  let bestScore = 0;
  let bestEl: Element | null = null;
  const divs = doc.querySelectorAll("div, section");
  const scanLimit = Math.min(divs.length, 200);
  for (let i = 0; i < scanLimit; i++) {
    const el = divs[i];
    const textLen = (el.textContent || "").replace(/\s+/g, "").length;
    const htmlLen = (el.innerHTML || "").length;
    if (htmlLen < 500 || textLen < 200) continue;
    const density = textLen / htmlLen;
    const score = textLen * density;
    if (score > bestScore) {
      bestScore = score;
      bestEl = el;
    }
  }
  return bestEl || doc.body || doc.documentElement || doc.createElement("div");
}

/** fetchWithBrowser return result */
export interface BrowserFetchResult {
  url: string;
  title: string;
  text: string;
  wordCount: number;
  sections: string[];
}

/** Overall operation timeout (including load + wait + extract), prevents permanent semaphore occupation */
const TOTAL_TIMEOUT_MS = 20_000;

/**
 * Use HiddenBrowser to load and render a page, then extract text content.
 *
 * Lifecycle: acquire semaphore → create → load → wait → extract → destroy → release
 * finally guarantees destroy + release always execute.
 *
 * @param url Target URL
 * @param maxLength Maximum text length
 * @returns Rendered result, or null on failure or insufficient quality
 */
export async function fetchWithBrowser(
  url: string,
  maxLength: number,
): Promise<BrowserFetchResult | null> {
  // Availability check
  if (!isHiddenBrowserAvailable()) return null;

  const release = await browserSemaphore.acquire();

  let hiddenBrowser: any = null;

  try {
    // Dynamic import and create HiddenBrowser instance
    const mod = ChromeUtils.importESModule(
      "chrome://zotero/content/HiddenBrowser.mjs",
    );
    const HiddenBrowserClass = mod.HiddenBrowser;

    hiddenBrowser = new HiddenBrowserClass();

    // Entire load-extract flow under timeout protection
    const result = await withTimeout(
      (async () => {
        // load() already awaits _createdPromise internally, no manual wait needed
        const loaded = await hiddenBrowser.load(url);
        if (!loaded) return null;

        // Wait for document ready, allowing 2 seconds interaction buffer (instead of 5)
        await hiddenBrowser.waitForDocument({ allowInteractiveAfter: 2000 });

        // Short delay for SPA hydration to complete (simple strategy; future optimization: DOM stability detection)
        await sleep(2000);

        const pageData = await hiddenBrowser.getPageData([
          "title",
          "bodyText",
          "documentHTML",
        ]);

        let text: string;
        let title = pageData.title || "";
        const sections: string[] = [];

        // Prefer bodyText (already rendered plain text)
        const bodyText = (pageData.bodyText || "").replace(/\s+/g, " ").trim();
        if (bodyText.replace(/\s+/g, "").length >= 100) {
          text = bodyText;
        } else {
          // bodyText quality insufficient, manually extract from documentHTML
          const html = pageData.documentHTML || "";
          if (!html) return null;

          const truncatedHtml =
            html.length > 500_000 ? html.substring(0, 500_000) : html;
          const parser = new DOMParser();
          const doc = parser.parseFromString(truncatedHtml, "text/html");

          if (!title) {
            title = doc.querySelector("title")?.textContent?.trim() || "";
          }

          const removeSelectors = [
            "script",
            "style",
            "nav",
            "footer",
            "header",
            "aside",
            "iframe",
            "noscript",
            ".ad",
            ".advertisement",
            ".sidebar",
            ".comment",
            ".comments",
            "#comments",
          ];
          for (const sel of removeSelectors) {
            doc.querySelectorAll(sel).forEach((el: Element) => el.remove());
          }

          const source = findBestContent(doc);
          text = (source.textContent || "").replace(/\s+/g, " ").trim();

          source.querySelectorAll("h1, h2, h3").forEach((h: Element) => {
            const t = (h.textContent || "").trim();
            if (t.length > 0 && t.length < 200) sections.push(t);
          });
        }

        // Quality check
        if (text.replace(/\s+/g, "").length < 100) return null;

        // Truncate
        if (text.length > maxLength) {
          text = truncate(text, maxLength);
        }

        return { url, title, text, sections };
      })(),
      TOTAL_TIMEOUT_MS,
    );

    if (!result) return null;

    return {
      url: result.url,
      title: result.title,
      text: result.text,
      wordCount: result.text.split(/\s+/).length,
      sections: result.sections,
    };
  } catch (e) {
    safeDebug("[z-search] fetchWithBrowser(" + url + ") failed: " + e);
    // Mark as unavailable on import failure to prevent repeated attempts
    _hiddenBrowserAvailable = false;
    return null;
  } finally {
    if (hiddenBrowser) {
      try {
        hiddenBrowser.destroy();
      } catch (e) {
        safeDebug(
          "[z-search] fetchWithBrowser: hiddenBrowser.destroy failed: " + e,
        );
      }
    }
    release();
  }
}

export { needsJsRendering, isHiddenBrowserAvailable };
