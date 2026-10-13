/**
 * mergeZoteroFtLeg — Zotero 宿主全文腿条目级二次融合的纯逻辑测试。
 *
 * 被测函数不触碰 Zotero 全局（宿主访问都隔离在 ZoteroFtLeg），可直接
 * 构造 HybridRankedEntry / itemIds 输入。RRF 分母 k=60。
 *
 * @module tests/unit/core/search/zotero-ft-merge
 */
import { describe, it, expect } from "vitest";
import {
  mergeZoteroFtLeg,
  type HybridRankedEntry,
} from "../../../../src/core/search/fulltext-fusion";

function hybridEntry(
  itemId: number,
  sources: string[],
  score = 0.01,
): HybridRankedEntry {
  return {
    itemId,
    chunkId: itemId * 100,
    score,
    vectorScore: sources.includes("vector") ? 0.8 : undefined,
    sources,
  };
}

describe("mergeZoteroFtLeg", () => {
  it("宿主腿为空时原样透传（顺序/分数/来源不变）", () => {
    const hybrid = [
      hybridEntry(1, ["vector", "bm25"], 0.03),
      hybridEntry(2, ["bm25"], 0.02),
    ];
    const merged = mergeZoteroFtLeg(hybrid, [], { limit: 10 });
    expect(merged).toHaveLength(2);
    expect(merged.map((m) => m.itemId)).toEqual([1, 2]);
    expect(merged[0]).toMatchObject({
      itemId: 1,
      chunkId: 100,
      score: 0.03,
      sources: ["vector", "bm25"],
    });
  });

  it("透传时按 limit 截断", () => {
    const hybrid = [hybridEntry(1, ["vector"]), hybridEntry(2, ["bm25"])];
    const merged = mergeZoteroFtLeg(hybrid, [], { limit: 1 });
    expect(merged).toHaveLength(1);
    expect(merged[0].itemId).toBe(1);
  });

  it("宿主独占命中进入结果尾部，无 chunkId，来源仅 zotero-ft", () => {
    // hybrid: A(rank1) B(rank2)；宿主集合: [C, A]
    // RRF(k=60)：A = 1/61 + 0.5/62 ≈ 0.02446 > B = 1/62 ≈ 0.01613
    //          > C = 0.5/61 ≈ 0.00820 —— 宿主独占命中排在 hybrid 尾部之后
    const hybrid = [
      hybridEntry(1, ["vector", "bm25"]),
      hybridEntry(2, ["bm25"]),
    ];
    const merged = mergeZoteroFtLeg(hybrid, [3, 1], { limit: 10 });
    expect(merged.map((m) => m.itemId)).toEqual([1, 2, 3]);
    expect(merged[0].sources).toEqual(["vector", "bm25", "zotero-ft"]);
    expect(merged[1].sources).toEqual(["bm25"]);
    expect(merged[2]).toMatchObject({
      itemId: 3,
      chunkId: undefined,
      sources: ["zotero-ft"],
    });
    expect(merged[2].sectionCategory).toBeUndefined();
  });

  it("双腿都命中的条目获得加成，排到纯 hybrid 条目之前", () => {
    // hybrid: A(rank1) B(rank2)；宿主集合只含 B：
    // B = 1/62 + 0.5/61 ≈ 0.02433 > A = 1/61 ≈ 0.01639 → B 升至首位
    const hybrid = [
      hybridEntry(1, ["vector"], 0.02),
      hybridEntry(2, ["bm25"], 0.01),
    ];
    const merged = mergeZoteroFtLeg(hybrid, [2], { limit: 10 });
    expect(merged[0].itemId).toBe(2);
    expect(merged[0].score).toBeGreaterThan(merged[1].score);
    expect(merged[0].sources).toEqual(["bm25", "zotero-ft"]);
    // 块级元数据随条目保留
    expect(merged[0].chunkId).toBe(200);
  });

  it("limit 覆盖并集总长", () => {
    const hybrid = [hybridEntry(1, ["vector"]), hybridEntry(2, ["bm25"])];
    const merged = mergeZoteroFtLeg(hybrid, [3, 4], { limit: 3 });
    expect(merged).toHaveLength(3);
  });

  it("提高宿主路权重可以让宿主独占命中反超 hybrid 尾部", () => {
    // hybrid: A(rank1)；宿主集合: [C]。zoteroWeight=3 时
    // C = 3/61 ≈ 0.0492 > A = 1/61 ≈ 0.0164
    const hybrid = [hybridEntry(1, ["vector"])];
    const merged = mergeZoteroFtLeg(hybrid, [2], {
      zoteroWeight: 3.0,
      limit: 10,
    });
    expect(merged.map((m) => m.itemId)).toEqual([2, 1]);
  });
});
