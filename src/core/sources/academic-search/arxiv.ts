/** Per-source academic search handlers. */

import { ZSEARCH_HTTP_HEADERS } from "../../../utils/httpHeaders";

export async function searchArxiv(args: {
  query: string;
  maxResults?: number;
  author?: string;
  sort?: string;
}): Promise<any> {
  const maxResults = Math.min(args.maxResults ?? 10, 25);
  try {
    let searchQuery = args.query;
    if (args.author) {
      searchQuery += ` au:${args.author}`;
    }
    // UI 的 "published" 对应 arXiv 的提交日排序（audit P2-4：直传 token
    // 会落回 relevance 分支，published 恒失效）
    const sortParam =
      args.sort === "submittedDate" || args.sort === "published"
        ? "&sortBy=submittedDate&sortOrder=descending"
        : "&sortBy=relevance";
    const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(searchQuery)}&start=0&max_results=${maxResults}${sortParam}`;

    // request() rejects on non-2xx — read status from the exception
    let response: any;
    try {
      response = await Zotero.HTTP.request("GET", url, {
        headers: {
          Accept: "application/atom+xml",
          ...ZSEARCH_HTTP_HEADERS,
        },
        responseType: "text",
        timeout: 30000,
        errorDelayMax: 0,
      } as any);
    } catch (e: any) {
      const status = (e as any)?.status ?? 0; // UnexpectedStatusException.status
      return {
        success: false,
        error: `arXiv API error: ${status || e.message}`,
        total: 0,
        articles: [],
        source: "arxiv",
      };
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(response.responseText, "text/xml");
    const entries = doc.querySelectorAll("entry");

    const articles = Array.from<Element>(entries).map((entry) => {
      const title = (entry.querySelector("title")?.textContent || "")
        .replace(/\s+/g, " ")
        .trim();
      const authors = Array.from<Element>(
        entry.querySelectorAll("author > name"),
      )
        .map((el) => el.textContent?.trim() || "")
        .filter(Boolean)
        .join(", ");
      const abstract = (entry.querySelector("summary")?.textContent || "")
        .replace(/\s+/g, " ")
        .trim();
      const published = entry.querySelector("published")?.textContent || "";
      const year = published ? new Date(published).getFullYear() : "";
      const id = entry.querySelector("id")?.textContent || "";

      const pdfLink = entry.querySelector('link[title="pdf"]');
      const pdfUrl = pdfLink?.getAttribute("href") || "";

      const doiEl = entry.querySelector("doi");
      const doi = doiEl?.textContent || "";

      return {
        title,
        authors,
        year,
        abstract,
        doi,
        url: id || "",
        pdfUrl,
        citationCount: 0,
        source: "arxiv" as const,
        publicationType: "preprint",
      };
    });

    return {
      total: parseInt(
        doc.querySelector("opensearch:totalResults")?.textContent || "0",
        10,
      ),
      returned: articles.length,
      source: "arxiv",
      articles,
    };
  } catch (e: any) {
    return {
      success: false,
      error: `arXiv search failed: ${e.message}`,
      total: 0,
      articles: [],
      source: "arxiv",
    };
  }
}
