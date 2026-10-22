/**
 * NasaAdsAdapter — NASA Astrophysics Data System 检索源（需 token）。
 *
 * NASA ADS 是天体物理/物理学领域最大的文献数据库，免费 API 需注册 token。
 * 端点：/v1/search/query?q=<query>&fl=<fields>&rows=<n>
 *
 * token 在 https://ui.adsabs.harvard.edu/user/settings/token 免费注册。
 *
 * 返回 DomainResult：
 *  - sourceId = ADS bibcode（如 "2021ApJ...910....1A"）
 *  - dedupKey = "ads:" + sourceId
 *  - extra 含 authors、citationCount、pubdate
 *
 * @module core/sources/physics-search/ads/ads
 */

import { DomainSourceAdapter } from "../../../search/DomainSourceAdapter";
import type { DomainResult, DomainFilters } from "../../../search/domainTypes";
import { getPrefDynamic } from "../../../../utils/prefs";
import { ZSEARCH_HTTP_HEADERS } from "../../../../utils/httpHeaders";

const ADS_API = "https://api.adsabs.harvard.edu/v1/search/query";

export class NasaAdsAdapter extends DomainSourceAdapter {
  readonly id = "nasa-ads";
  readonly domainId = "physics";
  readonly label = "NASA ADS";
  readonly noKey = false;

  async isAvailable() {
    const token = getPrefDynamic("search.physics.adsApiToken") as string;
    if (token) return { available: true };
    return { available: false, reason: "not-configured" };
  }

  async search(
    query: string,
    maxResults: number,
    _filters?: DomainFilters,
  ): Promise<DomainResult[]> {
    const token = getPrefDynamic("search.physics.adsApiToken") as string;
    if (!token) {
      throw new Error("NASA ADS API token not configured");
    }

    const limit = Math.min(maxResults, 100);
    const fields = "bibcode,title,author,citation_count,pubdate,doi";
    const url = `${ADS_API}?q=${encodeURIComponent(query)}&fl=${fields}&rows=${limit}`;

    const resp = await Zotero.HTTP.request("GET", url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...ZSEARCH_HTTP_HEADERS,
      },
      timeout: 20000,
      errorDelayMax: 0,
    } as any);

    if (resp.status >= 400) {
      throw new Error(`NASA ADS API error: HTTP ${resp.status}`);
    }

    let data: any;
    try {
      data = JSON.parse(resp.responseText || "{}");
    } catch {
      return [];
    }

    const docs: any[] = data.response?.docs || [];
    const results: DomainResult[] = [];

    for (const doc of docs.slice(0, maxResults)) {
      const bibcode = doc.bibcode || "";
      if (!bibcode) continue;

      const title = Array.isArray(doc.title) ? doc.title[0] || "" : "";
      if (!title) continue;

      const authors: string[] = Array.isArray(doc.author) ? doc.author : [];

      const url = `https://ui.adsabs.harvard.edu/abs/${bibcode}/abstract`;

      results.push({
        title,
        url,
        snippet: "",
        source: "nasa-ads",
        sourceId: bibcode,
        year: doc.pubdate ? doc.pubdate.slice(0, 4) : undefined,
        dedupKey: `ads:${bibcode}`,
        metrics: {
          citations: doc.citation_count ?? 0,
        },
        extra: {
          authors,
          bibcode,
          doi: Array.isArray(doc.doi) ? doc.doi[0] : undefined,
        },
      });
    }

    return results;
  }

  async profile(_sourceId: string): Promise<DomainResult | null> {
    return null;
  }
}
