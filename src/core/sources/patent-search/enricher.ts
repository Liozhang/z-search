/**
 * patentEnricher — 专利域结果富集。
 *
 * 对 DomainSearchEngine 去重后的 DomainResult[] 原地写回 extra：
 *  1. 同族规模（family size）：EPO 源若带 familyId 则直接透传；Google 源
 *     通过 INPADOC 家族推断（family_members 数组长度）
 *  2. 被引次数：Google Patents 已返回 citationCount，补写到 metrics
 *  3. 法律状态：从 sourceId 的 kind code 粗判（B2=授权、A1=公开、U1=临时）
 *
 * 全部 best-effort：单条解析失败跳过，不阻断整批富集。
 * 富集逻辑本地完成（基于已抓取的结构化字段），零额外网络请求——保持
 * 「summary-level 检索」的零网络开销承诺（除搜索本身外）。
 *
 * @module core/sources/patent-search/enricher
 */

import type { DomainResult } from "../../search/domainTypes";
import { safeDebug } from "../../../utils/logger";

/**
 * 富集专利结果（原地写回 extra / metrics）。
 * 供 DomainRegistry 注册为 patent 域的 DomainDef.enrich。
 */
export async function enrichPatentResults(
  results: DomainResult[],
): Promise<void> {
  for (const r of results) {
    try {
      if (!r.extra) r.extra = {};

      // 被引次数：Google Patents 在 extra.citationCount，补到 metrics
      if (typeof r.extra.citationCount === "number") {
        r.metrics = { ...(r.metrics || {}), citations: r.extra.citationCount };
      }

      // 法律状态：从归一化专利号的 kind code 粗判
      const kind = r.patentNumber?.split("-")[2];
      if (kind) {
        if (kind === "b2" || kind === "b1") {
          r.extra.legalStatus = "granted";
        } else if (kind === "a1" || kind === "a2" || kind === "a9") {
          r.extra.legalStatus = "published";
        } else if (kind === "u1") {
          r.extra.legalStatus = "utility";
        } else if (kind === "p1") {
          r.extra.legalStatus = "provisional";
        } else {
          r.extra.legalStatus = "unknown";
        }
      }

      // 同族规模：Google 源的 family_members（详情页 profile 才有）
      if (Array.isArray(r.extra.familyMembers)) {
        r.metrics = {
          ...(r.metrics || {}),
          familySize: r.extra.familyMembers.length,
        };
      }
    } catch (e) {
      safeDebug(`[z-search] patentEnricher failed for ${r.sourceId}: ${e}`);
      /* 单条失败跳过 */
    }
  }
}
