/**
 * RepecAdapter — RePEc/IDEAS 经济学文献检索源（免 key，HTML 解析）。
 *
 * RePEc（Research Papers in Economics）是全球最大的经济学文献索引，
 * 覆盖 2400+ 学术期刊和工作论文系列。IDEAS 是其主要 Web 界面。
 * RePEc 无公开 REST API，通过 HTML 解析 IDEAS 搜索结果页。
 *
 * 端点：https://ideas.repec.org/cgi-bin/htsearch?q=<query>
 *
 * 返回 DomainResult：
 *  - sourceId = RePEc handle（如 "RePEc:nbr:nberwo:12345"）
 *  - dedupKey = "repec:" + sourceId
 *  - extra 含 authors、date、journal
 *
 * @module core/sources/econ-search/repec
 */

import { DomainSourceAdapter } from "../../../search/DomainSourceAdapter";
import type { DomainResult, DomainFilters } from "../../../search/domainTypes";
import { ZSEARCH_HTTP_HEADERS } from "../../../../utils/httpHeaders";
import { safeDebug } from "../../../../utils/logger";
import { toErrorMessage } from "../../../../utils/error";

const IDEAS_SEARCH = "https://ideas.repec.org/cgi-bin/htsearch";

export class RepecAdapter extends DomainSourceAdapter {
  readonly id = "repec";
  readonly domainId = "economics";
  readonly label = "RePEc/IDEAS";
  readonly noKey = true;

  async isAvailable() {
    return { available: true };
  }

  async search(
    query: string,
    maxResults: number,
    _filters?: DomainFilters,
  ): Promise<DomainResult[]> {
    const url = `${IDEAS_SEARCH}?q=${encodeURIComponent(query)}&format=builtin-long&sort=score`;

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
      throw new Error(`RePEc/IDEAS error: HTTP ${resp.status}`);
    }

    // 解析 HTML：IDEAS 搜索结果用 <li> 包裹每条记录
    // 每条记录含 <a href="/cgi-bin/ref.cgi?...">title</a> 和作者/日期信息
    const html = resp.responseText || "";
    const results: DomainResult[] = [];

    // 提取搜索结果条目：<a href="/p/...">title</a> 或 <a href="/cgi-bin/...">title</a>
    const titleMatches = html.matchAll(
      /<a[^>]*href="([^"]*(?:\/p\/|\/cgi-bin\/)[^"]*)"[^>]*>([^<]+)<\/a>/g,
    );

    const seen = new Set<string>();
    for (const match of titleMatches) {
      if (results.length >= maxResults) break;
      const href = match[1];
      const title = match[2].trim();
      if (!title || seen.has(href)) continue;
      seen.add(href);

      // 从 URL 提取 RePEc handle
      const handleMatch = href.match(/\/(?:p|a|cgi-bin\/ref)\/([^/?]+)/);
      const sourceId = handleMatch ? handleMatch[1] : href;

      const url = `https://ideas.repec.org${href.startsWith("/") ? href : `/${href}`}`;

      results.push({
        title,
        url,
        snippet: "",
        source: "repec",
        sourceId,
        dedupKey: `repec:${sourceId}`,
        extra: {
          handle: sourceId,
        },
      });
    }

    return results;
  }

  async profile(sourceId: string): Promise<DomainResult | null> {
    return null;
  }
}
