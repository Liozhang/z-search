/**
 * domainEnricher — 各研究领域专业数据库的通用富集器。
 *
 * 对 DomainSearchEngine 去重后的 DomainResult[] 原地写回 extra：
 *  1. 生命科学（bio）：标记 dataType = "gene-expression"
 *  2. 化学（chemistry）：标记 dataType = "chemical-compound"
 *  3. 地球科学（geoscience）：标记 dataType = "geoscience-data"
 *  4. 社会科学（social-science）：标记 dataType = "social-science-data"
 *
 * 全部 best-effort：单条解析失败跳过，不阻断整批。
 *
 * @module core/sources/bio-search/enricher
 */

import type { DomainResult } from "../../search/domainTypes";
import { safeDebug } from "../../../utils/logger";

/** 各领域数据类型的显示映射。 */
const DOMAIN_DATA_TYPES: Record<string, string> = {
  bio: "Gene Expression Data",
  chemistry: "Chemical Compound",
  geoscience: "Geoscience Data",
  "social-science": "Social Science Data",
};

export async function enrichDomainResults(
  results: DomainResult[],
): Promise<void> {
  for (const r of results) {
    try {
      if (!r.extra) r.extra = {};
      // 从 source 推断域：geo → bio, pubchem → chemistry, pangaea → geoscience, icpsr → social-science
      const domainBySource: Record<string, string> = {
        geo: "bio",
        pubchem: "chemistry",
        pangaea: "geoscience",
        icpsr: "social-science",
      };
      const domain = domainBySource[r.source] || "";
      if (domain && DOMAIN_DATA_TYPES[domain]) {
        r.extra.dataType = DOMAIN_DATA_TYPES[domain];
      }
    } catch (e) {
      safeDebug(
        `[z-search] domainEnricher failed for ${r.sourceId}: ${e}`,
      );
    }
  }
}
