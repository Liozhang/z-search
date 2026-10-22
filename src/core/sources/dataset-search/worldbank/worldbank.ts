/**
 * WorldBankAdapter — World Bank Indicators 数据检索源（免 key）。
 *
 * World Bank Indicators API 免费、无需 key，覆盖近 16000 个时间序列指标，
 * 涵盖发展经济学、健康、教育、环境等领域。
 * 端点：/v2/country/all/indicator/<indicator>?format=json
 *      /v2/sources?format=json（列出所有数据源）
 *
 * 返回 DomainResult：
 *  - sourceId = indicator id（如 "SP.POP.TOTL"）
 *  - dedupKey = "worldbank:" + sourceId
 *  - extra 含 indicatorName、source、sourceNote、topics
 *
 * @module core/sources/dataset-search/worldbank
 */

import { DomainSourceAdapter } from "../../../search/DomainSourceAdapter";
import type { DomainResult, DomainFilters } from "../../../search/domainTypes";
import { ZSEARCH_HTTP_HEADERS } from "../../../../utils/httpHeaders";
import { safeDebug } from "../../../../utils/logger";
import { toErrorMessage } from "../../../../utils/error";

const WB_API = "https://api.worldbank.org/v2";

export class WorldBankAdapter extends DomainSourceAdapter {
  readonly id = "worldbank";
  readonly domainId = "dataset";
  readonly label = "World Bank Indicators";
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
    // 搜索指标：先获取指标列表，再按名称过滤
    const url = `${WB_API}/indicator?format=json&per_page=${limit}`;

    const resp = await Zotero.HTTP.request("GET", url, {
      headers: {
        Accept: "application/json",
        ...ZSEARCH_HTTP_HEADERS,
      },
      timeout: 20000,
      errorDelayMax: 0,
    } as any);

    if (resp.status >= 400) {
      throw new Error(`World Bank API error: HTTP ${resp.status}`);
    }

    let data: any;
    try {
      data = JSON.parse(resp.responseText || "[]");
    } catch (e) {
      throw new Error(`World Bank API invalid JSON: ${toErrorMessage(e)}`);
    }

    // World Bank API 返回 [metadata, indicators]
    const indicators: any[] = Array.isArray(data) && data.length > 1 ? data[1] : [];
    const results: DomainResult[] = [];

    // 按查询词过滤指标名称
    const queryLower = query.toLowerCase();
    const filtered = indicators.filter((ind: any) =>
      (ind.name || "").toLowerCase().includes(queryLower),
    );

    for (const ind of filtered.slice(0, maxResults)) {
      const id = ind.id || "";
      if (!id) continue;

      const name = ind.name || "";
      if (!name) continue;

      const url = `https://data.worldbank.org/indicator/${id}`;

      // 主题：sourceNote 中的主题列表
      const sourceNote = ind.sourceNote || "";
      const topics: string[] = Array.isArray(ind.topics)
        ? ind.topics.map((t: any) => t.value || "")
        : [];

      results.push({
        title: name,
        url,
        snippet: sourceNote.slice(0, 300),
        source: "worldbank",
        sourceId: id,
        dedupKey: `worldbank:${id}`,
        extra: {
          indicatorName: name,
          source: ind.source?.value || "World Bank",
          sourceOrganization: ind.sourceOrganization || "",
          topics,
          sourceNote,
        },
      });
    }

    return results;
  }
}
