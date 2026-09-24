/**
 * Web Content Fetcher — fetch and clean full-text from URLs
 *
 * Extracted from paper-scorer.ts for SRP.
 */

import { ZSEARCH_HTTP_HEADERS } from "../../../utils/httpHeaders";
import { safeDebug } from "../../../utils/logger";

/** Metadata extracted from web pages */
export interface PageMetadata {
  ogTitle: string;
  publishedDate: string;
  author: string;
  description: string;
}

export interface FetchResult {
  text: string;
  metadata: PageMetadata;
}

/**
 * Pre-clean HTML before DOMParser (removes known pollution sources).
 * Ported from spider_article/src/parser/extractor.py _pre_clean_html.
 */
function preCleanHtml(html: string): string {
  html = html.replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, "");
  html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  html = html.replace(/\{\{[^}]*\}\}/g, "");
  html = html.replace(/\sdata-[a-zA-Z-]+="[^"]*"/g, "");
  return html;
}

/**
 * Extract structured metadata from HTML document.
 * Ported from spider_article/src/parser/extractor.py _extract_metadata.
 */
function extractPageMetadata(doc: Document): PageMetadata {
  const meta: PageMetadata = {
    ogTitle: "",
    publishedDate: "",
    author: "",
    description: "",
  };

  // og:title
  const ogTitle = doc.querySelector('meta[property="og:title"]');
  if (ogTitle?.getAttribute("content")) {
    meta.ogTitle = ogTitle.getAttribute("content")!.trim();
  }

  // Fallback: <title> with separator cleaning
  if (!meta.ogTitle) {
    const titleEl = doc.querySelector("title");
    if (titleEl?.textContent) {
      const raw = titleEl.textContent.trim();
      const separators = [" | ", " - ", " – ", " :: ", " — "];
      for (const sep of separators) {
        if (raw.includes(sep)) {
          const parts = raw.split(sep).map((s) => s.trim());
          meta.ogTitle = parts.reduce((a, b) => (a.length >= b.length ? a : b));
          break;
        }
      }
      if (!meta.ogTitle) meta.ogTitle = raw;
    }
  }

  // Publication date: try multiple selectors
  const dateSelectors = [
    'meta[name="article:published_time"]',
    'meta[property="article:published_time"]',
    'meta[name="pubdate"]',
    'meta[name="date"]',
  ];
  for (const sel of dateSelectors) {
    const el = doc.querySelector(sel);
    const content = el?.getAttribute("content");
    if (content) {
      meta.publishedDate = content.slice(0, 10);
      break;
    }
  }
  if (!meta.publishedDate) {
    const timeEl = doc.querySelector("time");
    const dt = timeEl?.getAttribute("datetime") || timeEl?.textContent;
    if (dt) meta.publishedDate = dt.slice(0, 10);
  }
  if (!meta.publishedDate) {
    const schemaEl = doc.querySelector('[itemprop="datePublished"]');
    const content =
      schemaEl?.getAttribute("content") || schemaEl?.getAttribute("datetime");
    if (content) meta.publishedDate = content.slice(0, 10);
  }

  // Author
  const authorEl = doc.querySelector('meta[name="author"]');
  if (authorEl?.getAttribute("content")) {
    meta.author = authorEl.getAttribute("content")!.trim();
  }

  // Description
  const descEl = doc.querySelector('meta[name="description"]');
  if (descEl?.getAttribute("content")) {
    meta.description = descEl.getAttribute("content")!.slice(0, 500);
  }

  return meta;
}

/**
 * Try to enhance metadata using Zotero's web translators.
 * Runs Translate.Web on the already-fetched document to extract
 * structured fields (title, author, date, abstract) more precisely than
 * OG/meta tag heuristics. Does not save anything to the library.
 */
async function extractTranslatorMetadata(
  doc: Document,
  url: string,
): Promise<Partial<PageMetadata> | null> {
  try {
    const wrappedDoc = (Zotero as any).HTTP.wrapDocument(doc, url);
    const translate = new (Zotero as any).Translate.Web();
    translate.setDocument(wrappedDoc);

    const translators = await translate.getTranslators();
    if (!translators || translators.length === 0) return null;

    translate.setTranslator(translators[0]);

    // Some translators present multiple items and require a select callback
    translate.setHandler(
      "select",
      (_trans: any, items: any[], callback: any) => {
        for (const i in items) {
          const obj: Record<string, any> = {};
          obj[i] = items[i];
          callback(obj);
          return;
        }
      },
    );

    const newItems: any[] = await translate.translate({
      libraryID: false,
      saveAttachments: false,
    });

    if (!newItems || newItems.length === 0) return null;

    const item = newItems[0];
    const meta: Partial<PageMetadata> = {};

    if (item.title) meta.ogTitle = item.title;
    if (item.date) meta.publishedDate = String(item.date).slice(0, 10);
    if (item.creators && item.creators.length > 0) {
      const c = item.creators[0];
      meta.author = [c.firstName, c.lastName].filter(Boolean).join(" ");
    }
    if (item.abstractNote) {
      meta.description = String(item.abstractNote).slice(0, 500);
    }

    return Object.keys(meta).length > 0 ? meta : null;
  } catch (e) {
    safeDebug("[z-search] web-content-fetcher: " + e);
    return null;
  }
}

/**
 * Find best content element using text density algorithm.
 * Replaces the "largest div" strategy for better accuracy on multi-column layouts.
 */
function findBestContent(doc: Document): Element | null {
  // Known content selectors (priority order)
  const knownSelectors = [
    "article",
    "main",
    '[role="main"]',
    ".post-content",
    ".article-body",
    ".entry-content",
    ".post-body",
    ".article-content",
    ".content-body",
  ];
  for (const sel of knownSelectors) {
    const el = doc.querySelector(sel);
    if (el && el.textContent && el.textContent.length > 200) return el;
  }

  // Text density algorithm: textContent length / innerHTML length
  let bestDensity = 0;
  let best: Element | null = null;
  const candidates = doc.querySelectorAll("div, section");
  for (let i = 0; i < Math.min(candidates.length, 200); i++) {
    const el = candidates[i];
    const text = (el.textContent || "").length;
    const html = (el.innerHTML || "").length;
    if (html < 500 || text < 200) continue;
    const density = text / html;
    if (density > bestDensity) {
      bestDensity = density;
      best = el;
    }
  }
  return best;
}

/**
 * Fetch full text from a URL using static HTTP + DOMParser extraction.
 * Reuses the core logic from academic-search.ts visitWebpage handler.
 */
export async function fetchFullText(url: string): Promise<string | null> {
  const result = await fetchFullTextWithMetadata(url);
  return result ? result.text : null;
}

/**
 * Fetch full text with metadata extraction.
 */
export async function fetchFullTextWithMetadata(
  url: string,
): Promise<FetchResult | null> {
  if (!url || !url.startsWith("http")) return null;

  try {
    const resp = await Zotero.HTTP.request("GET", url, {
      headers: {
        ...ZSEARCH_HTTP_HEADERS,
      },
      responseType: "text",
      timeout: 15000,
      errorDelayMax: 0,
    } as any);

    const html = resp.responseText || "";
    if (resp.status >= 400 || !html) return null;

    // Pre-truncate to avoid DOMParser choking on huge pages
    const truncatedHtml =
      html.length > 500_000 ? html.substring(0, 500_000) : html;

    // Pre-clean HTML before parsing
    const cleanedHtml = preCleanHtml(truncatedHtml);

    const parser = new DOMParser();
    const doc = parser.parseFromString(cleanedHtml, "text/html");

    const metadata = extractPageMetadata(doc);

    // Enhance metadata with Zotero web translator if available
    const translatorMeta = await extractTranslatorMetadata(doc, url);
    if (translatorMeta) {
      if (translatorMeta.ogTitle) metadata.ogTitle = translatorMeta.ogTitle;
      if (translatorMeta.publishedDate)
        metadata.publishedDate = translatorMeta.publishedDate;
      if (translatorMeta.author) metadata.author = translatorMeta.author;
      if (translatorMeta.description)
        metadata.description = translatorMeta.description;
    }

    const removeSelectors = [
      "script",
      "nav",
      "footer",
      "header",
      "aside",
      "iframe",
      "noscript",
      ".ad",
      ".sidebar",
      ".comment",
    ];
    for (const sel of removeSelectors) {
      doc.querySelectorAll(sel).forEach((el: Element) => el.remove());
    }

    const contentEl = findBestContent(doc);

    if (!contentEl) return null;

    let text = (contentEl.textContent || "").replace(/\s+/g, " ").trim();
    if (text.length < 100) return null;

    text = postCleanContent(text);
    if (isGarbageContent(text)) return null;

    // Cap at 50000 chars to prevent memory bloat from huge pages
    // Consumers (scoring, AI eval) further truncate internally
    if (text.length > 50_000) text = text.slice(0, 50_000);

    return { text, metadata };
  } catch (e) {
    safeDebug("[z-search] web-content-fetcher: " + e);
    return null;
  }
}

/**
 * Post-clean extracted text to remove residual noise.
 * Ported from academic content cleaning.
 */
function postCleanContent(text: string): string {
  // Remove CSS rule leakage (.cls-*, {fill:xxx}, @media, etc.)
  text = text.replace(/\.\w+-\d+\{[^}]*\}/g, "");
  text = text.replace(/\{[a-z-]+:[^}]*\}/g, "");
  text = text.replace(/@media[^{]*\{[^}]*\}/g, "");
  text = text.replace(/\.cls-\d+\{[^}]*\}/g, "");

  text = text.replace(/\{\{[^}]*\}\}/g, "");
  text = text.replace(/\{\{[^}]*$/gm, "");

  const lines = text.split(/\n/);
  const cleanedLines: string[] = [];
  for (const line of lines) {
    const stripped = line.trim();
    if (!stripped) {
      cleanedLines.push("");
      continue;
    }
    if (/^[.#@{};:()\s\dpxem%-]+$/.test(stripped)) {
      continue;
    }
    cleanedLines.push(line);
  }

  return cleanedLines
    .join("\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

/**
 * Detect whether content is garbage (CSS/JS-heavy, template variables).
 * Ported from academic content validation.
 */
function isGarbageContent(text: string): boolean {
  if (text.length < 100) return true;

  // CSS/JS code ratio too high (>30% non-natural-language characters)
  const codeChars = (text.match(/[{}();:@#.%<>[\]]/g) || []).length;
  const totalChars = text.length;
  if (totalChars > 0 && codeChars / totalChars > 0.3) return true;

  // Pure template variable content
  const templateCount = (text.match(/\{\{/g) || []).length;
  const wordCount = text.split(/\s+/).length;
  if (templateCount > 5 && templateCount > wordCount / 10) return true;

  return false;
}
