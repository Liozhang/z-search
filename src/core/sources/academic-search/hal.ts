/** Per-source academic search handlers. */

import { httpJsonGet } from "../../../utils/http";

/**
 * HAL — 法国国家开放存档（archives-ouvertes.fr，免 key）。
 *
 * Solr 风格检索：`fl` 选字段降 payload。`title_s`/`abstract_s` 是多语言
 * 数组（法/英并存）——取最长元素。citationCount 该 API 不提供（恒 0）。
 */
export async function searchHal(args: {
  query: string;
  maxResults?: number;
}): Promise<any> {
  const maxResults = Math.min(args.maxResults ?? 10, 25);
  try {
    const fields = [
      "title_s",
      "authFullName_s",
      "publicationDateY_i",
      "abstract_s",
      "journalTitle_s",
      "doiId_s",
      "fileMain_s",
      "uri_s",
      "volume_s",
      "issue_s",
      "page_s",
    ].join(",");
    const url = `https://api.archives-ouvertes.fr/search/?q=${encodeURIComponent(args.query)}&wt=json&rows=${maxResults}&fl=${fields}`;
    const result = await httpJsonGet(url, undefined, 20000);

    if (!result.ok) {
      return {
        success: false,
        error: `HAL API error: ${result.status}`,
        total: 0,
        articles: [],
        source: "hal",
      };
    }

    const data = JSON.parse(result.body);
    const docs: any[] = data.response?.docs || [];

    const articles = docs.map((doc: any) => {
      // 多语言字段：数组并存法/英——取最长元素（通常英文文献记录更完整）。
      const title = longest((doc.title_s as string[]) || []);
      const abstract = longest((doc.abstract_s as string[]) || []);
      const authors = (doc.authFullName_s || []).filter(Boolean).join(", ");
      const doi = doc.doiId_s || "";

      return {
        title,
        authors,
        year: doc.publicationDateY_i || "",
        abstract,
        doi,
        url: doi ? `https://doi.org/${doi}` : doc.uri_s || "",
        pdfUrl: doc.fileMain_s || "",
        oaUrl: doc.uri_s || "",
        isOpenAccess: true,
        citationCount: 0,
        source: "hal" as const,
        containerTitle:
          (doc.journalTitle_s as string[] | undefined)?.[0] || undefined,
        journalName:
          (doc.journalTitle_s as string[] | undefined)?.[0] || undefined,
        volume: (doc.volume_s as string[] | undefined)?.[0] || undefined,
        issue: (doc.issue_s as string[] | undefined)?.[0] || undefined,
        pages: (doc.page_s as string[] | undefined)?.[0] || undefined,
        publicationType: "article" as const,
      };
    });

    return {
      total: data.response?.numFound ?? articles.length,
      returned: articles.length,
      source: "hal",
      articles,
    };
  } catch (e: any) {
    return {
      success: false,
      error: `HAL search failed: ${e.message}`,
      total: 0,
      articles: [],
      source: "hal",
    };
  }
}

/** 多语言字段取最长元素（字符串直接返回）。 */
function longest(values: string[] | undefined): string {
  if (!values || values.length === 0) return "";
  return values.reduce((a, b) => (b.length > a.length ? b : a), "");
}
