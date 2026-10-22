/**
 * FigshareAdapter — Figshare 数据集检索源（免 key）。
 *
 * Figshare 是全学科通用开放数据仓储，支持数据集、图片、视频等。
 * 免费 API v2。
 * 端点：/v2/articles/search（POST JSON body，限定 item_type=dataset）
 *
 * 返回 DomainResult：
 *  - sourceId = Figshare article id
 *  - dedupKey = DOI（有则）或 "figshare:" + id
 *  - extra 含 authors、license、size、tags
 *
 * @module core/sources/dataset-search/figshare
 */

import { DomainSourceAdapter } from "../../../search/DomainSourceAdapter";
import type { DomainResult, DomainFilters } from "../../../search/domainTypes";
import { normalizeDoi } from "../../../search/literatureSearchHelpers";
import { ZSEARCH_HTTP_HEADERS } from "../../../../utils/httpHeaders";
import { toErrorMessage } from "../../../../utils/error";

const FIGSHARE_API = "https://api.figshare.com/v2/articles/search";

export class FigshareAdapter extends DomainSourceAdapter {
  readonly id = "figshare";
  readonly domainId = "dataset";
  readonly label = "Figshare";
  readonly noKey = true;

  async isAvailable() {
    return { available: true };
  }

  async search(
    query: string,
    maxResults: number,
    filters?: DomainFilters,
  ): Promise<DomainResult[]> {
    const limit = Math.min(maxResults, 100);
    const body: Record<string, any> = {
      search_for: query,
      item_type: 3, // 3 = dataset in Figshare's type enum
      page_size: limit,
    };

    // 年份过滤
    if (filters?.year) {
      const [start, end] = filters.year.split("-");
      if (start && end) {
        body.published_since = `${start}-01-01`;
        body.published_before = `${end}-12-31`;
      }
    }

    const resp = await Zotero.HTTP.request("POST", FIGSHARE_API, {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...ZSEARCH_HTTP_HEADERS,
      },
      body: JSON.stringify(body),
      timeout: 20000,
      errorDelayMax: 0,
    } as any);

    if (resp.status >= 400) {
      throw new Error(`Figshare API error: HTTP ${resp.status}`);
    }

    let data: any;
    try {
      data = JSON.parse(resp.responseText || "[]");
    } catch (e) {
      throw new Error(`Figshare API invalid JSON: ${toErrorMessage(e)}`, {
        cause: e,
      });
    }

    const items: any[] = Array.isArray(data) ? data : [];
    const results: DomainResult[] = [];

    for (const item of items.slice(0, maxResults)) {
      const id = String(item.id || "");
      if (!id) continue;

      const title = item.title || "";
      if (!title) continue;

      const doi = normalizeDoi(item.doi || "");
      const authors: string[] = Array.isArray(item.authors)
        ? item.authors.map((a: any) => a.full_name || "").filter(Boolean)
        : [];

      const url =
        item.url_public_html || `https://figshare.com/articles/dataset/${id}`;

      results.push({
        title,
        url,
        snippet: (item.description || "").slice(0, 300),
        source: "figshare",
        sourceId: id,
        year: item.published_date ? item.published_date.slice(0, 4) : undefined,
        doi: doi || undefined,
        dedupKey: doi || `figshare:${id}`,
        metrics: {
          downloads: item.stats?.downloads ?? 0,
          views: item.stats?.views ?? 0,
          fileSize: item.size ?? 0,
        },
        extra: {
          authors,
          license: item.license?.name || "",
          tags: Array.isArray(item.tags) ? item.tags : [],
          categories: Array.isArray(item.categories)
            ? item.categories.map((c: any) => c.title || "").filter(Boolean)
            : [],
          publishedDate: item.published_date || "",
        },
      });
    }

    return results;
  }
}
