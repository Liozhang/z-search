/**
 * ZbmathAdapter — zbMATH Open 数学文献检索源（免 key）。
 *
 * zbMATH Open 是全球最大的数学文献数据库，2021 年起开放访问。
 * REST API 免费。
 * 端点：/api/v1/documents/_search?search_string=<query>&page=<n>
 *
 * 返回 DomainResult：
 *  - sourceId = zbMATH document id（如 "Zbl 1452.81001"）
 *  - dedupKey = "zbmath:" + sourceId
 *  - extra 含 authors、msc2010、keywords
 *
 * @module core/sources/math-search/zbmath
 */

import { DomainSourceAdapter } from "../../../search/DomainSourceAdapter";
import type { DomainResult, DomainFilters } from "../../../search/domainTypes";
import { ZSEARCH_HTTP_HEADERS } from "../../../../utils/httpHeaders";
import { safeDebug } from "../../../../utils/logger";
import { toErrorMessage } from "../../../../utils/error";

const ZBMATH_API = "https://api.zbmath.org/v1/documents/_search";

export class ZbmathAdapter extends DomainSourceAdapter {
  readonly id = "zbmath";
  readonly domainId = "mathematics";
  readonly label = "zbMATH Open";
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
    const url = `${ZBMATH_API}?search_string=${encodeURIComponent(query)}&page=0&results_per_page=${limit}`;

    const resp = await Zotero.HTTP.request("GET", url, {
      headers: {
        Accept: "application/json",
        ...ZSEARCH_HTTP_HEADERS,
      },
      timeout: 20000,
      errorDelayMax: 0,
    } as any);

    if (resp.status >= 400) {
      throw new Error(`zbMATH API error: HTTP ${resp.status}`);
    }

    let data: any;
    try {
      data = JSON.parse(resp.responseText || "{}");
    } catch (e) {
      throw new Error(`zbMATH API invalid JSON: ${toErrorMessage(e)}`);
    }

    const documents: any[] = data.result || [];
    const results: DomainResult[] = [];

    for (const doc of documents.slice(0, maxResults)) {
      const id = doc.id || doc.identifier || "";
      if (!id) continue;

      const title = doc.title?.title || "";
      if (!title) continue;

      // 作者
      const authors: string[] = Array.isArray(doc.contributors?.authors)
        ? doc.contributors.authors
            .map((a: any) => a.name || "")
            .filter(Boolean)
        : [];

      // MSC 分类
      const msc: string[] = Array.isArray(doc.msc2010)
        ? doc.msc2010.map((m: any) => m.code || "").filter(Boolean)
        : [];

      // 关键词
      const keywords: string[] = Array.isArray(doc.keywords)
        ? doc.keywords.map((k: any) => k.text || "").filter(Boolean)
        : [];

      const url = `https://zbmath.org/?q=an:${encodeURIComponent(id)}`;

      results.push({
        title,
        url,
        snippet: (doc.title?.editorial_note || "").slice(0, 300),
        source: "zbmath",
        sourceId: id,
        year: doc.year ? String(doc.year) : undefined,
        dedupKey: `zbmath:${id}`,
        extra: {
          authors,
          msc,
          keywords,
          serial: doc.serial || "",
        },
      });
    }

    return results;
  }

  async profile(sourceId: string): Promise<DomainResult | null> {
    return null;
  }
}
