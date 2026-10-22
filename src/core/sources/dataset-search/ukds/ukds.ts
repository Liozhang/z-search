/**
 * UkDataServiceAdapter — UK Data Service 检索源（免 key）。
 *
 * UK Data Service 是英国最大的社会科学和经济数据集合，免费 API。
 * 端点：https://api.ukdataservice.ac.uk/v1/search?q=<query>
 *      （HTML 解析备选）
 *
 * 返回 DomainResult：
 *  - sourceId = UKDS study id（如 "854339"）
 *  - dedupKey = "ukds:" + sourceId
 *  - extra 含 title、publisher、topics、access
 *
 * @module core/sources/dataset-search/ukds
 */

import { DomainSourceAdapter } from "../../../search/DomainSourceAdapter";
import type { DomainResult, DomainFilters } from "../../../search/domainTypes";
import { ZSEARCH_HTTP_HEADERS } from "../../../../utils/httpHeaders";
import { safeDebug } from "../../../../utils/logger";
import { toErrorMessage } from "../../../../utils/error";

const UKDS_SEARCH = "https://beta.ukdataservice.ac.uk/datastudies";

export class UkDataServiceAdapter extends DomainSourceAdapter {
  readonly id = "ukds";
  readonly domainId = "dataset";
  readonly label = "UK Data Service";
  readonly noKey = true;

  async isAvailable() {
    return { available: true };
  }

  async search(
    query: string,
    maxResults: number,
    _filters?: DomainFilters,
  ): Promise<DomainResult[]> {
    const url = `${UKDS_SEARCH}?q=${encodeURIComponent(query)}`;

    const resp = await Zotero.HTTP.request("GET", url, {
      headers: {
        Accept: "text/html",
        "Accept-Language": "en-GB,en;q=0.9",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        ...ZSEARCH_HTTP_HEADERS,
      },
      timeout: 20000,
      errorDelayMax: 0,
    } as any);

    if (resp.status >= 400) {
      throw new Error(`UK Data Service error: HTTP ${resp.status}`);
    }

    // 解析 HTML：UKDS 搜索结果页
    const html = resp.responseText || "";
    const results: DomainResult[] = [];

    // 提取搜索结果条目：<a href="/study/<id>">title</a>
    const titleMatches = html.matchAll(
      /<a[^>]*href="\/(?:study|datastudy)\/([^"]+)"[^>]*>([^<]+)<\/a>/g,
    );

    const seen = new Set<string>();
    for (const match of titleMatches) {
      if (results.length >= maxResults) break;
      const id = match[1];
      const title = match[2].trim();
      if (!title || seen.has(id)) continue;
      seen.add(id);

      const url = `https://beta.ukdataservice.ac.uk/study/${id}`;

      results.push({
        title,
        url,
        snippet: "",
        source: "ukds",
        sourceId: id,
        dedupKey: `ukds:${id}`,
        extra: {
          studyId: id,
        },
      });
    }

    return results;
  }
}
