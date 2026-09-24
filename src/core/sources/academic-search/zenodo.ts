/** Per-source academic search handlers. */

import { httpJsonGet } from "../../../utils/http";

/**
 * Zenodo — CERN 开放仓库（论文/预印本/数据集/软件，免 key）。
 *
 * 主体是非论文资源：请求侧 `type=publication` 限定 + 响应侧
 * `resource_type.type === "publication"` 双重过滤，避免数据集污染
 * 文献检索结果。PDF 在 `files[]`（检索响应缺省不含，单条请求才有），
 * 检索阶段 pdfUrl 留空，全文下载留给现有 PDF 工具链。
 */
export async function searchZenodo(args: {
  query: string;
  maxResults?: number;
}): Promise<any> {
  const maxResults = Math.min(args.maxResults ?? 10, 25);
  try {
    const url = `https://zenodo.org/api/records?q=${encodeURIComponent(args.query)}&size=${maxResults}&type=publication`;
    const result = await httpJsonGet(url, undefined, 20000);

    if (!result.ok) {
      return {
        success: false,
        error: `Zenodo API error: ${result.status}`,
        total: 0,
        articles: [],
        source: "zenodo",
      };
    }

    const data = JSON.parse(result.body);
    const hits: any[] = data.hits?.hits || [];

    const articles = hits
      .filter(
        (h: any) =>
          (h.metadata?.resource_type?.type || "publication") === "publication",
      )
      .map((h: any) => {
        const meta = h.metadata || {};
        const authors = (meta.creators || [])
          .map((c: any) => c.name || "")
          .filter(Boolean)
          .join(", ");
        const year = String(meta.publication_date || "").slice(0, 4);
        const recUrl = h.links?.self_html || "";
        const doi = meta.doi || "";
        const journal = meta.journal || {};

        return {
          title: meta.title || "",
          authors,
          year,
          // description 是 HTML——剥标签做纯文本摘要。
          abstract: stripHtml(meta.description || ""),
          doi,
          url: doi ? `https://doi.org/${doi}` : recUrl,
          pdfUrl: "",
          oaUrl: recUrl,
          isOpenAccess: meta.access_right === "open",
          citationCount: 0,
          source: "zenodo" as const,
          containerTitle: journal.title || undefined,
          journalName: journal.title || undefined,
          issn: (journal.issn || [])[0] || undefined,
          volume: journal.volume || undefined,
          issue: journal.issue || undefined,
          pages: journal.pages || undefined,
          publisher: "Zenodo",
          publicationType: meta.resource_type?.subtype || "publication",
        };
      });

    return {
      total: data.hits?.total ?? articles.length,
      returned: articles.length,
      source: "zenodo",
      articles,
    };
  } catch (e: any) {
    return {
      success: false,
      error: `Zenodo search failed: ${e.message}`,
      total: 0,
      articles: [],
      source: "zenodo",
    };
  }
}

/** Zenodo 的 description 是富文本 HTML——剥标签 + 解常见实体。 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
