/**
 * UsptoPatentAdapter — USPTO PatentsView API 检索源（免 key）。
 *
 * PatentsView 是 USPTO 运营的免费专利数据 API，覆盖美国专利全量。
 * 端点：/api/v1/patent/?q=<query>&f=<fields>&o=<options>
 *
 * 免费配额：无 key 限制，但建议遵守 USPTO 的公平使用政策。
 *
 * 返回 DomainResult：
 *  - sourceId = USPTO patent id
 *  - dedupKey = 归一化专利号（复用 PatentNumberNormalizer）
 *  - extra 含 assignee、inventor、cpc、被引次数
 *
 * @module core/sources/patent-search/uspto
 */

import { DomainSourceAdapter } from "../../search/DomainSourceAdapter";
import type { DomainResult, DomainFilters } from "../../search/domainTypes";
import { normalizePatentNumber } from "../../patent/PatentNumberNormalizer";
import { ZSEARCH_HTTP_HEADERS } from "../../../utils/httpHeaders";
import { toErrorMessage } from "../../../utils/error";

const USPTO_API = "https://search.patentsview.org/api/v1/patent/";

export class UsptoPatentAdapter extends DomainSourceAdapter {
  readonly id = "uspto";
  readonly domainId = "patent";
  readonly label = "USPTO PatentsView";
  readonly noKey = true;

  async isAvailable() {
    return { available: true };
  }

  async search(
    query: string,
    maxResults: number,
    filters?: DomainFilters,
  ): Promise<DomainResult[]> {
    // PatentsView 查询语法：{"_text_any": {"patent_title": "query"}}
    const qObj: Record<string, any> = {
      _text_any: { patent_title: query },
    };

    // 年份过滤
    if (filters?.year) {
      const [start, end] = filters.year.split("-");
      if (start && end) {
        qObj._and = [
          { _gte: { patent_date: `${start}-01-01` } },
          { _lte: { patent_date: `${end}-12-31` } },
        ];
      }
    }

    const url = `${USPTO_API}?q=${encodeURIComponent(JSON.stringify(qObj))}&f=["patent_id","patent_title","patent_date","assignee_organization","inventor_first_name","inventor_last_name","cpc_subgroup_id","cited_patent_number"]&o={"per_page":${Math.min(maxResults, 100)},"page":1}`;

    const resp = await Zotero.HTTP.request("GET", url, {
      headers: {
        Accept: "application/json",
        ...ZSEARCH_HTTP_HEADERS,
      },
      timeout: 20000,
      errorDelayMax: 0,
    } as any);

    if (resp.status >= 400) {
      throw new Error(`USPTO PatentsView API error: HTTP ${resp.status}`);
    }

    let data: any;
    try {
      data = JSON.parse(resp.responseText || "{}");
    } catch (e) {
      throw new Error(
        `USPTO PatentsView API invalid JSON: ${toErrorMessage(e)}`,
        { cause: e },
      );
    }

    const patents: any[] = data.patents || [];
    const results: DomainResult[] = [];

    for (const patent of patents.slice(0, maxResults)) {
      const patentId = patent.patent_id || "";
      if (!patentId) continue;

      // 构造 US 专利号：US + patent_id
      const rawNumber = `US${patentId}`;
      const patentNumber = normalizePatentNumber(rawNumber);
      if (!patentNumber) continue;

      // 申请人：assignee_organization 数组或单值
      const assignee = Array.isArray(patent.assignee_organization)
        ? patent.assignee_organization[0]
        : patent.assignee_organization || "";

      // 发明人：inventor_first_name + inventor_last_name
      const inventors: string[] = [];
      if (patent.inventor_first_name && patent.inventor_last_name) {
        inventors.push(
          `${patent.inventor_first_name} ${patent.inventor_last_name}`,
        );
      }

      // CPC 分类：cpc_subgroup_id 数组
      const cpcs: string[] = Array.isArray(patent.cpc_subgroup_id)
        ? patent.cpc_subgroup_id.slice(0, 5)
        : [];

      // 被引专利数：cited_patent_number 数组长度
      const citationCount = Array.isArray(patent.cited_patent_number)
        ? patent.cited_patent_number.length
        : 0;

      const url = `https://patents.google.com/patent/US${patentId}/en`;

      results.push({
        title: patent.patent_title || `US${patentId}`,
        url,
        snippet: "",
        source: "uspto",
        sourceId: patentId,
        year: patent.patent_date ? patent.patent_date.slice(0, 4) : undefined,
        patentNumber,
        dedupKey: patentNumber,
        metrics: {
          citations: citationCount,
        },
        extra: {
          country: "US",
          docNumber: patentId,
          applicants: assignee ? [assignee] : [],
          inventors,
          ipcClasses: cpcs,
          publicationDate: patent.patent_date || "",
        },
      });
    }

    return results;
  }
}
