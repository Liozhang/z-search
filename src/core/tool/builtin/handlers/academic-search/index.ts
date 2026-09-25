/** Academic-search handlers — barrel re-export.
 *
 * Exports the same default object as the original single-file module so
 * consumers (registry.ts spread, SearchPipeline.ts method calls) do not need
 * to change their import paths.
 */

import { ZSEARCH_HTTP_HEADERS } from "../../../../../utils/httpHeaders";
import { toErrorMessage } from "../../../../../utils/error";
import MetadataExtractor from "../../../../metadata/MetadataExtractor";
import { normalizeDoi } from "../../../../search/literatureSearchHelpers";
import {
  detectIdentifierType,
  mergeArticleInfo,
  type IdentifierType,
  type SearchFilters,
} from "../../../../sources/academic-search/utils";
import {
  searchSemanticScholar,
  searchCrossRef,
  searchOpenAlex,
  searchArxiv,
  searchBiorxiv,
  searchMedrxiv,
  searchDoaj,
  searchZenodo,
  searchHal,
  searchCORE,
  searchEuropePMC,
  searchDimensions,
  searchPubMed,
  searchChinaxiv,
  searchGithub,
} from "../../../../sources/academic-search";
import { safeDebug } from "../../../../../utils/logger";

async function importArticle(args: {
  identifiers: string[];
  type?: IdentifierType;
  collectionId?: number;
}): Promise<any> {
  const results: any[] = [];

  for (const rawId of args.identifiers) {
    const id = rawId.trim();
    if (!id) {
      results.push({
        identifier: rawId,
        success: false,
        error: "Empty identifier",
      });
      continue;
    }

    try {
      // Determine type: explicit or auto-detect
      let type = args.type;
      if (!type) {
        type = detectIdentifierType(id);
      }

      let extractedId = id;
      if (type === "doi") {
        extractedId = id.replace(/^https?:\/\/doi\.org\//, "");
      } else if (type === "arxiv") {
        extractedId = id
          .replace(/^https?:\/\/arxiv\.org\/abs\//, "")
          .replace(/^https?:\/\/arxiv\.org\//, "");
      } else if (type === "isbn") {
        extractedId = id.replace(/[^0-9X]/gi, "");
      }

      // Title: search CrossRef first to find DOI
      if (type === "title") {
        const cxUrl = `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(id)}&rows=1&sort=relevance`;
        const cxResp = await Zotero.HTTP.request("GET", cxUrl, {
          headers: {
            Accept: "application/json",
            ...ZSEARCH_HTTP_HEADERS,
          },
          timeout: 15000,
          errorDelayMax: 0,
        } as any);
        const cxData = JSON.parse(cxResp.responseText ?? "");
        const cxItems = cxData.message?.items || [];
        if (cxItems.length === 0 || !cxItems[0].DOI) {
          results.push({
            identifier: id,
            success: false,
            error: `No DOI found for title: "${id}"`,
          });
          continue;
        }
        extractedId = cxItems[0].DOI;
        type = "doi";
      }

      const metadata = await MetadataExtractor.extract(type, extractedId);
      if (!metadata.success) {
        results.push({
          identifier: id,
          success: false,
          error: metadata.error || "Failed to extract metadata",
        });
        continue;
      }

      const itemId = await MetadataExtractor.createItemFromMetadata(
        metadata,
        args.collectionId,
      );
      if (!itemId) {
        results.push({
          identifier: id,
          success: false,
          error: "Failed to create item",
        });
        continue;
      }

      const item = Zotero.Items.get(itemId);
      results.push({
        success: true,
        itemId,
        title: item?.getField("title") || metadata.title || "",
        identifier: id,
        type,
        imported: true,
      });
    } catch (e: any) {
      results.push({ identifier: id, success: false, error: e.message });
    }
  }

  return {
    total: args.identifiers.length,
    succeeded: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    results,
  };
}

async function searchWeb(args: {
  query: string;
  provider?: string;
  maxResults?: number;
}): Promise<any> {
  try {
    const webSearch = (await import("../../../../search/WebSearchProvider"))
      .default;
    return webSearch.search(args);
  } catch (e: any) {
    return {
      success: false,
      error: toErrorMessage(e, "Web search failed"),
      returned: 0,
      source: args.provider || "unknown",
      results: [],
    };
  }
}

async function visitWebpage(args: {
  url: string;
  goal?: string;
  maxLength?: number;
}): Promise<any> {
  // When a research goal is provided, increase effective maxLength by 50% to capture more context
  const baseMaxLength = args.maxLength || 8000;
  const maxLength = args.goal ? Math.round(baseMaxLength * 1.5) : baseMaxLength;

  try {
    const resp = await Zotero.HTTP.request("GET", args.url, {
      headers: {
        ...ZSEARCH_HTTP_HEADERS,
      },
      responseType: "text",
      timeout: 30000,
      // Disable Zotero's built-in 5xx retry (up to 1 hour) — agent loop handles retries
      errorDelayMax: 0,
    } as any);

    const html = resp.responseText || "";
    if (!html) {
      return {
        success: false,
        url: args.url,
        error: `HTTP ${resp.status}: Failed to fetch page`,
        title: "",
        text: "",
        wordCount: 0,
        sections: [],
        pdfLinks: [],
      };
    }

    // Pre-truncate HTML to avoid DOMParser choke on huge pages (>500KB)
    const maxHtmlLen = 500_000;
    const truncatedHtml =
      html.length > maxHtmlLen ? html.substring(0, maxHtmlLen) : html;

    const parser = new DOMParser();
    const doc = parser.parseFromString(truncatedHtml, "text/html");
    const title = doc.querySelector("title")?.textContent?.trim() || "";

    // Scan PDF links before removeSelectors cleans up iframe/embed elements
    const pdfUrlSet = new Set<string>();
    const pdfSelectors = [
      { sel: 'a[href*="pdf" i]', attr: "href" },
      { sel: 'embed[src*="pdf" i]', attr: "src" },
      { sel: 'iframe[src*="pdf" i]', attr: "src" },
      { sel: 'source[src*="pdf" i]', attr: "src" },
    ];
    for (const { sel, attr } of pdfSelectors) {
      doc.querySelectorAll(sel).forEach((el: Element) => {
        const raw = el.getAttribute(attr);
        if (!raw) return;
        try {
          const absolute = new URL(raw, args.url).href;
          if (/ad[sx]?[/._-]|tracker|pixel|beacon|analytics/i.test(absolute))
            return;
          pdfUrlSet.add(absolute);
        } catch (e) {
          safeDebug("[z-search] index: " + e); /* skip invalid URLs */
        }
      });
    }
    const pdfLinks = [...pdfUrlSet].slice(0, 10);

    // Extract SPA detection data before removeSelectors cleans up the DOM
    // Don't save doc reference directly (reference alias gets modified by removeSelectors)
    const spaCheckData = {
      scriptCount: doc.querySelectorAll("script").length,
      bodyChildCount: doc.body?.children?.length ?? 0,
      bodyTextLen: (doc.body?.textContent || "").replace(/\s+/g, "").length,
      hasSpaRoot: !![
        "#__next",
        "#__nuxt",
        "#__sapper",
        "[data-reactroot]",
        "app-root",
        "[ng-version]",
      ].some((sel) => doc.querySelector(sel)),
      hasNoscript: (
        Array.from(doc.querySelectorAll("noscript")) as Element[]
      ).some((ns: Element) => {
        const c = (ns.textContent || "").toLowerCase();
        return c.includes("javascript") && c.includes("enable");
      }),
      generatorMeta: (
        doc.querySelector('meta[name="generator"]')?.getAttribute("content") ||
        ""
      ).toLowerCase(),
    };

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

    const candidates: Element[] = [];
    const article = doc.querySelector("article");
    const main = doc.querySelector("main");
    if (article) candidates.push(article);
    if (main && main !== article) candidates.push(main);

    if (candidates.length === 0) {
      // Fallback: find the div with most text content (limit scan to first 200)
      let maxLen = 0;
      let bestDiv: Element | null = null;
      const divs = doc.querySelectorAll("div, section");
      const scanLimit = Math.min(divs.length, 200);
      for (let i = 0; i < scanLimit; i++) {
        const len = (divs[i].textContent || "").length;
        if (len > maxLen) {
          maxLen = len;
          bestDiv = divs[i];
        }
      }
      if (bestDiv) candidates.push(bestDiv);
    }

    // If still nothing, use body
    const source = candidates[0] || doc.body;
    let text = (source.textContent || "").replace(/\s+/g, " ").trim();

    const sections: string[] = [];
    source.querySelectorAll("h1, h2, h3").forEach((h: Element) => {
      const t = (h.textContent || "").trim();
      if (t.length > 0 && t.length < 200) sections.push(t);
    });

    // Truncate
    if (text.length > maxLength) {
      text = text.substring(0, maxLength) + "...";
    }

    // SPA detection: if static extraction is insufficient, try JS rendering
    try {
      const { needsJsRendering, fetchWithBrowser } =
        await import("../../../../search/FetchWithBrowser");
      if (needsJsRendering(truncatedHtml, spaCheckData, text)) {
        const jsResult = await fetchWithBrowser(args.url, maxLength);
        // Only accept JS rendering if text volume is >= 1.5x static result
        if (jsResult && jsResult.text.length > text.length * 1.5) {
          return {
            url: args.url,
            title: jsResult.title || title,
            text: jsResult.text,
            wordCount: jsResult.wordCount,
            sections:
              jsResult.sections.length > 0 ? jsResult.sections : sections,
            pdfLinks,
            ...(args.goal ? { goal: args.goal } : {}),
          };
        }
      }
    } catch (e) {
      safeDebug(
        "[z-search] index: " + e,
      ); /* JS rendering failed, fall back to static result */
    }

    return {
      url: args.url,
      title,
      text,
      wordCount: text.split(/\s+/).length,
      sections,
      pdfLinks,
      ...(args.goal ? { goal: args.goal } : {}),
    };
  } catch (e: any) {
    return {
      success: false,
      url: args.url,
      error: toErrorMessage(e, "Failed to fetch page"),
      title: "",
      text: "",
      wordCount: 0,
      sections: [],
      pdfLinks: [],
    };
  }
}

/** source → 检索 API 调用器直查表（入参统一 (query, year, limit, filters)）。 */
const SEARCH_API_CALLERS: Readonly<
  Record<
    string,
    (
      query: string,
      year?: string,
      limit?: number,
      filters?: SearchFilters,
    ) => Promise<any>
  >
> = {
  openalex: (query, year, limit, filters) =>
    searchOpenAlex({
      query,
      year,
      maxResults: limit,
      author: filters?.author,
      journal: filters?.journal,
      sort: filters?.sort,
      reviewOnly: filters?.reviewOnly,
    }),
  "semantic-scholar": (query, year, limit, filters) =>
    searchSemanticScholar(query, year, limit, filters),
  crossref: (query, year, limit, filters) =>
    searchCrossRef(query, year, limit, filters),
  arxiv: (query, _year, limit, filters) =>
    searchArxiv({
      query,
      maxResults: limit,
      author: filters?.author,
      sort: filters?.sort,
    }),
  biorxiv: (query, _year, limit) => searchBiorxiv({ query, maxResults: limit }),
  medrxiv: (query, _year, limit) => searchMedrxiv({ query, maxResults: limit }),
  doaj: (query, _year, limit) => searchDoaj({ query, maxResults: limit }),
  zenodo: (query, _year, limit) => searchZenodo({ query, maxResults: limit }),
  hal: (query, _year, limit) => searchHal({ query, maxResults: limit }),
  core: (query, _year, limit) => searchCORE({ query, maxResults: limit }),
  "europe-pmc": (query, _year, limit, filters) =>
    searchEuropePMC({
      query,
      maxResults: limit,
      reviewOnly: filters?.reviewOnly,
    }),
  dimensions: (query, _year, limit) =>
    searchDimensions({ query, maxResults: limit }),
  pubmed: (query, year, limit, filters) =>
    searchPubMed({
      query,
      maxResults: limit,
      year,
      reviewOnly: filters?.reviewOnly,
    }),
  chinaxiv: (query, _year, limit, _filters) =>
    searchChinaxiv({ query, maxResults: limit }),
  github: (query, year, limit) => searchGithub(query, year, limit),
};

async function callSearchAPI(
  source: string,
  query: string,
  year?: string,
  limit?: number,
  filters?: SearchFilters,
): Promise<any> {
  const caller = SEARCH_API_CALLERS[source];
  if (!caller) return { articles: [] };
  return caller(query, year, limit, filters);
}

function deduplicateArticles(articles: any[]): any[] {
  const seen = new Map<string, any>();
  const out: any[] = [];

  for (const article of articles) {
    if (article.doi) {
      // DOI 归一化去重（审计 P1-7）：OpenAlex 主搜索回填 https://doi.org/
      // 全 URL，裸 toLowerCase 比较会让同文跨源各留一条，mergeArticleInfo
      // 全部失效。normalizeDoi 剥 URL/doi: 前缀。
      const key = normalizeDoi(article.doi) ?? article.doi.toLowerCase().trim();
      if (!seen.has(key)) {
        seen.set(key, article);
        out.push(article);
      } else {
        mergeArticleInfo(seen.get(key)!, article);
      }
      continue;
    }

    const titleKey = article.title.toLowerCase().replace(/[^a-z0-9]/g, "");
    // 短标题/CJK 标题（拉丁剥除后 <10 字符）不参与去重但**必须保留**
    // （审计 P1-4）：旧 continue 把 GitHub 短仓库名、纯中文标题的 DOAJ/HAL
    // 结果整条静默删除——与前端 externalArticleKey「保留不去重」的口径对齐。
    if (titleKey.length < 10) {
      out.push(article);
      continue;
    }
    if (!seen.has(titleKey)) {
      seen.set(titleKey, article);
      out.push(article);
    } else {
      mergeArticleInfo(seen.get(titleKey)!, article);
    }
  }

  return out;
}

const handlers = {
  // Per-source search handlers (re-exported for direct callers)
  searchSemanticScholar,
  searchCrossRef,
  searchOpenAlex,
  searchArxiv,
  searchBiorxiv,
  searchMedrxiv,
  searchDoaj,
  searchZenodo,
  searchHal,
  searchCORE,
  searchEuropePMC,
  searchDimensions,
  searchPubMed,
  searchChinaxiv,
  searchGithub,

  // Special operations
  importArticle,
  searchWeb,
  visitWebpage,

  // Unified dispatcher / aggregation
  callSearchAPI,
  deduplicateArticles,
  mergeArticleInfo,
};

export default handlers;
