/**
 * DblpAdapter — DBLP Computer Science Bibliography 检索源（免 key）。
 *
 * DBLP 是计算机科学领域的开放书目数据库，免费 API。
 * 端点：/search/publ/api?q=<query>&format=json&h=<n>
 *
 * 返回 DomainResult：
 *  - sourceId = DBLP 内部 key（如 "conf/nips/VaswaniSPUJGKP17"）
 *  - dedupKey = "dblp:" + sourceId
 *  - extra 含 venue、year、type（conference/journal）
 *
 * @module core/sources/dblp-search/dblp
 */

import { DomainSourceAdapter } from "../../search/DomainSourceAdapter";
import type { DomainResult, DomainFilters } from "../../search/domainTypes";
import { ZSEARCH_HTTP_HEADERS } from "../../../utils/httpHeaders";
import { toErrorMessage } from "../../../utils/error";

const DBLP_API = "https://dblp.org/search/publ/api";

export class DblpAdapter extends DomainSourceAdapter {
  readonly id = "dblp";
  readonly domainId = "dblp";
  readonly label = "DBLP";
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
    let url = `${DBLP_API}?q=${encodeURIComponent(query)}&format=json&h=${limit}`;

    // 年份过滤：DBLP 支持 year:2020-2024 语法
    if (filters?.year) {
      const [start, end] = filters.year.split("-");
      if (start && end) {
        url += `&q=${encodeURIComponent(query + ` year:${start}-${end}`)}`;
      }
    }

    const resp = await Zotero.HTTP.request("GET", url, {
      headers: {
        Accept: "application/json",
        ...ZSEARCH_HTTP_HEADERS,
      },
      timeout: 15000,
      errorDelayMax: 0,
    } as any);

    if (resp.status >= 400) {
      throw new Error(`DBLP API error: HTTP ${resp.status}`);
    }

    let data: any;
    try {
      data = JSON.parse(resp.responseText || "{}");
    } catch (e) {
      throw new Error(`DBLP API invalid JSON: ${toErrorMessage(e)}`, {
        cause: e,
      });
    }

    const hits: any[] = data?.result?.hits?.hit || [];
    const results: DomainResult[] = [];

    for (const hit of hits.slice(0, maxResults)) {
      const info = hit.info || {};
      const key = info.key || "";
      if (!key) continue;

      const title = info.title || "";
      if (!title) continue;

      // 作者
      const authors: string[] = Array.isArray(info.authors?.author)
        ? info.authors.author.map((a: any) => a.text || "").filter(Boolean)
        : [];

      // 发表 venue
      const venue = info.venue || "";

      // 年份
      const year = info.year || "";

      // 类型：conference / journal / informal
      const type = info.type || "";

      const url = info.url || `https://dblp.org/rec/${key}`;

      results.push({
        title,
        url,
        snippet: "",
        source: "dblp",
        sourceId: key,
        year: year ? String(year) : undefined,
        dedupKey: `dblp:${key}`,
        extra: {
          authors,
          venue,
          type,
          doi: info.doi || undefined,
        },
      });
    }

    return results;
  }
}
