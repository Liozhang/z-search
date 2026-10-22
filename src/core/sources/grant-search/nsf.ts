/**
 * NsfGrantAdapter — NSF Award Search API 检索源（免 key）。
 *
 * NSF Award Search API 免费、无需 key，覆盖美国国家科学基金会资助项目。
 * 端点：/awards.json?keyword=<query>&printFields=<fields>&offset=0&rpp=<n>
 *
 * 返回 DomainResult：
 *  - sourceId = NSF award id（如 "2048321"）
 *  - dedupKey = "nsf:" + id
 *  - extra 含 PI、机构、金额、执行期、状态
 *
 * 与 grant 域的 importItemType = "note" 联动（Zotero note 条目 + Extra
 * 字段写入基金编号、PI、机构、金额、执行期）。
 *
 * @module core/sources/grant-search/nsf
 */

import { DomainSourceAdapter } from "../../search/DomainSourceAdapter";
import type { DomainResult, DomainFilters } from "../../search/domainTypes";
import { ZSEARCH_HTTP_HEADERS } from "../../../utils/httpHeaders";
import { toErrorMessage } from "../../../utils/error";

const NSF_API = "https://api.nsf.gov/services/v1/awards.json";

export class NsfGrantAdapter extends DomainSourceAdapter {
  readonly id = "nsf";
  readonly domainId = "grant";
  readonly label = "NSF Awards";
  readonly noKey = true;

  async isAvailable() {
    return { available: true };
  }

  async search(
    query: string,
    maxResults: number,
    filters?: DomainFilters,
  ): Promise<DomainResult[]> {
    const rpp = Math.min(maxResults, 25); // NSF 单页上限 25
    let url = `${NSF_API}?keyword=${encodeURIComponent(query)}&rpp=${rpp}`;

    // 年份过滤：awardDate range
    if (filters?.year) {
      const [start, end] = filters.year.split("-");
      if (start && end) {
        url += `&startDateStart=${start}-01-01&startDateEnd=${end}-12-31`;
      }
    }

    const resp = await Zotero.HTTP.request("GET", url, {
      headers: {
        Accept: "application/json",
        ...ZSEARCH_HTTP_HEADERS,
      },
      timeout: 20000,
      errorDelayMax: 0,
    } as any);

    if (resp.status >= 400) {
      throw new Error(`NSF API error: HTTP ${resp.status}`);
    }

    let data: any;
    try {
      data = JSON.parse(resp.responseText || "{}");
    } catch (e) {
      throw new Error(`NSF API invalid JSON: ${toErrorMessage(e)}`, {
        cause: e,
      });
    }

    const awards: any[] = data.response?.award || [];
    const results: DomainResult[] = [];

    for (const award of awards.slice(0, maxResults)) {
      const id = String(award.id || "");
      if (!id) continue;

      const title = award.title || "";
      if (!title) continue;

      const url = `https://www.nsf.gov/awardsearch/showAward?AWD_ID=${id}`;

      results.push({
        title,
        url,
        snippet: (award.abstractText || "").slice(0, 300),
        source: "nsf",
        sourceId: id,
        year: award.startDate ? award.startDate.slice(0, 4) : undefined,
        dedupKey: `nsf:${id}`,
        metrics: {
          amount: award.fundsObligatedAmt ? Number(award.fundsObligatedAmt) : 0,
        },
        extra: {
          pi: award.pdPIName || "",
          institution: award.awardeeName || "",
          fundingAgency: "NSF",
          country: "US",
          startDate: award.startDate || "",
          endDate: award.expDate || "",
          status: award.status || "",
        },
      });
    }

    return results;
  }

  async profile(sourceId: string): Promise<DomainResult | null> {
    const url = `${NSF_API}?id=${sourceId}`;
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

    const award = data.response?.award?.[0];
    if (!award) return null;

    return {
      title: award.title || sourceId,
      url: `https://www.nsf.gov/awardsearch/showAward?AWD_ID=${sourceId}`,
      snippet: (award.abstractText || "").slice(0, 300),
      source: "nsf",
      sourceId,
      year: award.startDate ? award.startDate.slice(0, 4) : undefined,
      dedupKey: `nsf:${sourceId}`,
      metrics: {
        amount: award.fundsObligatedAmt ? Number(award.fundsObligatedAmt) : 0,
      },
      extra: {
        pi: award.pdPIName || "",
        institution: award.awardeeName || "",
        fundingAgency: "NSF",
        country: "US",
        startDate: award.startDate || "",
        endDate: award.expDate || "",
        status: award.status || "",
      },
    };
  }
}
