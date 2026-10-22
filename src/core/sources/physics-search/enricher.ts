/**
 * physicsMathEconEnricher — 物理/数学/经济学域结果富集。
 *
 * 对 DomainSearchEngine 去重后的 DomainResult[] 原地写回 extra：
 *  1. 物理：标记 dataType = "physics-literature"
 *  2. 数学：标记 dataType = "mathematics-literature"
 *  3. 经济学：标记 dataType = "economics-literature"
 *
 * 全部 best-effort：单条解析失败跳过，不阻断整批。
 *
 * @module core/sources/physics-search/enricher
 */

import type { DomainResult } from "../../search/domainTypes";
import { safeDebug } from "../../../utils/logger";

/** 各领域数据类型的显示映射。 */
const DOMAIN_DATA_TYPES: Record<string, string> = {
  physics: "Physics Literature",
  mathematics: "Mathematics Literature",
  economics: "Economics Literature",
};

export async function enrichPhysicsMathEconResults(
  results: DomainResult[],
): Promise<void> {
  for (const r of results) {
    try {
      if (!r.extra) r.extra = {};
      const domainBySource: Record<string, string> = {
        inspire: "physics",
        "nasa-ads": "physics",
        zbmath: "mathematics",
        repec: "economics",
      };
      const domain = domainBySource[r.source] || "";
      if (domain && DOMAIN_DATA_TYPES[domain]) {
        r.extra.dataType = DOMAIN_DATA_TYPES[domain];
      }
    } catch (e) {
      safeDebug(
        `[z-search] physicsMathEconEnricher failed for ${r.sourceId}: ${e}`,
      );
    }
  }
}
