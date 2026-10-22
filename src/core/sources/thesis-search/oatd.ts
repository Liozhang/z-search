/**
 * OatdAdapter — OATD (Open Access Theses and Dissertations) 检索源（免 key）。
 *
 * OATD 是全球开放获取学位论文的索引数据库，免费、无需 key。
 * 端点：https://oatd.org/oatd/search?q=<query>（HTML 页面，需解析）
 *
 * 返回 DomainResult：
 *  - sourceId = OATD 内部 id
 *  - dedupKey = "oatd:" + sourceId
 *  - extra 含 author、degree、institution、date
 *
 * @module core/sources/thesis-search/oatd
 */

import { DomainSourceAdapter } from "../../search/DomainSourceAdapter";
import type { DomainResult, DomainFilters } from "../../search/domainTypes";
import { ZSEARCH_HTTP_HEADERS } from "../../../utils/httpHeaders";

const OATD_SEARCH = "https://oatd.org/oatd/search";

export class OatdAdapter extends DomainSourceAdapter {
  readonly id = "oatd";
  readonly domainId = "thesis";
  readonly label = "OATD";
  readonly noKey = true;

  async isAvailable() {
    return { available: true };
  }

  async search(
    query: string,
    maxResults: number,
    filters?: DomainFilters,
  ): Promise<DomainResult[]> {
    let url = `${OATD_SEARCH}?q=${encodeURIComponent(query)}`;
    if (filters?.year) {
      const [start, end] = filters.year.split("-");
      if (start && end) {
        url += `&year_from=${start}&year_to=${end}`;
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
      throw new Error(`OATD error: HTTP ${resp.status}`);
    }

    // 解析 HTML：OATD 结果页用 <div class="result"> 包裹每条记录
    const html = resp.responseText || "";
    const results: DomainResult[] = [];

    // 提取搜索结果条目：<a href="/oatd/...">title</a>
    const titleMatches = html.matchAll(
      /<a[^>]*href="(\/oatd\/[^"]+)"[^>]*>([^<]+)<\/a>/g,
    );

    const seen = new Set<string>();
    for (const match of titleMatches) {
      if (results.length >= maxResults) break;
      const href = match[1];
      const title = match[2].trim();
      if (!title || seen.has(href)) continue;
      seen.add(href);

      const sourceId = href.replace("/oatd/", "");
      const url = `https://oatd.org${href}`;

      results.push({
        title,
        url,
        snippet: "",
        source: "oatd",
        sourceId,
        dedupKey: `oatd:${sourceId}`,
        extra: {
          degree: "",
          institution: "",
        },
      });
    }

    return results;
  }
}
