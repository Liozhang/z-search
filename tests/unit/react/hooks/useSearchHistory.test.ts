/**
 * useSearchHistory 纯函数单测：pref 解析容错与记录合并语义。
 * （hook 的 React 面由类型检查与真机验收覆盖——仓内无组件测试底座。）
 *
 * @module tests/unit/react/hooks/useSearchHistory
 */
import { describe, it, expect } from "vitest";
import {
  parseSearchHistory,
  mergeSearchHistory,
  recentHistory,
  SEARCH_HISTORY_MAX_ENTRIES,
  type SearchHistoryEntry,
} from "../../../../src/react/hooks/useSearchHistory";

describe("parseSearchHistory", () => {
  it("解析合法 JSON 表", () => {
    const raw = JSON.stringify([
      { q: "CRISPR", scope: "web", ts: 1 },
      { q: "单细胞", scope: "local", ts: 2 },
    ]);
    expect(parseSearchHistory(raw)).toEqual([
      { q: "CRISPR", scope: "web", ts: 1 },
      { q: "单细胞", scope: "local", ts: 2 },
    ]);
  });

  it("非串/空串/坏 JSON/非数组/形状不符 → 空表", () => {
    expect(parseSearchHistory(null)).toEqual([]);
    expect(parseSearchHistory("")).toEqual([]);
    expect(parseSearchHistory("{broken")).toEqual([]);
    expect(parseSearchHistory('{"q":"x"}')).toEqual([]);
    expect(
      parseSearchHistory(JSON.stringify([{ q: "", ts: 1 }, { nope: true }])),
    ).toEqual([]);
  });
});

describe("mergeSearchHistory", () => {
  const base: SearchHistoryEntry[] = [
    { q: "old", scope: "web", ts: 1 },
    { q: "older", scope: "local", ts: 2 },
  ];

  it("新词插到最前", () => {
    const next = mergeSearchHistory(base, "web", "new term", 10);
    expect(next[0]).toEqual({ q: "new term", scope: "web", ts: 10 });
    expect(next).toHaveLength(3);
  });

  it("同词同域置顶并刷新时间戳（大小写不敏感）", () => {
    const next = mergeSearchHistory(
      [...base, { q: "CRISPR", scope: "web", ts: 3 }],
      "web",
      "crispr",
      10,
    );
    expect(next).toHaveLength(3);
    expect(next[0]).toEqual({ q: "crispr", scope: "web", ts: 10 });
    expect(next.filter((e) => e.q.toLowerCase() === "crispr")).toHaveLength(1);
  });

  it("同词异域互不挤占", () => {
    const next = mergeSearchHistory(
      [{ q: "CRISPR", scope: "web", ts: 3 }],
      "local",
      "CRISPR",
      10,
    );
    expect(next).toHaveLength(2);
    expect(next[0].scope).toBe("local");
  });

  it("空/纯空白查询返回原表（引用相等）", () => {
    expect(mergeSearchHistory(base, "web", "   ", 10)).toBe(base);
  });

  it("超容从最旧端裁剪", () => {
    let table: SearchHistoryEntry[] = [];
    for (let i = 0; i < SEARCH_HISTORY_MAX_ENTRIES + 5; i++) {
      table = mergeSearchHistory(table, "web", `term-${i}`, i);
    }
    expect(table).toHaveLength(SEARCH_HISTORY_MAX_ENTRIES);
    expect(table[0].q).toBe(`term-${SEARCH_HISTORY_MAX_ENTRIES + 4}`);
    expect(table.at(-1)?.q).toBe("term-5");
  });
});

describe("recentHistory", () => {
  it("按域过滤且保持新→旧序", () => {
    const entries: SearchHistoryEntry[] = [
      { q: "a", scope: "web", ts: 3 },
      { q: "b", scope: "local", ts: 2 },
      { q: "c", scope: "web", ts: 1 },
    ];
    expect(recentHistory(entries, "web").map((e) => e.q)).toEqual(["a", "c"]);
    expect(recentHistory(entries, "local").map((e) => e.q)).toEqual(["b"]);
  });
});
