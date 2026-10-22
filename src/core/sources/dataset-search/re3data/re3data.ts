/**
 * Re3dataAdapter — re3data 研究数据仓储目录检索源（免 key）。
 *
 * re3data 是全球最大的研究数据仓储目录，索引 3300+ 数据仓储，
 * 覆盖所有学科。免费 API。
 * 端点：/api/beta/repositories?query=<query>
 *
 * 返回 DomainResult：
 *  - sourceId = re3data repository id（如 "r3d100010371"）
 *  - dedupKey = "re3data:" + sourceId
 *  - extra 含 repositoryName、repositoryURL、disciplines、repositoryType
 *
 * @module core/sources/dataset-search/re3data
 */

import { DomainSourceAdapter } from "../../../search/DomainSourceAdapter";
import type { DomainResult, DomainFilters } from "../../../search/domainTypes";
import { ZSEARCH_HTTP_HEADERS } from "../../../../utils/httpHeaders";
import { safeDebug } from "../../../../utils/logger";
import { toErrorMessage } from "../../../../utils/error";

const RE3DATA_API = "https://www.re3data.org/api/beta/repositories";

export class Re3dataAdapter extends DomainSourceAdapter {
  readonly id = "re3data";
  readonly domainId = "dataset";
  readonly label = "re3data Repository";
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
    const url = `${RE3DATA_API}?query=${encodeURIComponent(query)}`;

    const resp = await Zotero.HTTP.request("GET", url, {
      headers: {
        Accept: "application/json",
        ...ZSEARCH_HTTP_HEADERS,
      },
      timeout: 20000,
      errorDelayMax: 0,
    } as any);

    if (resp.status >= 400) {
      throw new Error(`re3data API error: HTTP ${resp.status}`);
    }

    let data: any;
    try {
      data = JSON.parse(resp.responseText || "{}");
    } catch (e) {
      throw new Error(`re3data API invalid JSON: ${toErrorMessage(e)}`);
    }

    // re3data API 返回结构：[{ id, repositoryName, ... }]
    const repos: any[] = Array.isArray(data) ? data : [];
    const results: DomainResult[] = [];

    for (const repo of repos.slice(0, maxResults)) {
      const id = repo.id || "";
      if (!id) continue;

      const name = repo.repositoryName || "";
      if (!name) continue;

      const url = repo.repositoryURL || `https://www.re3data.org/repository/${id}`;

      // 学科：disciplines 数组
      const disciplines: string[] = Array.isArray(repo.subjects)
        ? repo.subjects.map((s: any) => s.subject || "").filter(Boolean)
        : [];

      results.push({
        title: name,
        url,
        snippet: (repo.description || "").slice(0, 300),
        source: "re3data",
        sourceId: id,
        dedupKey: `re3data:${id}`,
        extra: {
          repositoryName: name,
          repositoryURL: repo.repositoryURL || "",
          disciplines,
          repositoryType: repo.repositoryType || "",
          certifications: Array.isArray(repo.certificates)
            ? repo.certificates.map((c: any) => c.certificate || "")
            : [],
        },
      });
    }

    return results;
  }
}
