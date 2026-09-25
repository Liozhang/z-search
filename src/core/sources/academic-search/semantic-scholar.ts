/** Per-source academic search handlers. */

import { getPrefDynamic } from "../../../utils/prefs";

import { httpJsonGet } from "../../../utils/http";
import { type SearchFilters } from "./utils";

export async function searchSemanticScholar(
  query: string,
  year?: string,
  limit?: number,
  filters?: SearchFilters,
): Promise<any> {
  const maxResults = limit ?? 10;
  let searchQuery = query;
  if (filters?.author) {
    searchQuery = `author:${filters.author} ${query}`;
  }
  let url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(searchQuery)}&limit=${maxResults}&fields=paperId,title,authors,year,abstract,externalIds,citationCount,url,venue,journal,publicationTypes`;

  if (year) {
    url += `&year=${encodeURIComponent(year)}`;
  }

  const headers: Record<string, string> = {};
  const ssKey = getPrefDynamic("apis.semanticScholar.apiKey") as string;
  if (!ssKey) {
    return {
      success: false,
      error: "Semantic Scholar requires an API key. Set it in preferences.",
      total: 0,
      articles: [],
    };
  }
  headers["x-api-key"] = ssKey;

  const result = await httpJsonGet(url, headers);

  if (!result.ok && result.status === 429) {
    return {
      success: false,
      error:
        "Semantic Scholar rate limit reached. Add an API key in preferences for higher limits.",
      total: 0,
      articles: [],
    };
  }

  if (!result.ok) {
    return {
      success: false,
      error: `Semantic Scholar API error: ${result.status}`,
      total: 0,
      articles: [],
    };
  }

  const data = JSON.parse(result.body);
  const papers = data.data || [];

  const articles = papers.map((paper: any) => ({
    title: paper.title || "",
    authors: (paper.authors || []).map((a: any) => a.name).join(", "),
    year: paper.year,
    abstract: paper.abstract || "",
    doi: paper.externalIds?.DOI || "",
    citationCount: paper.citationCount ?? 0,
    url: paper.url || "",
    source: "semantic-scholar" as const,
    containerTitle: paper.venue || "",
    journalName: paper.journal?.name || paper.venue || undefined,
    issn: paper.journal?.issn || undefined,
    volume: paper.journal?.volume || undefined,
    pages: paper.journal?.pages || undefined,
    publicationType: paper.publicationTypes?.[0] || undefined,
  }));

  // S2 搜索端点不支持服务端排序（审计 P2-4）——按 UI 排序意图在结果集内
  // 客户端排序，兑现「引用最多 / 日期」的字面语义。
  if (filters?.sort === "cited") {
    articles.sort(
      (a: any, b: any) => (b.citationCount ?? 0) - (a.citationCount ?? 0),
    );
  } else if (filters?.sort === "published") {
    articles.sort((a: any, b: any) => (b.year ?? 0) - (a.year ?? 0));
  }

  return {
    total: data.total || articles.length,
    returned: articles.length,
    source: "semantic-scholar",
    articles,
  };
}
