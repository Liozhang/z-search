/**
 * ZoteroFtLeg — Zotero 10 宿主全文索引（FTS5）召回腿。
 *
 * 定位（2026-10-13）：宿主在 fulltext.sqlite 里自建了 contentless FTS5
 * 全文索引（unicode61 词表 + CJK 二元组，Zotero.Fulltext.findItemsWithContent），
 * 由宿主负责抽取、后台灌索引、损坏自愈与空间回收。本模块把这套索引接为
 * hybrid 检索的第三路召回——向量腿/自建 BM25 腿未覆盖的场景（插件索引未建、
 * 宿主已抽而插件未抽的条目）由此补位，插件自身零索引维护。
 *
 * 边界（与自建通道互补而非替代，勿据此删自建 FTS5）：
 * - 宿主返回布尔命中集合（按 itemID 序），无相关度、无片段、无页码；
 * - 命中是附件级，此处映射到父条目供上层结果卡消费；
 * - 单字 CJK / 拉丁与 CJK 混排 / 纯标点词宿主索引答不了（返回 null），
 *   如实报 degraded，由调用方按「该路缺席」处理；
 * - 只读宿主索引（走 Zotero.Fulltext 方法），绝不直接写 ftindex 表——
 *   fulltextIndexState 的一致性由宿主维护。
 *
 * Zotero.Fulltext.findItemsWithContent 是 Zotero 10 内部接口（无稳定性承
 * 诺，zotero-types 也未声明），一律 typeof 存在性检查后调用，与
 * ZoteroFulltextAdapter 对 getItemContent 的处理同款；Zotero 11 若改名，
 * 本模块降级、其余两路不受影响。
 *
 * @module core/search/ZoteroFtLeg
 */

import { safeDebug } from "../../utils/logger";

/** 单路召回腿的结算结果：status 如实区分「就绪 / 宿主无此 API / 答不了或失败」。 */
export interface ZoteroFtLegResult {
  status: "ready" | "unavailable" | "degraded";
  /**
   * 命中的父条目级 itemID（附件归属其父条目，独立附件取自身），去重，
   * 保持宿主返回顺序。仅 status==="ready" 时非空约定成立，其余恒为 []。
   */
  itemIds: number[];
  /** status 非 ready 时的降级原因（safeDebug 与上层状态展示用）。 */
  reason?: "host-api-missing" | "term-not-indexable" | "host-query-failed";
}

/**
 * 命中数上限。宿主对短词做前缀匹配，病态查询可能命中数千附件；RRF 贡献
 * 随排位衰减（weight/(rank+60)），尾部命中贡献已趋近于零，截断不影响融合
 * 结果，只为这一路的映射开销设上界。
 */
const MAX_HITS = 1000;

/** 宿主全文检索 API 是否存在（Zotero 10 起提供）。 */
export function isZoteroFulltextSearchAvailable(): boolean {
  const ft = (Zotero as any).Fulltext;
  return typeof ft?.findItemsWithContent === "function";
}

/**
 * 查询宿主全文索引，返回父条目级命中集合。
 *
 * @param query 原始查询词（宿主内部自行规范化：大小写/变音符折叠、CJK 二元组）
 */
export async function fetchZoteroFtLeg(
  query: string,
): Promise<ZoteroFtLegResult> {
  const ft = (Zotero as any).Fulltext;
  if (typeof ft?.findItemsWithContent !== "function") {
    return { status: "unavailable", itemIds: [], reason: "host-api-missing" };
  }
  try {
    // 参数：(查询词, libraryID, scopeIDs)。null = 不限库、不限范围；作
    // 召回腿不需要在宿主层收窄，融合后的 limit 由插件侧裁。
    const ids: number[] | null = await ft.findItemsWithContent(
      query,
      null,
      null,
    );
    if (ids === null) {
      return {
        status: "degraded",
        itemIds: [],
        reason: "term-not-indexable",
      };
    }
    if (ids.length === 0) {
      return { status: "ready", itemIds: [] };
    }

    const items = await Zotero.Items.getAsync(ids.slice(0, MAX_HITS));
    const parentIds: number[] = [];
    const seen = new Set<number>();
    for (const item of items) {
      if (!item) continue;
      // parentItemID 为 false（独立附件/无父）时取自身。同一文献多附件
      // （正文 PDF + 补充材料）在此收敛为一个父条目，与自建两路的条目级
      // 聚合口径一致。
      const targetId = item.parentItemID || item.id;
      if (!seen.has(targetId)) {
        seen.add(targetId);
        parentIds.push(targetId);
      }
    }
    return { status: "ready", itemIds: parentIds };
  } catch (e) {
    safeDebug(`[z-search] ZoteroFtLeg: host query failed: ${e}`);
    return { status: "degraded", itemIds: [], reason: "host-query-failed" };
  }
}
