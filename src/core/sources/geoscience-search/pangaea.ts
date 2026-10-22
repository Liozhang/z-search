/**
 * PangaeaAdapter — PANGAEA 地球科学数据检索源（免 key）。
 *
 * PANGAEA 是地球科学领域的开放数据仓储，免费 API。
 * 端点：/api/v1/search?q=<query>&count=<n>
 *
 * 返回 DomainResult：
 *  - sourceId = PANGAEA dataset id（如 "842574"）
 *  - dedupKey = "pangaea:" + sourceId
 *  - extra 含 authors、license、size、topics
 *
 * @module core/sources/geoscience-search/pangaea
 */

import { DomainSourceAdapter } from "../../search/DomainSourceAdapter";
import type { DomainResult, DomainFilters } from "../../search/domainTypes";
import { ZSEARCH_HTTP_HEADERS } from "../../../utils/httpHeaders";
import { safeDebug } from "../../../utils/logger";
import { toErrorMessage } from "../../../utils/error";

const PANGAEA_API = "https://www.pangaea.de/api/v1";

export class PangaeaAdapter extends DomainSourceAdapter {
  readonly id = "pangaea";
  readonly domainId = "geoscience";
  readonly label = "PANGAEA";
  readonly noKey = true;

  async isAvailable() {
    return { available: true };
  }

  async search(
    query: string,
    maxResults: number,
    _filters?: DomainFilters,
  ): Promise<DomainResult[]> {
    const limit = Math.min(maxResults, 100);
    const url = `${PANGAEA_API}/search?q=${encodeURIComponent(query)}&count=${limit}&format=json`;

    const resp = await Zotero.HTTP.request("GET", url, {
      headers: {
        Accept: "application/json",
        ...ZSEARCH_HTTP_HEADERS,
      },
      timeout: 20000,
      errorDelayMax: 0,
    } as any);

    if (resp.status >= 400) {
      throw new Error(`PANGAEA API error: HTTP ${resp.status}`);
    }

    let data: any;
    try {
      data = JSON.parse(resp.responseText || "{}");
    } catch (e) {
      throw new Error(`PANGAEA API invalid JSON: ${toErrorMessage(e)}`);
    }

    const results_data: any[] = data.results || [];
    const results: DomainResult[] = [];

    for (const item of results_data.slice(0, maxResults)) {
      const id = String(item.id || "");
      if (!id) continue;

      const title = item.title || "";
      if (!title) continue;

      const authors: string[] = Array.isArray(item.authors)
        ? item.authors.map((a: any) => `${a.lastname || ""}, ${a.firstname || ""}`.trim()).filter(Boolean)
        : [];

      const url = `https://doi.org/10.1594/PANGAEA.${id}`;

      results.push({
        title,
        url,
        snippet: (item.abstract || "").slice(0, 300),
        source: "pangaea",
        sourceId: id,
        year: item.yearOfPublication
          ? String(item.yearOfPublication)
          : undefined,
        dedupKey: `pangaea:${id}`,
        metrics: {
          events: item.eventCount ?? 0,
          parameters: item.parameterCount ?? 0,
        },
        extra: {
          authors,
          license: item.license || "CC BY",
          doi: `10.1594/PANGAEA.${id}`,
          size: item.size || "",
          topics: Array.isArray(item.topics) ? item.topics : [],
        },
      });
    }

    return results;
  }
}
