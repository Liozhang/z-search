/**
 * DataCiteSearchAdapter — DataCite Search API 检索源（免 key）。
 *
 * DataCite Search 是全球 DOI 注册中心的数据集检索 API，覆盖所有
 * DataCite 注册的数据集（含 Zenodo、Dryad、Figshare 等）。
 * 端点：/dois?query=<query>&page[size]=<n>
 *
 * 返回 DomainResult：
 *  - sourceId = DOI
 *  - dedupKey = DOI
 *  - extra 含 creators、publisher、license、publicationYear
 *
 * @module core/sources/dataset-search/datacite-search
 */

import { DomainSourceAdapter } from "../../search/DomainSourceAdapter";
import type { DomainResult, DomainFilters } from "../../search/domainTypes";
import { normalizeDoi } from "../../search/literatureSearchHelpers";
import { ZSEARCH_HTTP_HEADERS } from "../../../utils/httpHeaders";
import { safeDebug } from "../../../utils/logger";
import { toErrorMessage } from "../../../utils/error";

const DATACITE_SEARCH_API = "https://api.datacite.org/dois";

export class DataCiteSearchAdapter extends DomainSourceAdapter {
  readonly id = "datacite-search";
  readonly domainId = "dataset";
  readonly label = "DataCite Search";
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
    let url = `${DATACITE_SEARCH_API}?query=${encodeURIComponent(query)}&page[size]=${limit}&resource-type-id=dataset`;

    // 年份过滤
    if (filters?.year) {
      const [start, end] = filters.year.split("-");
      if (start && end) {
        url += `&publication-year=${start},${end}`;
      }
    }

    const resp = await Zotero.HTTP.request("GET", url, {
      headers: {
        Accept: "application/vnd.api+json",
        ...ZSEARCH_HTTP_HEADERS,
      },
      timeout: 20000,
      errorDelayMax: 0,
    } as any);

    if (resp.status >= 400) {
      throw new Error(`DataCite Search API error: HTTP ${resp.status}`);
    }

    let data: any;
    try {
      data = JSON.parse(resp.responseText || "{}");
    } catch (e) {
      throw new Error(`DataCite Search API invalid JSON: ${toErrorMessage(e)}`);
    }

    const items: any[] = data.data || [];
    const results: DomainResult[] = [];

    for (const item of items.slice(0, maxResults)) {
      const attrs = item.attributes || {};
      const doi = normalizeDoi(attrs.doi || "");
      if (!doi) continue;

      const title = Array.isArray(attrs.titles)
        ? attrs.titles[0]?.title || ""
        : "";

      const creators: string[] = Array.isArray(attrs.creators)
        ? attrs.creators.map((c: any) => c.name || "").filter(Boolean)
        : [];

      const license = Array.isArray(attrs.rightsList)
        ? attrs.rightsList.find((r: any) => r?.rightsIdentifier?.startsWith("cc-"))?.rightsIdentifier || ""
        : "";

      const url = `https://doi.org/${doi}`;

      results.push({
        title: title || doi,
        url,
        snippet: (attrs.descriptions?.[0]?.description || "").slice(0, 300),
        source: "datacite-search",
        sourceId: doi,
        year: attrs.publicationYear
          ? String(attrs.publicationYear)
          : undefined,
        doi,
        dedupKey: doi,
        metrics: {
          downloads: attrs.downloadCount ?? 0,
          views: attrs.viewCount ?? 0,
        },
        extra: {
          creators,
          license,
          publisher: attrs.publisher || "",
          publicationYear: attrs.publicationYear || undefined,
          types: attrs.types || {},
        },
      });
    }

    return results;
  }
}
