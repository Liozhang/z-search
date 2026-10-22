/**
 * OpenAlexInstitutionAdapter — OpenAlex Institutions 检索源（免 key）。
 *
 * OpenAlex Institutions API 免费、无需 key，覆盖全球研究机构。
 * 端点：/institutions?search=<name>&per_page=<n>（名称检索）
 *
 * 返回 DomainResult：
 *  - sourceId = OpenAlex institution id（如 "I123456"）
 *  - dedupKey = "oa-inst:" + id
 *  - extra 含国家代码、works 数量
 *
 * 与 researcher 域的 importItemType = "person" 联动（机构作为 note 条目）。
 *
 * @module core/sources/researcher-search/openalex-institution
 */

import { DomainSourceAdapter } from "../../search/DomainSourceAdapter";
import type { DomainResult, DomainFilters } from "../../search/domainTypes";
import { searchOpenAlexInstitutions } from "../academic-search/openalex";
import { safeDebug } from "../../../utils/logger";

export class OpenAlexInstitutionAdapter extends DomainSourceAdapter {
  readonly id = "openalex-institution";
  readonly domainId = "researcher";
  readonly label = "OpenAlex Institutions";
  readonly noKey = true;

  async isAvailable() {
    return { available: true };
  }

  async search(
    query: string,
    maxResults: number,
    _filters?: DomainFilters,
  ): Promise<DomainResult[]> {
    const result = await searchOpenAlexInstitutions({
      search: query,
      maxResults,
    });

    if (!result.success) {
      throw new Error(
        `OpenAlex Institutions API error: ${result.error ?? "unknown"}`,
      );
    }

    const results: DomainResult[] = [];
    for (const inst of result.institutions.slice(0, maxResults)) {
      if (!inst.id || !inst.displayName) continue;

      const url = `https://openalex.org/institutions/${inst.id}`;

      results.push({
        title: inst.displayName,
        url,
        snippet: `${inst.worksCount ?? 0} works${inst.countryCode ? `, ${inst.countryCode}` : ""}`,
        source: "openalex-institution",
        sourceId: inst.id,
        dedupKey: `oa-inst:${inst.id}`,
        metrics: {
          works: inst.worksCount ?? 0,
        },
        extra: {
          countryCode: inst.countryCode || undefined,
          institutionId: inst.id,
        },
      });
    }

    return results;
  }
}
