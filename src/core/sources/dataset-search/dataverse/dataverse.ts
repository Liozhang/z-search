/**
 * DataverseAdapter — Harvard Dataverse 数据集检索源（免 key）。
 *
 * Harvard Dataverse 是全学科开放数据仓储，免费 API。
 * 端点：/api/search?q=<query>&type=dataset&per_page=<n>
 *
 * 返回 DomainResult：
 *  - sourceId = Dataverse dataset id（如 "doi:10.7910/DVN/XXXXX"）
 *  - dedupKey = DOI
 *  - extra 含 authors、license、fileCount、description
 *
 * @module core/sources/dataset-search/dataverse
 */

import { DomainSourceAdapter } from "../../../search/DomainSourceAdapter";
import type { DomainResult, DomainFilters } from "../../../search/domainTypes";
import { normalizeDoi } from "../../../search/literatureSearchHelpers";
import { ZSEARCH_HTTP_HEADERS } from "../../../../utils/httpHeaders";
import { safeDebug } from "../../../../utils/logger";
import { toErrorMessage } from "../../../../utils/error";

const DATAVERSE_API = "https://dataverse.harvard.edu/api/search";

export class DataverseAdapter extends DomainSourceAdapter {
  readonly id = "dataverse";
  readonly domainId = "dataset";
  readonly label = "Harvard Dataverse";
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
    let url = `${DATAVERSE_API}?q=${encodeURIComponent(query)}&type=dataset&per_page=${limit}`;

    // 年份过滤
    if (filters?.year) {
      const [start, end] = filters.year.split("-");
      if (start && end) {
        url += `&publication_date=[${start}-01-01T00:00:00Z TO ${end}-12-31T23:59:59Z]`;
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
      throw new Error(`Harvard Dataverse API error: HTTP ${resp.status}`);
    }

    let data: any;
    try {
      data = JSON.parse(resp.responseText || "{}");
    } catch (e) {
      throw new Error(
        `Harvard Dataverse API invalid JSON: ${toErrorMessage(e)}`,
      );
    }

    const items: any[] = data?.data?.items || [];
    const results: DomainResult[] = [];

    for (const item of items.slice(0, maxResults)) {
      const id = item.global_id || "";
      if (!id) continue;

      const title = item.name || "";
      if (!title) continue;

      const doi = normalizeDoi(id);
      const authors: string[] = Array.isArray(item.author)
        ? item.author.map((a: any) => a.name || "").filter(Boolean)
        : [];

      const url = item.url || `https://doi.org/${id}`;

      results.push({
        title,
        url,
        snippet: (item.description || "").slice(0, 300),
        source: "dataverse",
        sourceId: id,
        year: item.publishedAt ? item.publishedAt.slice(0, 4) : undefined,
        doi: doi || undefined,
        dedupKey: doi || id,
        metrics: {
          downloads: 0,
          views: 0,
          fileSize: 0,
        },
        extra: {
          authors,
          license: item.license || "",
          publisher: item.publisher || "",
          subjects: Array.isArray(item.subjects) ? item.subjects : [],
          fileCount: item.fileCount ?? 0,
          version: item.versionState || "",
        },
      });
    }

    return results;
  }
}
