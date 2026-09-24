/**
 * ChinaXiv 学术源适配器。
 *
 * ⚠ 已从默认源表移除（2026-09-24）：现用的第三方接口 chinarxiv.org
 * 无视 query 参数——任何检索词都返回同一批无关论文，实测两轮不同检索
 * 逐字相同。官方 api.chinaxiv.org 的旧端点 301 到已 404 的页面。恢复
 * 默认启用前需先找到真实可用的检索端点并验证结果与检索词相关。
 */

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
