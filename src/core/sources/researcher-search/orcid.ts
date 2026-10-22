/**
 * OrcidAdapter — ORCID Public API 检索源（免 key）。
 *
 * ORCID 是全球研究者唯一标识符系统，Public API 免费、无需 key。
 * 端点：/v3.0/expanded-search/?q=<query>（姓名检索）
 *      /v3.0/<orcid>/record（详情 profile）
 *
 * 返回 DomainResult：
 *  - sourceId = ORCID iD（如 "0000-0002-1825-0097"）
 *  - dedupKey = "orcid:" + sourceId
 *  - extra 含 givenName、familyName、works 数量、机构归属
 *
 * @module core/sources/researcher-search/orcid
 */

import { DomainSourceAdapter } from "../../search/DomainSourceAdapter";
import type { DomainResult, DomainFilters } from "../../search/domainTypes";
import { ZSEARCH_HTTP_HEADERS } from "../../../utils/httpHeaders";
import { safeDebug } from "../../../utils/logger";
import { toErrorMessage } from "../../../utils/error";

const ORCID_API = "https://pub.orcid.org/v3.0";

export class OrcidAdapter extends DomainSourceAdapter {
  readonly id = "orcid";
  readonly domainId = "researcher";
  readonly label = "ORCID";
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
    const url = `${ORCID_API}/expanded-search/?q=${encodeURIComponent(query)}&rows=${limit}`;

    const resp = await Zotero.HTTP.request("GET", url, {
      headers: {
        Accept: "application/json",
        ...ZSEARCH_HTTP_HEADERS,
      },
      timeout: 15000,
      errorDelayMax: 0,
    } as any);

    if (resp.status >= 400) {
      throw new Error(`ORCID API error: HTTP ${resp.status}`);
    }

    let data: any;
    try {
      data = JSON.parse(resp.responseText || "{}");
    } catch (e) {
      throw new Error(`ORCID API invalid JSON: ${toErrorMessage(e)}`);
    }

    const results_data: any[] = data["expanded-result"] || [];
    const results: DomainResult[] = [];

    for (const item of results_data.slice(0, maxResults)) {
      const orcidId = item["orcid-id"] || "";
      if (!orcidId) continue;

      const givenName = item["given-names"] || "";
      const familyName = item["family-names"] || "";
      const displayName = `${givenName} ${familyName}`.trim() || orcidId;

      const url = `https://orcid.org/${orcidId}`;

      results.push({
        title: displayName,
        url,
        snippet: item["institution-name"]?.[0] || "",
        source: "orcid",
        sourceId: orcidId,
        dedupKey: `orcid:${orcidId}`,
        extra: {
          orcid: orcidId,
          givenName,
          familyName,
          institutions: Array.isArray(item["institution-name"])
            ? item["institution-name"]
            : [],
        },
      });
    }

    return results;
  }

  async profile(sourceId: string): Promise<DomainResult | null> {
    const url = `${ORCID_API}/${sourceId}/record`;
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

    const person = data?.person || {};
    const name = person?.name || {};
    const givenName = name["given-names"]?.value || "";
    const familyName = name["family-name"]?.value || "";
    const displayName = `${givenName} ${familyName}`.trim() || sourceId;

    // 机构归属
    const employments = person?.employments?.["employment-summary"] || [];
    const institutions = employments
      .map((emp: any) => emp?.organization?.name || "")
      .filter(Boolean);

    // 作品数量
    const works =
      data?.["activities-summary"]?.works?.group?.length ?? 0;

    return {
      title: displayName,
      url: `https://orcid.org/${sourceId}`,
      snippet: institutions[0] || "",
      source: "orcid",
      sourceId,
      dedupKey: `orcid:${sourceId}`,
      metrics: {
        works,
      },
      extra: {
        orcid: sourceId,
        givenName,
        familyName,
        institutions,
      },
    };
  }
}
