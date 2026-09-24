/** Per-source academic search handlers. */

import { httpJsonGet } from "../../../utils/http";

/**
 * DOAJ — Directory of Open Access Journals 的文章检索（免 key）。
 *
 * 库性质决定所有命中皆为开放获取；citationCount 该 API 不提供（恒 0）。
 * pdfUrl 取 fulltext 链接里的 PDF 项，多数记录只有 DOI 链接（出版商落地页）。
 */
export async function searchDoaj(args: {
  query: string;
  maxResults?: number;
}): Promise<any> {
  const maxResults = Math.min(args.maxResults ?? 10, 25);
  try {
    const url = `https://doaj.org/api/search/articles/${encodeURIComponent(args.query)}?pageSize=${maxResults}`;
    const result = await httpJsonGet(url, undefined, 20000);

    if (!result.ok) {
      return {
        success: false,
        error: `DOAJ API error: ${result.status}`,
        total: 0,
        articles: [],
        source: "doaj",
      };
    }

    const data = JSON.parse(result.body);
    const results: any[] = data.results || [];

    const articles = results.map((hit: any) => {
      const bib = hit.bibjson || {};

      const authors = (bib.author || [])
        .map((a: any) => a.name || "")
        .filter(Boolean)
        .join(", ");

      // identifier[] 混装 doi/pissn/eissn——按 type 取 DOI。
      const doi =
        (bib.identifier || []).find((id: any) => id.type === "doi")?.id || "";

      // link[] 混装 fulltext HTML/PDF/abstract——优先 PDF 直链，缺省落 DOI。
      const links: any[] = bib.link || [];
      const pdfLink = links.find(
        (l) => l.type === "fulltext" && l.content_type === "PDF",
      );
      const anyFulltext = links.find((l) => l.type === "fulltext");

      const journal = bib.journal || {};
      const startPage = bib.start_page || "";
      const endPage = bib.end_page || "";
      const pages = startPage
        ? endPage
          ? `${startPage}-${endPage}`
          : startPage
        : undefined;

      return {
        title: bib.title || "",
        authors,
        year: bib.year || "",
        abstract: bib.abstract || "",
        doi,
        url: doi ? `https://doi.org/${doi}` : anyFulltext?.url || "",
        pdfUrl: pdfLink?.url || "",
        oaUrl: anyFulltext?.url || "",
        isOpenAccess: true,
        citationCount: 0,
        source: "doaj" as const,
        containerTitle: journal.title || undefined,
        journalName: journal.title || undefined,
        issn: (journal.issns || [])[0] || undefined,
        volume: journal.volume || undefined,
        issue: journal.number || undefined,
        pages,
        publisher: journal.publisher || undefined,
        publicationType: "article" as const,
      };
    });

    return {
      total: data.total ?? articles.length,
      returned: articles.length,
      source: "doaj",
      articles,
    };
  } catch (e: any) {
    return {
      success: false,
      error: `DOAJ search failed: ${e.message}`,
      total: 0,
      articles: [],
      source: "doaj",
    };
  }
}
