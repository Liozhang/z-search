/**
 * EpoPatentAdapter — 欧洲专利局（EPO Open Patent Services）专利检索源。
 *
 * OPS 3.2 REST API，OAuth2 client_credentials 鉴权（复用 EpoOAuthClient）。
 * 覆盖 EP 族专利与全球同族，含被引数据（published-data 端点）。
 *
 * 免费配额：EPO OPS 免费版每周 4GB 流量 / 每分钟 ~4 请求，生产级需申请
 * Fair Use 级 key。consumerKey/consumerSecret 在 prefs 配置。
 *
 * 返回的 DomainResult 用归一化专利号（PatentNumberNormalizer）作 dedupKey，
 * 跨源去重与库内比对（Zotero.Search by patentNumber）共用该键。
 *
 * @module core/sources/patent-search/epo
 */

import { DomainSourceAdapter } from "../../search/DomainSourceAdapter";
import type { DomainResult, DomainFilters } from "../../search/domainTypes";
import { normalizePatentNumber } from "../../patent/PatentNumberNormalizer";
import {
  isEpoConfigured,
  getEpoAccessToken,
} from "../../patent/EpoOAuthClient";
import { ZSEARCH_HTTP_HEADERS } from "../../../utils/httpHeaders";
import { safeDebug } from "../../../utils/logger";
import { toErrorMessage } from "../../../utils/error";

/** EPO OPS published-data 检索端点（全文检索 bibliographic）。 */
const EPO_SEARCH_URL =
  "https://ops.epo.org/3.2/rest-services/published-data/search/biblio";

export class EpoPatentAdapter extends DomainSourceAdapter {
  readonly id = "epo";
  readonly domainId = "patent";
  readonly label = "EPO Open Patent Services";
  readonly noKey = false;

  async isAvailable() {
    if (isEpoConfigured()) return { available: true };
    return {
      available: false,
      reason: "not-configured",
    };
  }

  async search(
    query: string,
    maxResults: number,
    filters?: DomainFilters,
  ): Promise<DomainResult[]> {
    const token = await getEpoAccessToken();

    // 构造 CQL 查询：标题或摘要包含关键词；年份范围过滤
    const yearClause = filters?.year
      ? ` AND pd within "${filters.year.replace("-", " ")}"` // OPS 年份语法 "2020 2024"
      : "";
    const cql = `txt="${query.replace(/"/g, "")}"${yearClause}`;

    const rangeEnd = Math.min(maxResults, 25); // OPS 单页上限 100，保守取 25
    const url = `${EPO_SEARCH_URL}?q=${encodeURIComponent(cql)}&Range=1-${rangeEnd}`;

    const resp = await Zotero.HTTP.request("GET", url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...ZSEARCH_HTTP_HEADERS,
      },
      timeout: 20000,
      errorDelayMax: 0,
    } as any);

    if (resp.status >= 400) {
      throw new Error(`EPO OPS error: HTTP ${resp.status}`);
    }

    let data: any;
    try {
      data = JSON.parse(resp.responseText || "");
    } catch (e) {
      throw new Error(`EPO OPS invalid JSON: ${toErrorMessage(e)}`, {
        cause: e,
      });
    }

    // OPS 返回结构：ops:world-patent-data → ops:biblio-search → ops:search-result
    // → exchange:documents → exchange:document（数组或单值）
    const documents =
      data?.["ops:world-patent-data"]?.["ops:biblio-search"]?.[
        "ops:search-result"
      ]?.["exchange:documents"]?.["exchange:document"] || [];

    const docs = Array.isArray(documents) ? documents : [documents];
    const results: DomainResult[] = [];

    for (const doc of docs.slice(0, maxResults)) {
      const parsed = this.parseDocument(doc);
      if (parsed) results.push(parsed);
    }

    return results;
  }

  /** 解析 OPS 单条 document 为 DomainResult。 */
  private parseDocument(doc: any): DomainResult | null {
    try {
      const bib = doc?.["exchange:bibliographic-data"];
      if (!bib) return null;

      // 专利号：@doc-number + @country + @kind
      const country = doc?.["@country"] || "";
      const docNumber = doc?.["@doc-number"] || "";
      const kind = doc?.["@kind"] || "";
      if (!country || !docNumber) return null;

      const patentNumber = normalizePatentNumber(
        `${country}${docNumber}${kind}`,
      );
      if (!patentNumber) return null;

      // 标题：invention-title 数组或单值
      const titleEl = bib?.["exchange:invention-title"];
      const title = Array.isArray(titleEl)
        ? titleEl[0]?.["$"] || ""
        : titleEl?.["$"] || "";

      // 申请人：applicants → applicant → applicant-name → name
      const applicantsEl = bib?.["exchange:parties"]?.["exchange:applicants"];
      const applicantEls = applicantsEl?.["exchange:applicant"] || [];
      const applicants = (
        Array.isArray(applicantEls) ? applicantEls : [applicantEls]
      )
        .map((a: any) => {
          const name =
            a?.["exchange:applicant-data"]?.["exchange:applicant-name"];
          if (!name) return "";
          if (Array.isArray(name)) {
            return name[0]?.name?.["$"] || name[0]?.name || "";
          }
          return name.name?.["$"] || name.name || "";
        })
        .filter(Boolean);

      // 发明人：inventors → inventor → inventor-name
      const inventorsEl = bib?.["exchange:parties"]?.["exchange:inventors"];
      const inventorEls = inventorsEl?.["exchange:inventor"] || [];
      const inventors = (
        Array.isArray(inventorEls) ? inventorEls : [inventorEls]
      )
        .map((inv: any) => {
          const name =
            inv?.["exchange:inventor-data"]?.["exchange:inventor-name"];
          if (!name) return "";
          if (Array.isArray(name)) {
            return name[0]?.name?.["$"] || name[0]?.name || "";
          }
          return name.name?.["$"] || name.name || "";
        })
        .filter(Boolean);

      // 日期：application-reference → document-id → date
      const appRef = bib?.["exchange:application-reference"];
      const appDate =
        appRef?.["document-id"]?.["date"]?.["$"] ||
        appRef?.["document-id"]?.date ||
        "";

      // 摘要：abstract → p（数组或单值）
      const abstractEl = bib?.["exchange:abstract"];
      const abstract = Array.isArray(abstractEl)
        ? abstractEl[0]?.p?.["$"] || abstractEl[0]?.p || ""
        : abstractEl?.p?.["$"] || abstractEl?.p || "";

      // IPC 分类：classifications-ipcr → classification-ipcr → text
      const ipcEl = bib?.["exchange:classifications-ipcr"];
      const ipcClasses: string[] = [];
      if (ipcEl?.["classification-ipcr"]) {
        const classifications = Array.isArray(ipcEl["classification-ipcr"])
          ? ipcEl["classification-ipcr"]
          : [ipcEl["classification-ipcr"]];
        for (const c of classifications) {
          const section = c?.section?.["$"] || c?.section || "";
          const cls = c?.["class"]?.["$"] || c?.["class"] || "";
          const subclass = c?.subclass?.["$"] || c?.subclass || "";
          if (section && cls) {
            ipcClasses.push(`${section}${cls}${subclass}`.trim());
          }
        }
      }

      const url = `https://worldwide.espacenet.com/patent/search?q=${country}${docNumber}`;

      return {
        title: title || `${country}${docNumber}`,
        url,
        snippet: abstract.slice(0, 300),
        source: "epo",
        sourceId: `${country}-${docNumber}`,
        year: appDate ? appDate.slice(0, 4) : undefined,
        patentNumber,
        dedupKey: patentNumber,
        extra: {
          country,
          docNumber,
          kind,
          applicants,
          inventors,
          applicationDate: appDate,
          ipcClasses,
        },
      };
    } catch (e) {
      safeDebug(`[z-search] EpoPatentAdapter.parseDocument failed: ${e}`);
      return null;
    }
  }
}
