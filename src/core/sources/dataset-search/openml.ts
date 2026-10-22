/**
 * OpenMLDatasetAdapter — OpenML 数据集检索源（免 key）。
 *
 * OpenML 是 ML 基准测试平台，免费 API，含数据集、任务、指标。
 * 端点：/api/v1/json/data/list/data_name/<name>/limit/<n>
 *
 * 返回 DomainResult：
 *  - sourceId = OpenML dataset id（如 "61" / "1590"）
 *  - dedupKey = "openml:" + id
 *  - extra 含 quality measures、样本数、特征数
 *
 * @module core/sources/dataset-search/openml
 */

import { DomainSourceAdapter } from "../../search/DomainSourceAdapter";
import type { DomainResult, DomainFilters } from "../../search/domainTypes";
import { ZSEARCH_HTTP_HEADERS } from "../../../utils/httpHeaders";
import { toErrorMessage } from "../../../utils/error";

const OPENML_API = "https://www.openml.org/api/v1/json";

export class OpenMLDatasetAdapter extends DomainSourceAdapter {
  readonly id = "openml";
  readonly domainId = "dataset";
  readonly label = "OpenML";
  readonly noKey = true;

  async isAvailable() {
    return { available: true };
  }

  async search(
    query: string,
    maxResults: number,
    _filters?: DomainFilters,
  ): Promise<DomainResult[]> {
    const url = `${OPENML_API}/data/list/data_name/${encodeURIComponent(query)}/limit/${Math.min(maxResults, 100)}`;

    const resp = await Zotero.HTTP.request("GET", url, {
      headers: {
        Accept: "application/json",
        ...ZSEARCH_HTTP_HEADERS,
      },
      timeout: 15000,
      errorDelayMax: 0,
    } as any);

    if (resp.status >= 400) {
      throw new Error(`OpenML API error: HTTP ${resp.status}`);
    }

    let data: any;
    try {
      data = JSON.parse(resp.responseText || "{}");
    } catch (e) {
      throw new Error(`OpenML API invalid JSON: ${toErrorMessage(e)}`, {
        cause: e,
      });
    }

    const datasets: any[] = data?.data?.dataset || [];
    const results: DomainResult[] = [];

    for (const ds of datasets.slice(0, maxResults)) {
      const id = String(ds.did || "");
      if (!id) continue;

      const name = ds.name || `Dataset ${id}`;
      const url = `https://www.openml.org/d/${id}`;

      // 质量指标：NumberOfInstances、NumberOfFeatures 等
      const quality = ds.quality || [];
      const metrics: Record<string, number> = {};
      for (const q of quality) {
        if (q.name && q.value != null) {
          if (q.name === "NumberOfInstances") metrics.samples = Number(q.value);
          if (q.name === "NumberOfFeatures") metrics.features = Number(q.value);
        }
      }

      results.push({
        title: name,
        url,
        snippet: (ds.description || "").slice(0, 300),
        source: "openml",
        sourceId: id,
        dedupKey: `openml:${id}`,
        metrics,
        extra: {
          format: ds.format || "",
          license: "CC BY",
          taskTags: [],
        },
      });
    }

    return results;
  }
}
