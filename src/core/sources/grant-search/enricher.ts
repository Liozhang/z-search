/**
 * grantEnricher — 基金项目域结果富集。
 *
 * 对 DomainSearchEngine 去重后的 DomainResult[] 原地写回 extra：
 *  1. 金额格式化：把 metrics.amount（原始数字）格式化为可读字符串
 *     （如 1234567 → "$1,234,567"）
 *  2. 执行期格式：把 startDate/endDate 拼接为 "2020-01-01 ~ 2023-12-31"
 *  3. 状态归一：把 NSF/CORDIS 的原始状态映射为统一标签
 *     （active / completed / terminated）
 *
 * 全部 best-effort：单条解析失败跳过，不阻断整批。
 * 富集逻辑本地完成（基于适配器已返回的结构化字段），零额外网络请求。
 *
 * @module core/sources/grant-search/enricher
 */

import type { DomainResult } from "../../search/domainTypes";
import { safeDebug } from "../../../utils/logger";

/**
 * 富集基金项目结果（原地写回 extra / metrics）。
 * 供 DomainRegistry 注册为 grant 域的 DomainDef.enrich。
 */
export async function enrichGrantResults(
  results: DomainResult[],
): Promise<void> {
  for (const r of results) {
    try {
      if (!r.extra) r.extra = {};

      // 金额格式化
      const amount = Number(r.metrics?.amount) || 0;
      if (amount > 0) {
        r.extra.amountFormatted = `$${amount.toLocaleString("en-US")}`;
      }

      // 执行期格式
      if (r.extra.startDate && r.extra.endDate) {
        r.extra.period = `${r.extra.startDate} ~ ${r.extra.endDate}`;
      }

      // 状态归一
      const rawStatus = (r.extra.status || "").toLowerCase();
      if (rawStatus) {
        if (/active|ongoing|in.progress/i.test(rawStatus)) {
          r.extra.statusNormalized = "active";
        } else if (/completed|closed|finished/i.test(rawStatus)) {
          r.extra.statusNormalized = "completed";
        } else if (/terminated|cancelled|suspended/i.test(rawStatus)) {
          r.extra.statusNormalized = "terminated";
        } else {
          r.extra.statusNormalized = "unknown";
        }
      }
    } catch (e) {
      safeDebug(
        `[z-search] grantEnricher failed for ${r.sourceId}: ${e}`,
      );
      /* 单条失败跳过 */
    }
  }
}
