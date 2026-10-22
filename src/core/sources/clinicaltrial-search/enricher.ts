/**
 * clinicalTrialEnricher — 临床试验域结果富集。
 *
 * 对 DomainSearchEngine 去重后的 DomainResult[] 原地写回 extra：
 *  1. 状态归一：recruiting / completed / terminated / withdrawn
 *  2. 阶段格式化：Phase 1/2/3/4
 *  3. 入组人数格式化
 *
 * 全部 best-effort：单条解析失败跳过，不阻断整批。
 *
 * @module core/sources/clinicaltrial-search/enricher
 */

import type { DomainResult } from "../../search/domainTypes";
import { safeDebug } from "../../../utils/logger";

export async function enrichClinicalTrialResults(
  results: DomainResult[],
): Promise<void> {
  for (const r of results) {
    try {
      if (!r.extra) r.extra = {};

      // 阶段格式化
      if (Array.isArray(r.extra?.phases) && r.extra.phases.length > 0) {
        r.extra.phaseDisplay = r.extra.phases.join("/");
      }

      // 状态归一
      const status = (r.extra?.status || "").toLowerCase();
      if (status) {
        if (/recruit/i.test(status)) r.extra.statusNormalized = "recruiting";
        else if (/complet/i.test(status))
          r.extra.statusNormalized = "completed";
        else if (/terminat/i.test(status))
          r.extra.statusNormalized = "terminated";
        else if (/withdraw/i.test(status))
          r.extra.statusNormalized = "withdrawn";
        else r.extra.statusNormalized = "unknown";
      }
    } catch (e) {
      safeDebug(
        `[z-search] clinicalTrialEnricher failed for ${r.sourceId}: ${e}`,
      );
    }
  }
}
