/**
 * SocArxivAdapter — SocArXiv 预印本检索源（免 key）。
 *
 * SocArXiv 是社会科学领域预印本服务器，基于 OSF (Open Science Framework) API。
 * 端点：/v2/nodes/<node_id>/preprints/ 或 OSF 搜索 API。
 *
 * 返回 DomainResult：
 *  - sourceId = OSF preprint id
 *  - dedupKey = "socarxiv:" + sourceId
 *  - extra 含 authors、publishedDate、DOI
 *
 * @module core/sources/preprint-search/socarxiv
 */

import { DomainSourceAdapter } from "../../search/DomainSourceAdapter";
import type { DomainResult, DomainFilters } from "../../search/domainTypes";
import { ZSEARCH_HTTP_HEADERS } from "../../../utils/httpHeaders";
import { safeDebug } from "../../../utils/logger";
import { toErrorMessage } from "../../../utils/error";

const SOCARXIV_API = "https://api.osf.io/v2/preprints/";

export class SocArxivAdapter extends DomainSourceAdapter {
  readonly id = "socarxiv";
  readonly domainId = "preprint";
  readonly label = "SocArXiv";
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
    const url = `${SOCARXIV_API}?filter[provider]=socarxiv&filter[q]=${encodeURIComponent(query)}&page[size]=${limit}`;

    const resp = await Zotero.HTTP.request("GET", url, {
      headers: {
        Accept: "application/vnd.api+json",
        ...ZSEARCH_HTTP_HEADERS,
      },
      timeout: 20000,
      errorDelayMax: 0,
    } as any);

    if (resp.status >= 400) {
      throw new Error(`SocArXiv API error: HTTP ${resp.status}`);
    }

    let data: any;
    try {
      data = JSON.parse(resp.responseText || "{}");
    } catch (e) {
      throw new Error(`SocArXiv API invalid JSON: ${toErrorMessage(e)}`);
    }

    const items: any[] = data.data || [];
    const results: DomainResult[] = [];

    for (const item of items.slice(0, maxResults)) {
      const id = item.id || "";
      if (!id) continue;

      const attrs = item.attributes || {};
      const title = attrs.title || "";
      if (!title) continue;

      const doi = attrs.doi || "";
      const authors: string[] = Array.isArray(attrs.bibliographic_contributors)
        ? attrs.bibliographic_contributors
            .map((c: any) => c.users?.[0]?.full_name || "")
            .filter(Boolean)
        : [];

      const url = `https://osf.io/preprints/socarxiv/${id}`;

      results.push({
        title,
        url,
        snippet: (attrs.description || "").slice(0, 300),
        source: "socarxiv",
        sourceId: id,
        year: attrs.date_published
          ? attrs.date_published.slice(0, 4)
          : undefined,
        doi: doi || undefined,
        dedupKey: `socarxiv:${id}`,
        extra: {
          authors,
          publishedDate: attrs.date_published || "",
        },
      });
    }

    return results;
  }
}
