/**
 * DryadDatasetAdapter — Dryad 数据集检索源（免 key）。
 *
 * Dryad 是通用开放数据仓储，支持多学科数据集，有 DOI。
 * 端点：/api/v2/search?q=<query>&per_page=<n>
 *
 * 返回 DomainResult：
 *  - sourceId = Dryad 内部 id
 *  - dedupKey = DOI（有则）或 "dryad:" + id
 *  - extra 含 creators、license、file size
 *
 * @module core/sources/dataset-search/dryad
 */

import { DomainSourceAdapter } from "../../search/DomainSourceAdapter";
import type { DomainResult, DomainFilters } from "../../search/domainTypes";
import { normalizeDoi } from "../../search/literatureSearchHelpers";
import { ZSEARCH_HTTP_HEADERS } from "../../../utils/httpHeaders";
import { safeDebug } from "../../../utils/logger";
import { toErrorMessage } from "../../../utils/error";

const DRYAD_API = "https://datadryad.org/api/v2/search";

export class DryadDatasetAdapter extends DomainSourceAdapter {
  readonly id = "dryad";
  readonly domainId = "dataset";
  readonly label = "Dryad";
  readonly noKey = true;

  async isAvailable() {
    return { available: true };
  }

  async search(
    query: string,
    maxResults: number,
    filters?: DomainFilters,
  ): Promise<DomainResult[]> {
    const limit = Math.min(maxResults, 100);
    let url = `${DRYAD_API}?q=${encodeURIComponent(query)}&per_page=${limit}`;

    // 年份过滤
    if (filters?.year) {
      const [start, end] = filters.year.split("-");
      if (start && end) {
        url += `&publication_date=${start}-01-01..${end}-12-31`;
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
      throw new Error(`Dryad API error: HTTP ${resp.status}`);
    }

    let data: any;
    try {
      data = JSON.parse(resp.responseText || "{}");
    } catch (e) {
      throw new Error(`Dryad API invalid JSON: ${toErrorMessage(e)}`);
    }

    const items: any[] = data._embedded?.["stash:datasets"] || [];
    const results: DomainResult[] = [];

    for (const item of items.slice(0, maxResults)) {
      const id = String(item.id || "");
      if (!id) continue;

      const title = item.title || "";
      if (!title) continue;

      const doi = normalizeDoi(item.doi || "");
      const url = `https://datadryad.org/stash/dataset/${doi || id}`;

      // 创作者
      const creators: string[] = Array.isArray(item.authors)
        ? item.authors.map((a: any) => a.name || "").filter(Boolean)
        : [];

      // 许可证
      const license = item.license || "";

      results.push({
        title,
        url,
        snippet: (item.abstract || "").slice(0, 300),
        source: "dryad",
        sourceId: id,
        year: item.publicationDate
          ? item.publicationDate.slice(0, 4)
          : undefined,
        doi: doi || undefined,
        dedupKey: doi || `dryad:${id}`,
        metrics: {
          downloads: item.downloadCount ?? 0,
          views: item.viewCount ?? 0,
        },
        extra: {
          creators,
          license,
          publicationDate: item.publicationDate || "",
        },
      });
    }

    return results;
  }
}
