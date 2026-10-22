/**
 * ZenodoDatasetAdapter — Zenodo 数据集检索源（免 key）。
 *
 * Zenodo API 免费、无需 key，是 CERN 运营的通用开放仓库，数据集有 DOI。
 * 端点：/api/records?q=<query>&type=dataset&size=<n>
 *
 * 与 academic-search/zenodo.ts 的区别：那个限定 type=publication（论文），
 * 本适配器限定 type=dataset，返回结果映射为 DomainResult 并携带 DOI 作
 * dedupKey（有 DOI 走 DOI，无 DOI 退化为 Zenodo 内部 ID）。
 *
 * @module core/sources/dataset-search/zenodo
 */

import { DomainSourceAdapter } from "../../search/DomainSourceAdapter";
import type { DomainResult, DomainFilters } from "../../search/domainTypes";
import { normalizeDoi } from "../../search/literatureSearchHelpers";
import { ZSEARCH_HTTP_HEADERS } from "../../../utils/httpHeaders";
import { toErrorMessage } from "../../../utils/error";

const ZENODO_API = "https://zenodo.org/api/records";

export class ZenodoDatasetAdapter extends DomainSourceAdapter {
  readonly id = "zenodo";
  readonly domainId = "dataset";
  readonly label = "Zenodo (datasets)";
  readonly noKey = true;

  async isAvailable() {
    return { available: true };
  }

  async search(
    query: string,
    maxResults: number,
    filters?: DomainFilters,
  ): Promise<DomainResult[]> {
    // type=dataset 限定；年份过滤走 published range 参数
    let url = `${ZENODO_API}?q=${encodeURIComponent(query)}&type=dataset&size=${maxResults}`;
    if (filters?.year) {
      const [start, end] = filters.year.split("-");
      if (start && end) {
        url += `&published=${start}-01-01..${end}-12-31`;
      }
    }

    const resp = await Zotero.HTTP.request("GET", url, {
      headers: {
        Accept: "application/json",
        ...ZSEARCH_HTTP_HEADERS,
      },
      timeout: 20000,
      errorDelayMax: 0,
    } as any);

    if (resp.status >= 400) {
      throw new Error(`Zenodo API error: HTTP ${resp.status}`);
    }

    let data: any;
    try {
      data = JSON.parse(resp.responseText || "{}");
    } catch (e) {
      throw new Error(`Zenodo API invalid JSON: ${toErrorMessage(e)}`, {
        cause: e,
      });
    }

    const hits: any[] = data.hits?.hits || [];
    const results: DomainResult[] = [];

    for (const h of hits.slice(0, maxResults)) {
      const meta = h.metadata || {};
      const title = meta.title || "";
      if (!title) continue;

      // DOI：概念 DOI（10.5281/zenodo.NNNNNNN），归一化后作 dedupKey
      const doi = normalizeDoi(meta.doi || "");

      // 创作者
      const creators = Array.isArray(meta.creators)
        ? meta.creators.map((c: any) => c.name || "").filter(Boolean)
        : [];

      // 许可证：rights 数组（Zenodo 用 rights 而非 license）
      const rights = Array.isArray(meta.rights)
        ? meta.rights
        : meta.rights
          ? [meta.rights]
          : [];
      const license =
        rights.find((r: any) => r?.id?.startsWith("cc-"))?.id || "";

      // 文件大小：files 数组（检索响应可能缺，缺省 0）
      const files = Array.isArray(h.files) ? h.files : [];
      const totalSize = files.reduce(
        (sum: number, f: any) => sum + (f.size || 0),
        0,
      );

      const url = `https://zenodo.org/records/${h.id}`;

      results.push({
        title,
        url,
        snippet: (meta.description || "").slice(0, 300),
        source: "zenodo",
        sourceId: String(h.id),
        year: meta.publication_date
          ? meta.publication_date.slice(0, 4)
          : undefined,
        doi: doi || undefined,
        dedupKey: doi || `zenodo:${h.id}`,
        metrics: {
          views: h.stats?.views ?? 0,
          downloads: h.stats?.downloads ?? 0,
          fileSize: totalSize,
        },
        extra: {
          creators,
          license,
          publicationDate: meta.publication_date || "",
          version: h.version || "1",
          fileCount: files.length,
          resourceType: meta.resource_type?.title || "Dataset",
        },
      });
    }

    return results;
  }

  async profile(sourceId: string): Promise<DomainResult | null> {
    const url = `${ZENODO_API}/records/${sourceId}`;
    const resp = await Zotero.HTTP.request("GET", url, {
      headers: {
        Accept: "application/json",
        ...ZSEARCH_HTTP_HEADERS,
      },
      timeout: 15000,
      errorDelayMax: 0,
    } as any);

    if (resp.status >= 400) return null;

    let h: any;
    try {
      h = JSON.parse(resp.responseText || "{}");
    } catch {
      return null;
    }

    const meta = h.metadata || {};
    const doi = normalizeDoi(meta.doi || "");

    return {
      title: meta.title || sourceId,
      url: `https://zenodo.org/records/${sourceId}`,
      snippet: (meta.description || "").slice(0, 300),
      source: "zenodo",
      sourceId,
      year: meta.publication_date
        ? meta.publication_date.slice(0, 4)
        : undefined,
      doi: doi || undefined,
      dedupKey: doi || `zenodo:${sourceId}`,
      extra: {
        creators: Array.isArray(meta.creators)
          ? meta.creators.map((c: any) => c.name || "")
          : [],
        license: meta.license?.id || "",
        publicationDate: meta.publication_date || "",
      },
    };
  }
}
