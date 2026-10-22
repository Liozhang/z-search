/**
 * WhoGhoAdapter — WHO Global Health Observatory 检索源（免 key）。
 *
 * WHO GHO 是世界卫生组织的健康统计数据平台，免费 API。
 * 端点：/api/gho/<indicator>（按指标获取数据）
 *      /api/indicators（列出所有指标）
 *
 * 返回 DomainResult：
 *  - sourceId = WHO GHO indicator code（如 "WHS4_100"）
 *  - dedupKey = "who:" + sourceId
 *  - extra 含 indicatorName、category、description
 *
 * @module core/sources/dataset-search/who
 */

import { DomainSourceAdapter } from "../../../search/DomainSourceAdapter";
import type { DomainResult, DomainFilters } from "../../../search/domainTypes";
import { ZSEARCH_HTTP_HEADERS } from "../../../../utils/httpHeaders";
import { safeDebug } from "../../../../utils/logger";
import { toErrorMessage } from "../../../../utils/error";

const WHO_GHO_API = "https://ghoapi.azureedge.net/api";

export class WhoGhoAdapter extends DomainSourceAdapter {
  readonly id = "who-gho";
  readonly domainId = "dataset";
  readonly label = "WHO Global Health Observatory";
  readonly noKey = true;

  async isAvailable() {
    return { available: true };
  }

  async search(
    query: string,
    maxResults: number,
    _filters?: DomainFilters,
  ): Promise<DomainResult[]> {
    const limit = Math.min(maxResults, 100);
    // 列出所有指标，然后按查询词过滤
    const url = `${WHO_GHO_API}/Indicator?$filter=contains(IndicatorName,'${encodeURIComponent(query)}')&$top=${limit}`;

    const resp = await Zotero.HTTP.request("GET", url, {
      headers: {
        Accept: "application/json",
        ...ZSEARCH_HTTP_HEADERS,
      },
      timeout: 20000,
      errorDelayMax: 0,
    } as any);

    if (resp.status >= 400) {
      throw new Error(`WHO GHO API error: HTTP ${resp.status}`);
    }

    let data: any;
    try {
      data = JSON.parse(resp.responseText || "{}");
    } catch (e) {
      throw new Error(`WHO GHO API invalid JSON: ${toErrorMessage(e)}`);
    }

    const indicators: any[] = data.value || [];
    const results: DomainResult[] = [];

    for (const ind of indicators.slice(0, maxResults)) {
      const code = ind.IndicatorCode || "";
      if (!code) continue;

      const name = ind.IndicatorName || "";
      if (!name) continue;

      const url = `https://www.who.int/data/gho/data/indicators/indicator-details/GHO/${code}`;

      results.push({
        title: name,
        url,
        snippet: "",
        source: "who-gho",
        sourceId: code,
        dedupKey: `who:${code}`,
        extra: {
          indicatorName: name,
          indicatorCode: code,
          language: ind.Language || "",
        },
      });
    }

    return results;
  }
}
