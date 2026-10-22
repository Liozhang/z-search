/**
 * SemanticScholarAuthorAdapter — Semantic Scholar Author API 检索源（免 key）。
 *
 * Semantic Scholar API 免费、无需 key，覆盖全球研究者和论文。
 * 端点：/graph/v1/author/search?query=<name>&fields=<fields>
 *
 * 返回 DomainResult：
 *  - sourceId = S2 author id（如 "145323456"）
 *  - dedupKey = "s2-author:" + id
 *  - extra 含 h-index、引用数、论文数、研究兴趣标签
 *
 * @module core/sources/researcher-search/semantic-scholar-author
 */

import { DomainSourceAdapter } from "../../search/DomainSourceAdapter";
import type { DomainResult, DomainFilters } from "../../search/domainTypes";
import { ZSEARCH_HTTP_HEADERS } from "../../../utils/httpHeaders";
import { safeDebug } from "../../../utils/logger";
import { toErrorMessage } from "../../../utils/error";

const S2_API = "https://api.semanticscholar.org/graph/v1/author";

export class SemanticScholarAuthorAdapter extends DomainSourceAdapter {
  readonly id = "semantic-scholar-author";
  readonly domainId = "researcher";
  readonly label = "Semantic Scholar Authors";
  readonly noKey = true;

  async isAvailable() {
    return { available: true };
  }

  async search(
    query: string,
    maxResults: number,
    _filters?: DomainFilters,
  ): Promise<DomainResult[]> {
    const limit = Math.min(maxResults, 100);
    const fields = "name,affiliations,paperCount,citationCount,hIndex,homepage,url";
    const url = `${S2_API}/search?query=${encodeURIComponent(query)}&fields=${fields}&limit=${limit}`;

    const resp = await Zotero.HTTP.request("GET", url, {
      headers: {
        Accept: "application/json",
        ...ZSEARCH_HTTP_HEADERS,
      },
      timeout: 15000,
      errorDelayMax: 0,
    } as any);

    if (resp.status >= 400) {
      throw new Error(`Semantic Scholar API error: HTTP ${resp.status}`);
    }

    let data: any;
    try {
      data = JSON.parse(resp.responseText || "{}");
    } catch (e) {
      throw new Error(
        `Semantic Scholar API invalid JSON: ${toErrorMessage(e)}`,
      );
    }

    const authors: any[] = data.data || [];
    const results: DomainResult[] = [];

    for (const author of authors.slice(0, maxResults)) {
      const id = String(author.authorId || "");
      if (!id) continue;

      const name = author.name || "";
      if (!name) continue;

      const affiliations = Array.isArray(author.affiliations)
        ? author.affiliations
        : [];

      const url = author.url || `https://www.semanticscholar.org/author/${id}`;

      results.push({
        title: name,
        url,
        snippet: affiliations[0] || "",
        source: "semantic-scholar-author",
        sourceId: id,
        dedupKey: `s2-author:${id}`,
        metrics: {
          hIndex: author.hIndex ?? 0,
          citations: author.citationCount ?? 0,
          works: author.paperCount ?? 0,
        },
        extra: {
          s2AuthorId: id,
          institutions: affiliations,
          homepage: author.homepage || "",
        },
      });
    }

    return results;
  }

  async profile(sourceId: string): Promise<DomainResult | null> {
    const fields = "name,affiliations,paperCount,citationCount,hIndex,homepage,url";
    const url = `${S2_API}/${sourceId}?fields=${fields}`;

    const resp = await Zotero.HTTP.request("GET", url, {
      headers: {
        Accept: "application/json",
        ...ZSEARCH_HTTP_HEADERS,
      },
      timeout: 15000,
      errorDelayMax: 0,
    } as any);

    if (resp.status >= 400) return null;

    let author: any;
    try {
      author = JSON.parse(resp.responseText || "{}");
    } catch {
      return null;
    }

    if (!author?.authorId) return null;

    return {
      title: author.name || sourceId,
      url: author.url || `https://www.semanticscholar.org/author/${sourceId}`,
      snippet: (author.affiliations?.[0]) || "",
      source: "semantic-scholar-author",
      sourceId,
      dedupKey: `s2-author:${sourceId}`,
      metrics: {
        hIndex: author.hIndex ?? 0,
        citations: author.citationCount ?? 0,
        works: author.paperCount ?? 0,
      },
      extra: {
        s2AuthorId: sourceId,
        institutions: author.affiliations || [],
        homepage: author.homepage || "",
      },
    };
  }
}
