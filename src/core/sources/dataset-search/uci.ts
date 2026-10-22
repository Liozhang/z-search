/**
 * UciDatasetAdapter — UCI Machine Learning Repository 检索源（免 key）。
 *
 * UCI ML Repository 是经典 ML 数据集大本营，无官方 REST API，
 * 通过 HTML 抓取 + 内嵌数据解析。
 *
 * 端点：https://archive.ics.uci.edu/datasets（搜索页）
 *
 * 返回 DomainResult：
 *  - sourceId = UCI dataset ID（如 "iris" / "adult"）
 *  - dedupKey = "uci:" + id
 *
 * @module core/sources/dataset-search/uci
 */

import { DomainSourceAdapter } from "../../search/DomainSourceAdapter";
import type { DomainResult, DomainFilters } from "../../search/domainTypes";
import { ZSEARCH_HTTP_HEADERS } from "../../../utils/httpHeaders";
import { toErrorMessage } from "../../../utils/error";

const UCI_API = "https://archive.ics.uci.edu/api/datasets/list";

export class UciDatasetAdapter extends DomainSourceAdapter {
  readonly id = "uci";
  readonly domainId = "dataset";
  readonly label = "UCI ML Repository";
  readonly noKey = true;

  async isAvailable() {
    return { available: true };
  }

  async search(
    query: string,
    maxResults: number,
    _filters?: DomainFilters,
  ): Promise<DomainResult[]> {
    const url = `${UCI_API}?search=${encodeURIComponent(query)}&size=${Math.min(maxResults, 50)}`;

    const resp = await Zotero.HTTP.request("GET", url, {
      headers: {
        Accept: "application/json",
        ...ZSEARCH_HTTP_HEADERS,
      },
      timeout: 15000,
      errorDelayMax: 0,
    } as any);

    if (resp.status >= 400) {
      throw new Error(`UCI ML Repository error: HTTP ${resp.status}`);
    }

    let data: any;
    try {
      data = JSON.parse(resp.responseText || "{}");
    } catch (e) {
      throw new Error(`UCI ML Repository invalid JSON: ${toErrorMessage(e)}`, {
        cause: e,
      });
    }

    const datasets: any[] = data.data || [];
    const results: DomainResult[] = [];

    for (const ds of datasets.slice(0, maxResults)) {
      const id = String(ds.id || ds.uci_id || "");
      if (!id) continue;

      const name = ds.name || id;
      const url = `https://archive.ics.uci.edu/dataset/${id}`;

      results.push({
        title: name,
        url,
        snippet: (ds.abstract || ds.description || "").slice(0, 300),
        source: "uci",
        sourceId: id,
        dedupKey: `uci:${id}`,
        metrics: {
          downloads: ds.num_downloads ?? 0,
        },
        extra: {
          area: ds.area || "",
          taskTags: ds.tasks || [],
          license: "UCI ML Repository",
        },
      });
    }

    return results;
  }
}
