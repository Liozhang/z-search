/**
 * OpenAlexAuthorAdapter — OpenAlex Authors 检索源（免 key）。
 *
 * OpenAlex Authors API 免费、无需 key，覆盖全球研究者。
 * 端点：/authors?search=<name>&per_page=<n>（姓名检索）
 *      /authors/<id>（详情 profile）
 *
 * 返回 DomainResult：
 *  - sourceId = OpenAlex author id（如 "A5023888391"）
 *  - dedupKey = "oa-author:" + id（OpenAlex author id 是全球唯一消歧键）
 *  - extra 含 h-index、i10-index、引用数、代表作（top 5 works）、机构归属
 *
 * 与 researcher 域的 importItemType = "person" 联动，Zotero person 条目
 * 的 Extra 字段写入 ORCID / h-index 等聚合信息。
 *
 * @module core/sources/researcher-search/openalex-author
 */

import { DomainSourceAdapter } from "../../search/DomainSourceAdapter";
import type { DomainResult, DomainFilters } from "../../search/domainTypes";
import { openalexRequest } from "../academic-search/openalex";
import { safeDebug } from "../../../utils/logger";
import { toErrorMessage } from "../../../utils/error";

const OPENALEX_AUTHORS_API = "https://api.openalex.org/authors";

export class OpenAlexAuthorAdapter extends DomainSourceAdapter {
  readonly id = "openalex-author";
  readonly domainId = "researcher";
  readonly label = "OpenAlex Authors";
  readonly noKey = true;

  async isAvailable() {
    return { available: true };
  }

  async search(
    query: string,
    maxResults: number,
    _filters?: DomainFilters,
  ): Promise<DomainResult[]> {
    const limit = Math.min(maxResults, 25); // OpenAlex 单页上限 25
    const url = `${OPENALEX_AUTHORS_API}?search=${encodeURIComponent(query)}&per_page=${limit}&select=id,display_name,orcid,works_count,cited_by_count,summary_stats,last_known_institutions,x_concepts`;

    const result = await openalexRequest(url);
    if (!result.ok) {
      throw new Error(
        `OpenAlex Authors API error: HTTP ${result.status ?? "error"}`,
      );
    }

    let data: any;
    try {
      data = JSON.parse(result.body);
    } catch (e) {
      throw new Error(
        `OpenAlex Authors API invalid JSON: ${toErrorMessage(e)}`,
      );
    }

    const authors: any[] = data.results || [];
    const results: DomainResult[] = [];

    for (const author of authors.slice(0, maxResults)) {
      const id = String(author.id || "").replace(
        "https://openalex.org/",
        "",
      );
      if (!id) continue;

      const displayName = author.display_name || "";
      if (!displayName) continue;

      // 机构归属：last_known_institutions 数组
      const institutions = Array.isArray(author.last_known_institutions)
        ? author.last_known_institutions.map((inst: any) => inst.display_name || "")
        : [];

      // 研究领域：x_concepts top 5（按 score 排序）
      const topics: string[] = Array.isArray(author.x_concepts)
        ? author.x_concepts
            .sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0))
            .slice(0, 5)
            .map((c: any) => c.display_name || "")
            .filter(Boolean)
        : [];

      const url = `https://openalex.org/authors/${id}`;

      results.push({
        title: displayName,
        url,
        snippet: `h-index: ${author.summary_stats?.h_index ?? "?"}, ${author.works_count ?? 0} works, ${author.cited_by_count ?? 0} citations`,
        source: "openalex-author",
        sourceId: id,
        dedupKey: `oa-author:${id}`,
        metrics: {
          hIndex: author.summary_stats?.h_index ?? 0,
          i10Index: author.summary_stats?.i10_index ?? 0,
          citations: author.cited_by_count ?? 0,
          works: author.works_count ?? 0,
        },
        extra: {
          orcid: author.orcid || undefined,
          institutions,
          topics,
        },
      });
    }

    return results;
  }

  async profile(sourceId: string): Promise<DomainResult | null> {
    const id = sourceId.replace("https://openalex.org/", "");
    const url = `${OPENALEX_AUTHORS_API}/${id}?select=id,display_name,orcid,works_count,cited_by_count,summary_stats,last_known_institutions,x_concepts`;

    const result = await openalexRequest(url);
    if (!result.ok) return null;

    let author: any;
    try {
      author = JSON.parse(result.body);
    } catch {
      return null;
    }

    if (!author?.id) return null;

    const institutions = Array.isArray(author.last_known_institutions)
      ? author.last_known_institutions.map((inst: any) => inst.display_name || "")
      : [];

    const topics: string[] = Array.isArray(author.x_concepts)
      ? author.x_concepts
          .sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0))
          .slice(0, 5)
          .map((c: any) => c.display_name || "")
          .filter(Boolean)
      : [];

    return {
      title: author.display_name || id,
      url: `https://openalex.org/authors/${id}`,
      snippet: `h-index: ${author.summary_stats?.h_index ?? "?"}, ${author.works_count ?? 0} works, ${author.cited_by_count ?? 0} citations`,
      source: "openalex-author",
      sourceId: id,
      dedupKey: `oa-author:${id}`,
      metrics: {
        hIndex: author.summary_stats?.h_index ?? 0,
        i10Index: author.summary_stats?.i10_index ?? 0,
        citations: author.cited_by_count ?? 0,
        works: author.works_count ?? 0,
      },
      extra: {
        orcid: author.orcid || undefined,
        institutions,
        topics,
      },
    };
  }
}
