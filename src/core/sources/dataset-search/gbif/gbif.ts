/**
 * GbifAdapter — GBIF (Global Biodiversity Information Facility) 检索源（免 key）。
 *
 * GBIF 是全球最大的生物多样性数据平台，免费 API。
 * 端点：/v1/species/search?q=<query>&limit=<n>
 *      /v1/occurrence/search?q=<query>&limit=<n>
 *
 * 返回 DomainResult：
 *  - sourceId = GBIF taxon key（如 "2480946"）
 *  - dedupKey = "gbif:" + sourceId
 *  - extra 含 scientificName、kingdom、phylum、class、order、family
 *
 * @module core/sources/dataset-search/gbif
 */

import { DomainSourceAdapter } from "../../../search/DomainSourceAdapter";
import type { DomainResult, DomainFilters } from "../../../search/domainTypes";
import { ZSEARCH_HTTP_HEADERS } from "../../../../utils/httpHeaders";
import { safeDebug } from "../../../../utils/logger";
import { toErrorMessage } from "../../../../utils/error";

const GBIF_API = "https://api.gbif.org/v1";

export class GbifAdapter extends DomainSourceAdapter {
  readonly id = "gbif";
  readonly domainId = "dataset";
  readonly label = "GBIF (Biodiversity)";
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
    const url = `${GBIF_API}/species/search?q=${encodeURIComponent(query)}&limit=${limit}`;

    const resp = await Zotero.HTTP.request("GET", url, {
      headers: {
        Accept: "application/json",
        ...ZSEARCH_HTTP_HEADERS,
      },
      timeout: 20000,
      errorDelayMax: 0,
    } as any);

    if (resp.status >= 400) {
      throw new Error(`GBIF API error: HTTP ${resp.status}`);
    }

    let data: any;
    try {
      data = JSON.parse(resp.responseText || "{}");
    } catch (e) {
      throw new Error(`GBIF API invalid JSON: ${toErrorMessage(e)}`);
    }

    const species: any[] = data.results || [];
    const results: DomainResult[] = [];

    for (const sp of species.slice(0, maxResults)) {
      const key = String(sp.key || "");
      if (!key) continue;

      const scientificName = sp.scientificName || "";
      if (!scientificName) continue;

      const url = `https://www.gbif.org/species/${key}`;

      results.push({
        title: scientificName,
        url,
        snippet: (sp.vernacularName || "").slice(0, 300),
        source: "gbif",
        sourceId: key,
        dedupKey: `gbif:${key}`,
        extra: {
          scientificName,
          canonicalName: sp.canonicalName || "",
          kingdom: sp.kingdom || "",
          phylum: sp.phylum || "",
          order: sp.order || "",
          family: sp.family || "",
          genus: sp.genus || "",
          species: sp.species || "",
          rank: sp.rank || "",
          status: sp.status || "",
        },
      });
    }

    return results;
  }

  async profile(sourceId: string): Promise<DomainResult | null> {
    const url = `${GBIF_API}/species/${sourceId}`;
    const resp = await Zotero.HTTP.request("GET", url, {
      headers: {
        Accept: "application/json",
        ...ZSEARCH_HTTP_HEADERS,
      },
      timeout: 15000,
      errorDelayMax: 0,
    } as any);

    if (resp.status >= 400) return null;

    let sp: any;
    try {
      sp = JSON.parse(resp.responseText || "{}");
    } catch {
      return null;
    }

    if (!sp?.key) return null;

    return {
      title: sp.scientificName || sourceId,
      url: `https://www.gbif.org/species/${sourceId}`,
      snippet: (sp.vernacularName || "").slice(0, 300),
      source: "gbif",
      sourceId,
      dedupKey: `gbif:${sourceId}`,
      extra: {
        scientificName: sp.scientificName || "",
        canonicalName: sp.canonicalName || "",
        kingdom: sp.kingdom || "",
        phylum: sp.phylum || "",
        order: sp.order || "",
        family: sp.family || "",
        genus: sp.genus || "",
        species: sp.species || "",
        rank: sp.rank || "",
        status: sp.status || "",
      },
    };
  }
}
