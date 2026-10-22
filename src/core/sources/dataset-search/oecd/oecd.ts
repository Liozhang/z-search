/**
 * OecdAdapter — OECD Data Explorer 检索源（免 key）。
 *
 * OECD Data Explorer API 免费、无需 key，覆盖经济学、社会、环境等领域。
 * 端点：/api/sdmx-json/data/<dataset>/<query>
 *      /api/v1/dataflows（列出所有数据流）
 *
 * 返回 DomainResult：
 *  - sourceId = OECD dataset id（如 "DF_GDP"）
 *  - dedupKey = "oecd:" + sourceId
 *  - extra 含 datasetName、agency、description
 *
 * @module core/sources/dataset-search/oecd
 */

import { DomainSourceAdapter } from "../../../search/DomainSourceAdapter";
import type { DomainResult, DomainFilters } from "../../../search/domainTypes";
import { ZSEARCH_HTTP_HEADERS } from "../../../../utils/httpHeaders";
import { safeDebug } from "../../../../utils/logger";
import { toErrorMessage } from "../../../../utils/error";

const OECD_API = "https://sdmx.oecd.org/public/rest/dataflow";

export class OecdAdapter extends DomainSourceAdapter {
  readonly id = "oecd";
  readonly domainId = "dataset";
  readonly label = "OECD Data Explorer";
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
    // 列出所有数据流，然后按查询词过滤
    const url = `${OECD_API}/all/latest?format=json&detail=allstubs`;

    const resp = await Zotero.HTTP.request("GET", url, {
      headers: {
        Accept: "application/json",
        ...ZSEARCH_HTTP_HEADERS,
      },
      timeout: 20000,
      errorDelayMax: 0,
    } as any);

    if (resp.status >= 400) {
      throw new Error(`OECD API error: HTTP ${resp.status}`);
    }

    let data: any;
    try {
      data = JSON.parse(resp.responseText || "{}");
    } catch (e) {
      throw new Error(`OECD API invalid JSON: ${toErrorMessage(e)}`);
    }

    const dataflows: any[] = data?.data?.dataflows || [];
    const results: DomainResult[] = [];

    // 按查询词过滤数据流名称
    const queryLower = query.toLowerCase();
    const filtered = dataflows.filter((df: any) =>
      (df.name || "").toLowerCase().includes(queryLower),
    );

    for (const df of filtered.slice(0, maxResults)) {
      const id = df.id || "";
      if (!id) continue;

      const name = df.name || "";
      if (!name) continue;

      const url = `https://data-explorer.oecd.org/vis?df[ag]=OECD.${df.agencyID || "DF"}${id}&df[id]=${id}`;

      results.push({
        title: name,
        url,
        snippet: "",
        source: "oecd",
        sourceId: id,
        dedupKey: `oecd:${id}`,
        extra: {
          datasetName: name,
          agency: df.agencyID || "OECD",
          version: df.version || "",
        },
      });
    }

    return results;
  }
}
