/** Per-source academic search handlers. */

import { getPrefDynamic } from "../../../utils/prefs";
import { ZSEARCH_HTTP_HEADERS } from "../../../utils/httpHeaders";

export async function searchCORE(args: {
  query: string;
  maxResults?: number;
}): Promise<any> {
  const maxResults = Math.min(args.maxResults ?? 10, 20);
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...ZSEARCH_HTTP_HEADERS,
  };
  const coreApiKey = getPrefDynamic("apis.core.apiKey") as string;
  if (!coreApiKey) {
    return {
      success: false,
      error: "CORE requires an API key. Set it in preferences.",
      total: 0,
      articles: [],
      source: "core",
    };
  }
  headers["Authorization"] = `Bearer ${coreApiKey}`;

  const url = `https://api.core.ac.uk/v3/search/works?q=${encodeURIComponent(args.query)}&limit=${maxResults}`;

  // Retry with exponential backoff for 5xx (CORE Elasticsearch is intermittently overloaded)
  const MAX_RETRIES = 2;
  const BASE_DELAY = 2000;
  let lastError = "";

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, BASE_DELAY * attempt));
      }

      // request() rejects on non-2xx — read status from the exception
      const response = await Zotero.HTTP.request("GET", url, {
        headers,
        timeout: 30000,
        errorDelayMax: 0,
      } as any);

      const data = JSON.parse(response.responseText ?? "");
      const results = data.results || [];

      const articles = results.map((item: any) => {
        const authors = (item.authors || [])
          .map(
            (a: any) => a.name || `${a.given || ""} ${a.family || ""}`.trim(),
          )
          .filter(Boolean)
          .join(", ");

        const journalName = item.journals?.[0]?.title || undefined;
        return {
          title: item.title || "",
          authors,
          year: item.yearPublished || item.publishedDate?.substring(0, 4) || "",
          abstract: item.description || item.abstract || "",
          doi: item.doi || "",
          url:
            item.sourceFulltextUrls?.[0] || item.downloadUrl || item.url || "",
          pdfUrl: item.downloadUrl || "",
          oaUrl: item.downloadUrl || item.sourceFulltextUrls?.[0] || "",
          citationCount: 0,
          source: "core" as const,
          containerTitle: journalName || undefined,
          journalName,
          publisher: item.publisher || undefined,
        };
      });

      return {
        total: data.totalCount || data.totalHits || results.length,
        returned: articles.length,
        source: "core",
        articles,
      };
    } catch (e: any) {
      lastError = e.message;
    }
  }

  // All retries exhausted
  return {
    success: false,
    error: `CORE search failed after retries: ${lastError}`,
    total: 0,
    articles: [],
    source: "core",
  };
}
