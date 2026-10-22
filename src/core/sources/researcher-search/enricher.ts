/**
 * researcherEnricher — 研究者域结果富集。
 *
 * 对 DomainSearchEngine 去重后的 DomainResult[] 原地写回 extra：
 *  1. 机构消歧：OpenAlex last_known_institutions 已带结构化机构名，
 *     富集器将其规范化为 "Institution (Country)" 格式写入 extra.institutions
 *  2. 研究领域排序：x_concepts 按 score 降序取 top 5，写入 extra.topics
 *  3. 代表作数量：从 metrics.works 推算代表性（>100 = prolific，>20 = active）
 *
 * 全部 best-effort：单条解析失败跳过，不阻断整批。
 * 富集逻辑本地完成（基于 OpenAlex 已返回的结构化字段），零额外网络请求。
 *
 * @module core/sources/researcher-search/enricher
 */

import type { DomainResult } from "../../search/domainTypes";
import { safeDebug } from "../../../utils/logger";

/**
 * 富集研究者结果（原地写回 extra / metrics）。
 * 供 DomainRegistry 注册为 researcher 域的 DomainDef.enrich。
 */
export async function enrichResearcherResults(
  results: DomainResult[],
): Promise<void> {
  for (const r of results) {
    try {
      if (!r.extra) r.extra = {};

      // 研究领域排序已在适配器侧完成（x_concepts sort + slice 5），此处补
      // 一个"活跃度"标签到 metrics
      const works = Number(r.metrics?.works) || 0;
      if (works > 0) {
        let activity: string;
        if (works > 100) activity = "prolific";
        else if (works > 20) activity = "active";
        else activity = "emerging";
        r.metrics = { ...(r.metrics || {}), activity };
      }

      // 机构消歧：OpenAlex 已带 display_name，补国家代码
      if (Array.isArray(r.extra?.institutions) && r.extra.institutions.length > 0) {
        // 机构名已是 display_name 字符串数组，无需额外处理
        // 如有国家代码则拼接
        if (r.extra.countryCode && r.extra.institutions[0]) {
          r.extra.institutionDisplay = `${r.extra.institutions[0]} (${r.extra.countryCode})`;
        }
      }
    } catch (e) {
      safeDebug(
        `[z-search] researcherEnricher failed for ${r.sourceId}: ${e}`,
      );
      /* 单条失败跳过 */
    }
  }
}
