/**
 * IcpsrAdapter — ICPSR 社会科学数据检索源（免 key）。
 *
 * ICPSR（Inter-university Consortium for Political and Social Research）
 * 是全球最大的社会科学数据仓储之一，免费 API。
 * 端点：/api/v1/studies?q=<query>&rows=<n>
 *
 * 返回 DomainResult：
 *  - sourceId = ICPSR study id（如 "35218"）
 *  - dedupKey = "icpsr:" + sourceId
 *  - extra 含 authors、license、topics、geographicCoverage
 *
 * @module core/sources/social-science-search/icpsr
 */

import { DomainSourceAdapter } from "../../search/DomainSourceAdapter";
import type { DomainResult, DomainFilters } from "../../search/domainTypes";
import { ZSEARCH_HTTP_HEADERS } from "../../../utils/httpHeaders";
import { safeDebug } from "../../../utils/logger";
import { toErrorMessage } from "../../../utils/error";

const ICPSR_API = "https://www.icpsr.umich.edu/web/api/v1";

export class IcpsrAdapter extends DomainSourceAdapter {
  readonly id = "icpsr";
  readonly domainId = "social-science";
  readonly label = "ICPSR";
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
    const url = `${ICPSR_API}/studies?q=${encodeURIComponent(query)}&rows=${limit}`;

    const resp = await Zotero.HTTP.request("GET", url, {
      headers: {
        Accept: "application/json",
        ...ZSEARCH_HTTP_HEADERS,
      },
      timeout: 20000,
      errorDelayMax: 0,
    } as any);

    if (resp.status >= 400) {
      throw new Error(`ICPSR API error: HTTP ${resp.status}`);
    }

    let data: any;
    try {
      data = JSON.parse(resp.responseText || "{}");
    } catch (e) {
      throw new Error(`ICPSR API invalid JSON: ${toErrorMessage(e)}`);
    }

    const studies: any[] = data.data || data.studies || [];
    const results: DomainResult[] = [];

    for (const study of studies.slice(0, maxResults)) {
      const id = String(study.id || study.studyId || "");
      if (!id) continue;

      const title = study.title || study.name || "";
      if (!title) continue;

      const authors: string[] = Array.isArray(study.authors)
        ? study.authors.map((a: any) => a.name || "").filter(Boolean)
        : [];

      const url = `https://www.icpsr.umich.edu/web/ICPSR/studies/${id}`;

      results.push({
        title,
        url,
        snippet: (study.abstract || study.description || "").slice(0, 300),
        source: "icpsr",
        sourceId: id,
        year: study.dateOfPublication
          ? study.dateOfPublication.slice(0, 4)
          : undefined,
        dedupKey: `icpsr:${id}`,
        extra: {
          authors,
          license: study.license || "",
          topics: Array.isArray(study.topics) ? study.topics : [],
          geographicCoverage: study.geographicCoverage || "",
          timePeriod: study.timePeriod || "",
        },
      });
    }

    return results;
  }
}
