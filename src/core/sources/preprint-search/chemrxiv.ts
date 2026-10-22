/**
 * ChemRxivAdapter — ChemRxiv 预印本检索源（免 key）。
 *
 * ChemRxiv 是化学领域预印本服务器，基于 Figshare API。
 * 端点：/v2/articles/search（POST JSON body）
 *
 * 返回 DomainResult：
 *  - sourceId = Figshare article id
 *  - dedupKey = "chemrxiv:" + sourceId
 *  - extra 含 authors、publishedDate、DOI
 *
 * @module core/sources/preprint-search/chemrxiv
 */

import { DomainSourceAdapter } from "../../search/DomainSourceAdapter";
import type { DomainResult, DomainFilters } from "../../search/domainTypes";
import { ZSEARCH_HTTP_HEADERS } from "../../../utils/httpHeaders";
import { safeDebug } from "../../../utils/logger";
import { toErrorMessage } from "../../../utils/error";

const CHEM_RXIV_API = "https://chemrxiv.org/engage/api-gateway/chemrxiv/assets/orchestrate/Article/advanced-search";

export class ChemRxivAdapter extends DomainSourceAdapter {
  readonly id = "chemrxiv";
  readonly domainId = "preprint";
  readonly label = "ChemRxiv";
  readonly noKey = true;

  async isAvailable() {
    return { available: true };
  }

  async search(
    query: string,
    maxResults: number,
    _filters?: DomainFilters,
  ): Promise<DomainResult[]> {
    const limit = Math.min(maxResults, 50);

    // ChemRxiv 用 Cambridge Open Engage API（基于 Figshare）
    const body = JSON.stringify({
      searchFor: query,
      limit,
      offset: 0,
    });

    const resp = await Zotero.HTTP.request("POST", CHEM_RXIV_API, {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...ZSEARCH_HTTP_HEADERS,
      },
      body,
      timeout: 20000,
      errorDelayMax: 0,
    } as any);

    if (resp.status >= 400) {
      throw new Error(`ChemRxiv API error: HTTP ${resp.status}`);
    }

    let data: any;
    try {
      data = JSON.parse(resp.responseText || "{}");
    } catch (e) {
      throw new Error(`ChemRxiv API invalid JSON: ${toErrorMessage(e)}`);
    }

    const items: any[] = data.result?.items || data.items || [];
    const results: DomainResult[] = [];

    for (const item of items.slice(0, maxResults)) {
      const id = String(item.id || item.item?.id || "");
      if (!id) continue;

      const title = item.title || item.item?.title || "";
      if (!title) continue;

      const doi = item.doi || item.item?.doi || "";
      const authors: string[] = Array.isArray(item.authors)
        ? item.authors.map((a: any) => a.name || "").filter(Boolean)
        : [];

      const url = `https://chemrxiv.org/engage/chemrxiv/article-details/${id}`;

      results.push({
        title,
        url,
        snippet: (item.description || "").slice(0, 300),
        source: "chemrxiv",
        sourceId: id,
        year: item.publishedDate
          ? item.publishedDate.slice(0, 4)
          : undefined,
        doi: doi || undefined,
        dedupKey: `chemrxiv:${id}`,
        extra: {
          authors,
          publishedDate: item.publishedDate || "",
        },
      });
    }

    return results;
  }
}
