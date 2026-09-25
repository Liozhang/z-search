import { type SearchFilters } from "./utils";
/** Per-source academic search handlers. */

import { httpJsonGet } from "../../../utils/http";
import { stripJatsXml } from "./utils";

export async function searchCrossRef(
  query: string,
  year?: string,
  limit?: number,
  filters?: SearchFilters,
): Promise<any> {
  const maxResults = limit ?? 10;

  const filterParts: string[] = [];
  if (year) {
    // 区间优先匹配：parseInt("2017-2026")=2017 会让区间分支永不可达，
    // 默认「近10年」被压成单下限年（2026-09-25 审计 P0-1）。
    const range = year.match(/^(\d{4})\s*-\s*(\d{4})$/);
    if (range) {
      filterParts.push(
        `from-pub-date:${range[1]}`,
        `until-pub-date:${range[2]}`,
      );
    } else {
      const yearNum = parseInt(year, 10);
      if (!isNaN(yearNum)) {
        filterParts.push(
          `from-pub-date:${yearNum}`,
          `until-pub-date:${yearNum}`,
        );
      }
    }
  }
  if (filters?.journal) {
    // filter 值必须编码：刊名含空格/逗号会拆坏逗号连接的 filter 串
    filterParts.push(`container-title:${encodeURIComponent(filters.journal)}`);
  }
  // Crossref 只认 relevance/published/is-referenced-by-count 等——UI 的
  // "cited" 直传会 HTTP 400，Crossref 源静默归零（2026-09-25 审计 P0-2）
  const SORT_MAP: Record<string, string> = {
    relevance: "relevance",
    published: "published",
    cited: "is-referenced-by-count",
  };
  const sort = SORT_MAP[filters?.sort || "relevance"] || "relevance";
  // review-article covers literature/systematic reviews.
  if (filters?.reviewOnly) {
    filterParts.push(`type:review-article`);
  }

  let url = `https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=${maxResults}&sort=${sort}`;

  if (filterParts.length > 0) {
    url += `&filter=${filterParts.join(",")}`;
  }
  if (filters?.author) {
    url += `&query.author=${encodeURIComponent(filters.author)}`;
  }

  const result = await httpJsonGet(url);

  if (!result.ok) {
    return {
      success: false,
      error: `CrossRef API error: ${result.status}`,
      total: 0,
      articles: [],
    };
  }

  const data = JSON.parse(result.body);
  const items = data.message?.items || [];

  const articles = items.map((item: any) => ({
    title: (item.title || [""])[0] || "",
    authors: (item.author || [])
      .map((a: any) => `${a.given || ""} ${a.family || ""}`.trim())
      .join(", "),
    year: item.published?.["date-parts"]?.[0]?.[0] || "",
    abstract: stripJatsXml(item.abstract || ""),
    doi: item.DOI || "",
    containerTitle: (item["container-title"] || [""])[0] || "",
    journalName: (item["container-title"] || [""])[0] || undefined,
    issn: (item.ISSN || [])[0] || undefined,
    volume: item.volume || undefined,
    issue: item.issue || undefined,
    pages: item.page || undefined,
    publicationType: item.type || undefined,
    publisher: item.publisher || undefined,
    citationCount: item["is-referenced-by-count"] ?? 0,
    url: item.URL || "",
    source: "crossref" as const,
  }));

  return {
    total: data.message?.["total-results"] || articles.length,
    returned: articles.length,
    source: "crossref",
    articles,
  };
}

function _mapOpenAlexWork(work: any): any {
  const authors = (work.authorships || [])
    .map((a: any) => a.author?.display_name || a.author?.name || "")
    .filter(Boolean)
    .join(", ");

  let abstract = "";
  if (work.abstract_inverted_index) {
    const words: { word: string; pos: number }[] = [];
    for (const [word, positions] of Object.entries(
      work.abstract_inverted_index,
    ) as [string, number[]][]) {
      for (const pos of positions) words.push({ word, pos });
    }
    words.sort((a, b) => a.pos - b.pos);
    abstract = words.map((w) => w.word).join(" ");
  }

  return {
    title: work.title || "",
    authors,
    year: work.publication_year || "",
    abstract,
    doi: work.doi || "",
    url: work.id
      ? `https://openalex.org/works/${work.id.replace("https://openalex.org/", "")}`
      : "",
    oaUrl: work.open_access?.oa_url || "",
    pdfUrl: work.open_access?.oa_url || "",
    citationCount: work.cited_by_count ?? 0,
    source: "openalex" as const,
    containerTitle: work.primary_location?.source?.display_name || undefined,
    journalName: work.primary_location?.source?.display_name || undefined,
    issn: (work.primary_location?.source?.issn || [])[0] || undefined,
    volume: work.biblio?.volume || undefined,
    issue: work.biblio?.issue || undefined,
    pages: work.biblio?.first_page
      ? work.biblio?.last_page
        ? `${work.biblio.first_page}-${work.biblio.last_page}`
        : work.biblio.first_page
      : undefined,
    publicationType: work.type || undefined,
  };
}
