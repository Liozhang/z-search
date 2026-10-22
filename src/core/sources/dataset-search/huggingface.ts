/**
 * HuggingFaceDatasetAdapter — Hugging Face Datasets 检索源（免 key）。
 *
 * HF Datasets API 免费、无需 key，覆盖 NLP/CV/全领域数据集。
 * 端点：/api/datasets?search=<query>&sort=<sort>&direction=-1&limit=<n>
 *
 * 返回结果映射为 DomainResult：
 *  - sourceId = dataset id（如 "squad" / "lsr42/crossref"）
 *  - dedupKey = "hf:" + id（HF 无 DOI，用源 ID 前缀命名空间）
 *  - extra 含 license、任务标签、下载量、likes
 *
 * @module core/sources/dataset-search/huggingface
 */

import { DomainSourceAdapter } from "../../search/DomainSourceAdapter";
import type { DomainResult, DomainFilters } from "../../search/domainTypes";
import { ZSEARCH_HTTP_HEADERS } from "../../../utils/httpHeaders";
import { safeDebug } from "../../../utils/logger";
import { toErrorMessage } from "../../../utils/error";

const HF_DATASETS_API = "https://huggingface.co/api/datasets";

export class HuggingFaceDatasetAdapter extends DomainSourceAdapter {
  readonly id = "huggingface";
  readonly domainId = "dataset";
  readonly label = "Hugging Face Datasets";
  readonly noKey = true;

  async isAvailable() {
    return { available: true };
  }

  async search(
    query: string,
    maxResults: number,
    _filters?: DomainFilters,
  ): Promise<DomainResult[]> {
    // 排序：默认 downloads 降序（社区采用度）；有 license 过滤时可用 &filter
    const limit = Math.min(maxResults, 100); // HF 上限 100
    const url = `${HF_DATASETS_API}?search=${encodeURIComponent(query)}&sort=downloads&direction=-1&limit=${limit}`;

    const resp = await Zotero.HTTP.request("GET", url, {
      headers: {
        Accept: "application/json",
        ...ZSEARCH_HTTP_HEADERS,
      },
      timeout: 15000,
      errorDelayMax: 0,
    } as any);

    if (resp.status >= 400) {
      throw new Error(`Hugging Face API error: HTTP ${resp.status}`);
    }

    let datasets: any[];
    try {
      datasets = JSON.parse(resp.responseText || "[]");
    } catch (e) {
      throw new Error(
        `Hugging Face API invalid JSON: ${toErrorMessage(e)}`,
      );
    }

    if (!Array.isArray(datasets)) return [];

    const results: DomainResult[] = [];
    for (const ds of datasets.slice(0, maxResults)) {
      const id = ds.id || ds.name || "";
      if (!id) continue;

      // 许可证：cardData.license（如 "mit" / "cc-by-4.0"）
      const license = ds.cardData?.license || "";

      // 任务标签：pipeline_tag（如 "text-classification"）
      const taskTags = ds.pipeline_tag ? [ds.pipeline_tag] : [];

      const url = `https://huggingface.co/datasets/${id}`;

      results.push({
        title: id,
        url,
        snippet: (ds.description || "").slice(0, 300),
        source: "huggingface",
        sourceId: id,
        year: ds.lastModified ? ds.lastModified.slice(0, 4) : undefined,
        dedupKey: `hf:${id}`,
        metrics: {
          downloads: ds.downloads ?? 0,
          likes: ds.likes ?? 0,
        },
        extra: {
          license,
          taskTags,
          author: ds.author || "",
          gated: ds.gated || false,
        },
      });
    }

    return results;
  }

  async profile(sourceId: string): Promise<DomainResult | null> {
    const url = `${HF_DATASETS_API}/${sourceId}`;
    const resp = await Zotero.HTTP.request("GET", url, {
      headers: {
        Accept: "application/json",
        ...ZSEARCH_HTTP_HEADERS,
      },
      timeout: 15000,
      errorDelayMax: 0,
    } as any);

    if (resp.status >= 400) return null;

    let ds: any;
    try {
      ds = JSON.parse(resp.responseText || "");
    } catch {
      return null;
    }

    return {
      title: ds.id || sourceId,
      url: `https://huggingface.co/datasets/${sourceId}`,
      snippet: (ds.description || "").slice(0, 300),
      source: "huggingface",
      sourceId,
      dedupKey: `hf:${sourceId}`,
      metrics: {
        downloads: ds.downloads ?? 0,
        likes: ds.likes ?? 0,
      },
      extra: {
        license: ds.cardData?.license || "",
        taskTags: ds.pipeline_tag ? [ds.pipeline_tag] : [],
        author: ds.author || "",
        gated: ds.gated || false,
      },
    };
  }
}
