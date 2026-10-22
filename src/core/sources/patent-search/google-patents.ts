/**
 * GooglePatentsAdapter — Google Patents 公开页检索源（无 key）。
 *
 * Google Patents 无公开 API，本适配器走 XHR/HTML 抓取 + JSON 内嵌数据解析：
 * 专利详情页 /patent/<id> 的 <script type="application/ld+json"> 携带结构化
 * 元数据；搜索结果页 /?q=<query> 的 <script id="metadata"> 含全部命中。
 *
 * 免 key 兜底源：EPO 未配置时自动生效（isAvailable 恒 true）。
 * 抓取频率受 Google 限流约束，缓存由 caller 侧控制；本适配器只负责单次检索。
 *
 * 返回 DomainResult 用归一化专利号作 dedupKey，与 EPO 适配器同口径。
 *
 * @module core/sources/patent-search/google-patents
 */

import { DomainSourceAdapter } from "../../search/DomainSourceAdapter";
import type { DomainResult, DomainFilters } from "../../search/domainTypes";
import { normalizePatentNumber } from "../../patent/PatentNumberNormalizer";
import { ZSEARCH_HTTP_HEADERS } from "../../../utils/httpHeaders";
import { safeDebug } from "../../../utils/logger";
import { toErrorMessage } from "../../../utils/error";

const GOOGLE_PATENTS_SEARCH = "https://patents.google.com/";

export class GooglePatentsAdapter extends DomainSourceAdapter {
  readonly id = "google-patents";
  readonly domainId = "patent";
  readonly label = "Google Patents";
  readonly noKey = true;

  async isAvailable() {
    return { available: true };
  }

  async search(
    query: string,
    maxResults: number,
    filters?: DomainFilters,
  ): Promise<DomainResult[]> {
    // 搜索页 URL：/?q=<query>&after=priority:20200101（年份过滤语法）
    let url = `${GOOGLE_PATENTS_SEARCH}?q=${encodeURIComponent(query)}`;
    if (filters?.year) {
      const [start, end] = filters.year.split("-");
      if (start && end) {
        url += `&after=priority:${start}0101&before=priority:${end}1231`;
      }
    }

    const resp = await Zotero.HTTP.request("GET", url, {
      headers: {
        Accept: "text/html",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        ...ZSEARCH_HTTP_HEADERS,
      },
      timeout: 15000,
      errorDelayMax: 0,
    } as any);

    if (resp.status >= 400) {
      throw new Error(`Google Patents error: HTTP ${resp.status}`);
    }

    // 解析 <script id="metadata"> 内嵌 JSON（搜索结果页的标准结构）
    const html = resp.responseText || "";
    const metadataMatch = html.match(
      /<script[^>]*id="metadata"[^>]*>([\s\S]*?)<\/script>/i,
    );
    if (!metadataMatch) {
      throw new Error(
        "Google Patents: metadata script not found (page structure changed or blocked)",
      );
    }

    let metadata: any;
    try {
      metadata = JSON.parse(metadataMatch[1]);
    } catch (e) {
      throw new Error(
        `Google Patents: metadata JSON parse failed: ${toErrorMessage(e)}`,
      );
    }

    // 搜索结果在 metadata.results.cluster[0].result[]
    const cluster = metadata?.results?.cluster?.[0];
    const items = cluster?.result || [];

    const results: DomainResult[] = [];
    for (const item of items.slice(0, maxResults)) {
      const patent = item?.patent;
      if (!patent) continue;

      // 专利号：patent.publication_number（如 "US-9999999-B2"）
      const pubNumber = patent.publication_number || "";
      const patentNumber = normalizePatentNumber(pubNumber);
      if (!patentNumber) continue;

      // 标题
      const title = patent.title || "";

      // 申请人 / assignee
      const assignee =
        patent.assignee || patent.applicant || "";

      // 摘要：snippet（搜索结果页通常带）
      const snippet = patent.snippet || patent.abstract || "";

      // 日期：filing_date / publication_date
      const filingDate = patent.filing_date || patent.priority_date || "";
      const pubDate = patent.publication_date || "";

      // IPC：patent.cpcs（数组，如 ["H04N23/60", ...]）
      const cpcs: string[] = Array.isArray(patent.cpcs)
        ? patent.cpcs.map((c: any) => c?.code || "").filter(Boolean)
        : [];

      // 链接
      const url = `https://patents.google.com/patent/${pubNumber}/en`;

      results.push({
        title,
        url,
        snippet: snippet.slice(0, 300),
        source: "google-patents",
        sourceId: pubNumber,
        year: pubDate ? pubDate.slice(0, 4) : filingDate ? filingDate.slice(0, 4) : undefined,
        patentNumber,
        dedupKey: patentNumber,
        extra: {
          publicationNumber: pubNumber,
          assignee,
          filingDate,
          publicationDate: pubDate,
          ipcClasses: cpcs,
          citationCount: patent.cited_by_count || patent.citation_count || 0,
        },
      });
    }

    return results;
  }

  async profile(sourceId: string): Promise<DomainResult | null> {
    // sourceId 形如 "US-9999999-B2"；详情页 /patent/<id>/en
    const url = `https://patents.google.com/patent/${sourceId}/en`;
    const resp = await Zotero.HTTP.request("GET", url, {
      headers: {
        Accept: "text/html",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        ...ZSEARCH_HTTP_HEADERS,
      },
      timeout: 15000,
      errorDelayMax: 0,
    } as any);

    if (resp.status >= 400) return null;

    // 详情页用 JSON-LD（application/ld+json）而非 metadata script
    const html = resp.responseText || "";
    const ldMatch = html.match(
      /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i,
    );
    if (!ldMatch) return null;

    let ld: any;
    try {
      ld = JSON.parse(ldMatch[1]);
    } catch {
      return null;
    }

    const patentNumber = normalizePatentNumber(sourceId);
    if (!patentNumber) return null;

    return {
      title: ld.name || ld.headline || "",
      url,
      snippet: (ld.description || ld.abstract || "").slice(0, 300),
      source: "google-patents",
      sourceId,
      year: ld.datePublished ? ld.datePublished.slice(0, 4) : undefined,
      patentNumber,
      dedupKey: patentNumber,
      extra: {
        inventor: Array.isArray(ld.inventor) ? ld.inventor : [ld.inventor].filter(Boolean),
        assignee: ld.assignee,
        filingDate: ld.dateFiled || "",
        publicationDate: ld.datePublished || "",
      },
    };
  }
}
