/**
 * ImfAdapter — IMF Data API 检索源（免 key）。
 *
 * IMF（国际货币基金组织）提供全球经济数据，免费 API。
 * 端点：/api/v1/data/<indicator>?format=json（SDMX 兼容）
 *      /api/v1/datasets（列出所有数据集）
 *
 * 返回 DomainResult：
 *  - sourceId = IMF dataset id（如 "IFS" / "BOP" / "GFSR"）
 *  - dedupKey = "imf:" + sourceId
 *  - extra 含 datasetName、description
 *
 * @module core/sources/dataset-search/imf
 */

import { DomainSourceAdapter } from "../../../search/DomainSourceAdapter";
import type { DomainResult, DomainFilters } from "../../../search/domainTypes";
import { ZSEARCH_HTTP_HEADERS } from "../../../../utils/httpHeaders";
import { toErrorMessage } from "../../../../utils/error";

const IMF_API = "https://dataservices.imf.org/REST/SDMX_JSON.svc";

export class ImfAdapter extends DomainSourceAdapter {
  readonly id = "imf";
  readonly domainId = "dataset";
  readonly label = "IMF Data";
  readonly noKey = true;

  async isAvailable() {
    return { available: true };
  }

  async search(
    query: string,
    maxResults: number,
    _filters?: DomainFilters,
  ): Promise<DomainResult[]> {
    // IMF 数据集列表通过 Dataflow API 获取
    const url = `${IMF_API}/Dataflow`;

    const resp = await Zotero.HTTP.request("GET", url, {
      headers: {
        Accept: "application/vnd.sdmx.structure+json;version=1.0",
        ...ZSEARCH_HTTP_HEADERS,
      },
      timeout: 20000,
      errorDelayMax: 0,
    } as any);

    if (resp.status >= 400) {
      throw new Error(`IMF API error: HTTP ${resp.status}`);
    }

    let data: any;
    try {
      data = JSON.parse(resp.responseText || "{}");
    } catch (e) {
      throw new Error(`IMF API invalid JSON: ${toErrorMessage(e)}`, {
        cause: e,
      });
    }

    // SDMX Dataflow 结构：data.dataflows[]
    const dataflows: any[] = data?.data?.dataflows || [];
    const queryLower = query.toLowerCase();
    const results: DomainResult[] = [];

    const filtered = dataflows.filter((df: any) =>
      (df.name || "").toLowerCase().includes(queryLower),
    );

    for (const df of filtered.slice(0, maxResults)) {
      const id = df.id || "";
      if (!id) continue;

      const name = df.name || "";
      if (!name) continue;

      const url = `https://data.imf.org/?sk=${id}`;

      results.push({
        title: name,
        url,
        snippet: "",
        source: "imf",
        sourceId: id,
        dedupKey: `imf:${id}`,
        extra: {
          datasetName: name,
          agency: df.agencyID || "IMF",
          version: df.version || "",
        },
      });
    }

    return results;
  }
}
