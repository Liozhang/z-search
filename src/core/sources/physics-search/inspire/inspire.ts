/**
 * InspireHepAdapter — INSPIRE-HEP 高能物理文献检索源（免 key）。
 *
 * INSPIRE-HEP 是高能物理领域的开放文献数据库，免费 API。
 * 端点：/api/literature?q=<query>&size=<n>&fields=<fields>
 *
 * 返回 DomainResult：
 *  - sourceId = INSPIRE record id
 *  - dedupKey = "inspire:" + sourceId
 *  - extra 含 authors、collaborations、arxivId、citationCount
 *
 * @module core/sources/physics-search/inspire
 */

import { DomainSourceAdapter } from "../../../search/DomainSourceAdapter";
import type { DomainResult, DomainFilters } from "../../../search/domainTypes";
import { ZSEARCH_HTTP_HEADERS } from "../../../../utils/httpHeaders";
import { safeDebug } from "../../../../utils/logger";
import { toErrorMessage } from "../../../../utils/error";

const INSPIRE_API = "https://inspirehep.net/api/literature";

export class InspireHepAdapter extends DomainSourceAdapter {
  readonly id = "inspire";
  readonly domainId = "physics";
  readonly label = "INSPIRE-HEP";
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
    const fields = "titles,authors,collaborations,arxiv_eprints,citation_count,publication_info,control_number";
    const url = `${INSPIRE_API}?q=${encodeURIComponent(query)}&size=${limit}&fields=${fields}`;

    const resp = await Zotero.HTTP.request("GET", url, {
      headers: {
        Accept: "application/json",
        ...ZSEARCH_HTTP_HEADERS,
      },
      timeout: 20000,
      errorDelayMax: 0,
    } as any);

    if (resp.status >= 400) {
      throw new Error(`INSPIRE-HEP API error: HTTP ${resp.status}`);
    }

    let data: any;
    try {
      data = JSON.parse(resp.responseText || "{}");
    } catch (e) {
      throw new Error(`INSPIRE-HEP API invalid JSON: ${toErrorMessage(e)}`);
    }

    const hits: any[] = data.hits?.hits || [];
    const results: DomainResult[] = [];

    for (const hit of hits.slice(0, maxResults)) {
      const meta = hit.metadata || {};
      const controlNumber = String(meta.control_number || "");
      if (!controlNumber) continue;

      const title = Array.isArray(meta.titles)
        ? meta.titles[0]?.title || ""
        : "";
      if (!title) continue;

      // 作者
      const authors: string[] = Array.isArray(meta.authors)
        ? meta.authors.map((a: any) => a.full_name || "").filter(Boolean)
        : [];

      // arXiv ID
      const arxivId = Array.isArray(meta.arxiv_eprints)
        ? meta.arxiv_eprints[0]?.value || ""
        : "";

      // 引用数
      const citationCount = meta.citation_count ?? 0;

      const url = `https://inspirehep.net/literature/${controlNumber}`;

      results.push({
        title,
        url,
        snippet: "",
        source: "inspire",
        sourceId: controlNumber,
        dedupKey: `inspire:${controlNumber}`,
        metrics: {
          citations: citationCount,
        },
        extra: {
          authors,
          arxivId,
          collaborations: Array.isArray(meta.collaborations)
            ? meta.collaborations.map((c: any) => c.value || "")
            : [],
        },
      });
    }

    return results;
  }

  async profile(sourceId: string): Promise<DomainResult | null> {
    const fields = "titles,authors,collaborations,arxiv_eprints,citation_count,publication_info,control_number";
    const url = `${INSPIRE_API}/${sourceId}?fields=${fields}`;
    const resp = await Zotero.HTTP.request("GET", url, {
      headers: {
        Accept: "application/json",
        ...ZSEARCH_HTTP_HEADERS,
      },
      timeout: 15000,
      errorDelayMax: 0,
    } as any);
    if (resp.status >= 400) return null;
    let data: any;
    try {
      data = JSON.parse(resp.responseText || "{}");
    } catch {
      return null;
    }
    const meta = data.metadata || {};
    const title = Array.isArray(meta.titles) ? meta.titles[0]?.title || "" : "";
    if (!title) return null;
    return {
      title,
      url: `https://inspirehep.net/literature/${sourceId}`,
      snippet: "",
      source: "inspire",
      sourceId,
      dedupKey: `inspire:${sourceId}`,
      metrics: { citations: meta.citation_count ?? 0 },
      extra: {
        authors: Array.isArray(meta.authors)
          ? meta.authors.map((a: any) => a.full_name || "").filter(Boolean)
          : [],
        arxivId: Array.isArray(meta.arxiv_eprints)
          ? meta.arxiv_eprints[0]?.value || ""
          : "",
      },
    };
  }
}
