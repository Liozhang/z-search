/**
 * WipoPatentAdapter — WIPO PATENTSCOPE 检索源（免 key）。
 *
 * PATENTSCOPE 是 WIPO 运营的免费专利检索平台，覆盖 PCT 国际申请。
 * 端点：/search/result.jsf?query=<query>（HTML 页面，需解析）
 *
 * 免 key 兜底源：PCT 专利覆盖，与 EPO/USPTO 互补。
 * HTML 解析方式：抓取搜索结果页，提取专利卡片列表。
 *
 * 返回 DomainResult：
 *  - sourceId = WO 专利号（如 "WO2020123456"）
 *  - dedupKey = 归一化专利号（复用 PatentNumberNormalizer）
 *
 * @module core/sources/patent-search/wipo
 */

import { DomainSourceAdapter } from "../../search/DomainSourceAdapter";
import type { DomainResult, DomainFilters } from "../../search/domainTypes";
import { normalizePatentNumber } from "../../patent/PatentNumberNormalizer";
import { ZSEARCH_HTTP_HEADERS } from "../../../utils/httpHeaders";
import { safeDebug } from "../../../utils/logger";
import { toErrorMessage } from "../../../utils/error";

const WIPO_SEARCH = "https://patentscope.wipo.int/search/en/result.jsf";

export class WipoPatentAdapter extends DomainSourceAdapter {
  readonly id = "wipo";
  readonly domainId = "patent";
  readonly label = "WIPO PATENTSCOPE";
  readonly noKey = true;

  async isAvailable() {
    return { available: true };
  }

  async search(
    query: string,
    maxResults: number,
    filters?: DomainFilters,
  ): Promise<DomainResult[]> {
    // PATENTSCOPE 搜索 URL：query 参数 + 可选年份过滤
    let url = `${WIPO_SEARCH}?query=${encodeURIComponent(query)}`;
    if (filters?.year) {
      const [start, end] = filters.year.split("-");
      if (start && end) {
        url += `&dateFilter=DP:${start}0101-${end}1231`;
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
      timeout: 20000,
      errorDelayMax: 0,
    } as any);

    if (resp.status >= 400) {
      throw new Error(`WIPO PATENTSCOPE error: HTTP ${resp.status}`);
    }

    // 解析 HTML：PATENTSCOPE 结果页用 <span class="ps-patent-number"> 标记专利号
    const html = resp.responseText || "";
    const results: DomainResult[] = [];

    // 正则提取专利号链接：<a href="/search/en/detail.jsf?docId=WO...">
    const docIdMatches = html.matchAll(
      /docId=([A-Z]{2}\d+[A-Z]?\d*)/g,
    );

    const seen = new Set<string>();
    for (const match of docIdMatches) {
      if (results.length >= maxResults) break;
      const docId = match[1];
      if (!docId || seen.has(docId)) continue;
      seen.add(docId);

      const patentNumber = normalizePatentNumber(docId);
      if (!patentNumber) continue;

      const url = `https://patentscope.wipo.int/search/en/detail.jsf?docId=${docId}`;

      results.push({
        title: docId,
        url,
        snippet: "",
        source: "wipo",
        sourceId: docId,
        dedupKey: patentNumber,
        extra: {
          country: docId.slice(0, 2),
          docNumber: docId.slice(2),
          publicationNumber: docId,
        },
      });
    }

    return results;
  }
}
