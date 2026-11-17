/**
 * NasaOpenDataAdapter — NASA Open Data API 检索源（免 key）。
 *
 * NASA Open Data Portal 提供航天和地球科学数据，免费 API。
 * 端点：/api/3/action/package_search?q=<query>&rows=<n>（CKAN API）
 *
 * 返回 DomainResult：
 *  - sourceId = NASA dataset name（如 "nasa-near-earth-object-observations"）
 *  - dedupKey = "nasa:" + sourceId
 *  - extra 含 notes、organization、tags、license
 *
 * @module core/sources/dataset-search/nasa
 */

import { DomainSourceAdapter } from "../../../search/DomainSourceAdapter";
import type { DomainResult, DomainFilters } from "../../../search/domainTypes";
import { ZSEARCH_HTTP_HEADERS } from "../../../../utils/httpHeaders";
import { toErrorMessage } from "../../../../utils/error";

const NASA_API = "https://data.nasa.gov/api/3/action/package_search";

export class NasaOpenDataAdapter extends DomainSourceAdapter {
  readonly id = "nasa";
  readonly domainId = "dataset";
  readonly label = "NASA Open Data";
  readonly noKey = true;
  // CKAN 对含连字符/下划线的查询串按单一检索词宽松匹配：HLA-typing
  // 实测 2234 条且与 typing 单独检索几乎一致（2231 条）；折叠为空格后
  // 按「与」语义检索，实测诚实返回 0 条。见 core/search/domainQuery
  // （2026-11-17 实测）。
  readonly queryDialect = "normalized" as const;

  async isAvailable() {
    return { available: true };
  }

  async search(
    query: string,
    maxResults: number,
    _filters?: DomainFilters,
  ): Promise<DomainResult[]> {
    const limit = Math.min(maxResults, 100);
    const url = `${NASA_API}?q=${encodeURIComponent(query)}&rows=${limit}`;

    const resp = await Zotero.HTTP.request("GET", url, {
      headers: {
        Accept: "application/json",
        ...ZSEARCH_HTTP_HEADERS,
      },
      timeout: 20000,
      errorDelayMax: 0,
    } as any);

    if (resp.status >= 400) {
      throw new Error(`NASA Open Data API error: HTTP ${resp.status}`);
    }

    let data: any;
    try {
      data = JSON.parse(resp.responseText || "{}");
    } catch (e) {
      throw new Error(`NASA Open Data API invalid JSON: ${toErrorMessage(e)}`, {
        cause: e,
      });
    }

    const results_data: any[] = data?.result?.results || [];
    const results: DomainResult[] = [];

    for (const pkg of results_data.slice(0, maxResults)) {
      const name = pkg.name || "";
      if (!name) continue;

      const title = pkg.title || name;
      const url = `https://data.nasa.gov/dataset/${name}`;

      const tags: string[] = Array.isArray(pkg.tags)
        ? pkg.tags.map((t: any) => t.name || "").filter(Boolean)
        : [];

      const org = pkg.organization?.title || pkg.organization?.name || "";

      results.push({
        title,
        url,
        snippet: (pkg.notes || "").slice(0, 300),
        source: "nasa",
        sourceId: name,
        year: pkg.metadata_created
          ? pkg.metadata_created.slice(0, 4)
          : undefined,
        dedupKey: `nasa:${name}`,
        extra: {
          organization: org,
          tags,
          license: pkg.license_title || pkg.license_id || "",
          metadataCreated: pkg.metadata_created || "",
          metadataModified: pkg.metadata_modified || "",
        },
      });
    }

    return results;
  }
}
