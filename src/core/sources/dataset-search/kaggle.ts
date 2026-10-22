/**
 * KaggleDatasetAdapter — Kaggle Datasets API 检索源（需 key）。
 *
 * Kaggle API 需要用户名和 API key（在 Kaggle 账户设置中生成）。
 * 端点：/api/v1/datasets/list?search=<query>
 *
 * 返回 DomainResult：
 *  - sourceId = "owner/dataset-name"
 *  - dedupKey = "kaggle:" + sourceId（Kaggle 无 DOI）
 *  - extra 含 owner、size、lastUpdated、downloadCount
 *
 * @module core/sources/dataset-search/kaggle
 */

import { DomainSourceAdapter } from "../../search/DomainSourceAdapter";
import type { DomainResult, DomainFilters } from "../../search/domainTypes";
import { getPrefDynamic } from "../../../utils/prefs";
import { safeDebug } from "../../../utils/logger";
import { toErrorMessage } from "../../../utils/error";

const KAGGLE_API = "https://www.kaggle.com/api/v1/datasets/list";

export class KaggleDatasetAdapter extends DomainSourceAdapter {
  readonly id = "kaggle";
  readonly domainId = "dataset";
  readonly label = "Kaggle Datasets";
  readonly noKey = false;

  async isAvailable() {
    const username = getPrefDynamic("search.dataset.kaggle.username") as string;
    const key = getPrefDynamic("search.dataset.kaggle.apiKey") as string;
    if (username && key) return { available: true };
    return { available: false, reason: "not-configured" };
  }

  async search(
    query: string,
    maxResults: number,
    filters?: DomainFilters,
  ): Promise<DomainResult[]> {
    const username = getPrefDynamic("search.dataset.kaggle.username") as string;
    const apiKey = getPrefDynamic("search.dataset.kaggle.apiKey") as string;
    if (!username || !apiKey) {
      throw new Error("Kaggle credentials not configured");
    }

    // Kaggle API 用 Basic auth
    const basicAuth = btoa(`${username}:${apiKey}`);
    const limit = Math.min(maxResults, 20); // Kaggle 单页上限 20
    const url = `${KAGGLE_API}?search=${encodeURIComponent(query)}&max_size=${limit * 1000}`;

    const resp = await Zotero.HTTP.request("GET", url, {
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${basicAuth}`,
      },
      timeout: 20000,
      errorDelayMax: 0,
    } as any);

    if (resp.status >= 400) {
      throw new Error(`Kaggle API error: HTTP ${resp.status}`);
    }

    let datasets: any[];
    try {
      datasets = JSON.parse(resp.responseText || "[]");
    } catch (e) {
      throw new Error(`Kaggle API invalid JSON: ${toErrorMessage(e)}`);
    }

    if (!Array.isArray(datasets)) return [];

    const results: DomainResult[] = [];
    for (const ds of datasets.slice(0, maxResults)) {
      const ref = ds.ref || "";
      if (!ref) continue;

      const url = `https://www.kaggle.com/datasets/${ref}`;

      results.push({
        title: ds.title || ref,
        url,
        snippet: (ds.subtitle || "").slice(0, 300),
        source: "kaggle",
        sourceId: ref,
        year: ds.lastUpdated ? ds.lastUpdated.slice(0, 4) : undefined,
        dedupKey: `kaggle:${ref}`,
        metrics: {
          downloads: ds.downloadCount ?? 0,
          likes: ds.voteCount ?? 0,
          fileSize: ds.totalBytes ?? 0,
        },
        extra: {
          owner: ds.creatorName || ref.split("/")[0],
          license: ds.licenseName || "",
          lastUpdated: ds.lastUpdated || "",
          usabilityRating: ds.usabilityRating ?? undefined,
        },
      });
    }

    return results;
  }
}
