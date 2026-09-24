/** Per-source academic search handlers. */

import { getPrefDynamic } from "../../../utils/prefs";
import { ZSEARCH_HTTP_HEADERS } from "../../../utils/httpHeaders";

export async function searchDimensions(args: {
  query: string;
  maxResults?: number;
}): Promise<any> {
  const maxResults = Math.min(args.maxResults ?? 10, 25);
  try {
    const apiKey = getPrefDynamic("apis.dimensions.apiKey") as string;
    if (!apiKey) {
      return {
        success: false,
        error: "Dimensions API requires an API key. Set it in preferences.",
        total: 0,
        articles: [],
        source: "dimensions",
      };
    }

    const dsl = JSON.stringify({
      type: "documents",
      include_fields: [
        "title",
        "authors",
        "year",
        "abstract",
        "doi",
        "link",
        "times_cited",
        "journal",
        "type",
      ],
      limit: maxResults,
      search_documents: args.query,
    });

    // request() rejects on non-2xx — read status from the exception
    let resp: any;
    try {
      resp = await Zotero.HTTP.request(
        "POST",
        "https://api.dimensions.ai/dsl/v2",
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
            ...ZSEARCH_HTTP_HEADERS,
          },
          body: dsl,
          timeout: 30000,
          errorDelayMax: 0,
        } as any,
      );
    } catch (e: any) {
      const status = (e as any)?.status ?? 0; // UnexpectedStatusException.status
      return {
        success: false,
        error: `Dimensions API error: ${status || e.message}`,
        total: 0,
        articles: [],
        source: "dimensions",
      };
    }

    const data = JSON.parse(resp.responseText ?? "");
    const docs = data.documents || [];

    const articles = docs.map((doc: any) => ({
      title: doc.title || "",
      authors: (doc.authors || [])
        .map((a: any) =>
          a.first_name ? `${a.first_name} ${a.last_name}` : a.full_name,
        )
        .filter(Boolean)
        .join(", "),
      year: doc.year || "",
      abstract: doc.abstract || "",
      doi: doc.doi || "",
      url: doc.link || "",
      citationCount: doc.times_cited ?? 0,
      source: "dimensions" as const,
      containerTitle: doc.journal?.title || undefined,
      journalName: doc.journal?.title || undefined,
      issn: doc.journal?.issn || undefined,
      volume: doc.journal?.volume || undefined,
      pages: doc.journal?.pages || undefined,
      publicationType: doc.type || undefined,
      publisher: doc.publisher || undefined,
    }));

    return {
      total: docs.length,
      returned: articles.length,
      source: "dimensions",
      articles,
    };
  } catch (e: any) {
    return {
      success: false,
      error: `Dimensions search failed: ${e.message}`,
      total: 0,
      articles: [],
      source: "dimensions",
    };
  }
}
