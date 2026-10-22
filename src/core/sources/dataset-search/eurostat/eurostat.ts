/**
 * EurostatAdapter — Eurostat 欧洲统计检索源（免 key）。
 *
 * Eurostat 是欧盟统计局，提供欧洲各国的统计数据，免费 API。
 * 端点：/api/dissemination/statistics/1.0/data/<dataset>
 *      /api/dissemination/catalogue/toc/txt?lang=en（列出所有数据集）
 *
 * 返回 DomainResult：
 *  - sourceId = Eurostat dataset code（如 "nama_10_gdp"）
 *  - dedupKey = "eurostat:" + sourceId
 *  - extra 含 title、dataSource、lastUpdate
 *
 * @module core/sources/dataset-search/eurostat
 */

import { DomainSourceAdapter } from "../../../search/DomainSourceAdapter";
import type { DomainResult, DomainFilters } from "../../../search/domainTypes";
import { ZSEARCH_HTTP_HEADERS } from "../../../../utils/httpHeaders";

const EUROSTAT_API = "https://ec.europa.eu/eurostat/api/dissemination";

export class EurostatAdapter extends DomainSourceAdapter {
  readonly id = "eurostat";
  readonly domainId = "dataset";
  readonly label = "Eurostat";
  readonly noKey = true;

  async isAvailable() {
    return { available: true };
  }

  async search(
    query: string,
    maxResults: number,
    _filters?: DomainFilters,
  ): Promise<DomainResult[]> {
    // 获取数据集目录，然后按查询词过滤
    const url = `${EUROSTAT_API}/catalogue/toc/txt?lang=en`;

    const resp = await Zotero.HTTP.request("GET", url, {
      headers: {
        Accept: "text/plain",
        ...ZSEARCH_HTTP_HEADERS,
      },
      timeout: 20000,
      errorDelayMax: 0,
    } as any);

    if (resp.status >= 400) {
      throw new Error(`Eurostat API error: HTTP ${resp.status}`);
    }

    // TOC 是 tab-separated text，格式：code \t title \t dataSource \t lastUpdate
    const text = resp.responseText || "";
    const lines = text.split("\n");
    const queryLower = query.toLowerCase();
    const results: DomainResult[] = [];

    for (const line of lines) {
      if (results.length >= maxResults) break;
      const parts = line.split("\t");
      if (parts.length < 2) continue;
      const code = parts[0].trim();
      const title = parts[1].trim();
      if (!code || !title) continue;
      if (!title.toLowerCase().includes(queryLower)) continue;

      const url = `https://ec.europa.eu/eurostat/databrowser/view/${code}/default/table`;

      results.push({
        title,
        url,
        snippet: "",
        source: "eurostat",
        sourceId: code,
        dedupKey: `eurostat:${code}`,
        extra: {
          dataSource: parts[2]?.trim() || "Eurostat",
          lastUpdate: parts[3]?.trim() || "",
        },
      });
    }

    return results;
  }
}
