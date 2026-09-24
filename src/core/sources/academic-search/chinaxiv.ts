/** Per-source academic search handlers. */

import { httpJsonGet } from "../../../utils/http";

export async function searchChinaxiv(args: {
  query: string;
  maxResults?: number;
}): Promise<any> {
  const maxResults = Math.min(args.maxResults ?? 10, 25);
  try {
    const url = `https://chinarxiv.org/api/v1/papers?query=${encodeURIComponent(args.query)}&source=chinaxiv&limit=${maxResults}`;

    const result = await httpJsonGet(url);

    if (!result.ok) {
      return {
        success: false,
        error: `ChinaXiv API error: ${result.status}`,
        total: 0,
        articles: [],
        source: "chinaxiv",
      };
    }

    const data = JSON.parse(result.body);
    const papers = data.data || [];

    const articles = papers.map((item: any) => {
      const authors = Array.isArray(item.authors)
        ? item.authors.filter(Boolean).join(", ")
        : "";

      const year = item.date ? item.date.split("-")[0] : "";

      return {
        title: item.title || "",
        authors,
        year,
        abstract: item.abstract || "",
        doi: "",
        url: item.source_url || "",
        pdfUrl: item.pdf_url || "",
        citationCount: 0,
        source: "chinaxiv" as const,
        publicationType: "preprint" as const,
        containerTitle: undefined,
        journalName: undefined,
      };
    });

    return {
      total: data.total || articles.length,
      returned: articles.length,
      source: "chinaxiv",
      articles,
    };
  } catch (e: any) {
    return {
      success: false,
      error: `ChinaXiv search failed: ${e.message}`,
      total: 0,
      articles: [],
      source: "chinaxiv",
    };
  }
}
