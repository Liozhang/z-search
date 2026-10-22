/**
 * preprintEnricher — 预印本域结果富集。
 *
 * 对 DomainSearchEngine 去重后的 DomainResult[] 原地写回 extra：
 *  1. 预印本服务器识别：chemrxiv / socarxiv / eartharxiv
 *  2. 状态标记：所有结果标记为 "preprint"（预印本未经同行评审）
 *
 * 全部 best-effort：单条解析失败跳过，不阻断整批。
 *
 * @module core/sources/preprint-search/enricher
 */

import type { DomainResult } from "../../search/domainTypes";
import { safeDebug } from "../../../utils/logger";

export async function enrichPreprintResults(
  results: DomainResult[],
): Promise<void> {
  for (const r of results) {
    try {
      if (!r.extra) r.extra = {};
      r.extra.documentType = "preprint";
      r.extra.peerReviewed = false;
    } catch (e) {
      safeDebug(
        `[z-search] preprintEnricher failed for ${r.sourceId}: ${e}`,
      );
    }
  }
}
