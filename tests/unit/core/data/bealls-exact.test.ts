/**
 * BeallsListStore.batchLookupJournalExact — 精确名批量查表（文献结果卡富集用）。
 *
 * 守两条边界（见 store 方法注释）：
 *   1. 只命中 journals 表的精确名（L2）——模糊层（缩写 0.9 / 关键词重叠 0.7）
 *      与出版社级命中不得置位结果卡徽章，否则会把合法期刊误标为掠夺性；
 *   2. 键归一化走 normalizeJournalName（大小写/空白不敏感），与期刊名在
 *      三语言 locale 之外的真实书写差异解耦。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock 工厂会被提升到 import 之前执行——用 vi.hoisted 保证 fn 先于工厂存在
const queryPlain = vi.hoisted(() => vi.fn());
vi.mock("../../../../src/core/data/queryPlain", () => ({
  queryPlain,
}));

import BeallsListStore from "../../../../src/core/data/BeallsListStore";

const JOURNALS = [
  {
    id: 1,
    journal_name: "International Journal of Advanced Research and Publications",
    journal_url: "http://www.journal-ijar.com",
    category: "standalone",
    extra: "IJAR",
  },
  {
    id: 2,
    journal_name: "Journal of Nanoscience and Technology",
    journal_url: null,
    category: "hijacked",
    extra: null,
  },
];

const PUBLISHERS = [
  {
    id: 1,
    publisher_name: "OMICS International",
    publisher_url: "http://omicsonline.org",
  },
];

function fakeDb() {
  queryPlain.mockImplementation(async (sql: string) => {
    if (sql.includes("bealls_journals")) return JOURNALS;
    if (sql.includes("bealls_publishers")) return PUBLISHERS;
    if (sql.includes("bealls_metrics")) return [];
    return [];
  });
}

async function reloadIndex() {
  // 置脏后由被测方法自身触发 ensureIndex（getCounts 走裸 SQL，不重建索引）
  (BeallsListStore as unknown as { indexLoaded: boolean }).indexLoaded = false;
}

describe("BeallsListStore.batchLookupJournalExact", () => {
  beforeEach(() => {
    queryPlain.mockReset();
    fakeDb();
  });

  it("exact-name hit returns the journal category (standalone/hijacked)", async () => {
    await reloadIndex();
    const map = await BeallsListStore.batchLookupJournalExact([
      "International Journal of Advanced Research and Publications",
      "Journal of Nanoscience and Technology",
    ]);
    expect(
      map.get("INTERNATIONAL JOURNAL OF ADVANCED RESEARCH AND PUBLICATIONS"),
    ).toEqual({ category: "standalone" });
    expect(map.get("JOURNAL OF NANOSCIENCE AND TECHNOLOGY")).toEqual({
      category: "hijacked",
    });
  });

  it("matching is case/whitespace insensitive", async () => {
    await reloadIndex();
    const map = await BeallsListStore.batchLookupJournalExact([
      "  international   JOURNAL of advanced research AND publications ",
    ]);
    expect(
      map.get("INTERNATIONAL JOURNAL OF ADVANCED RESEARCH AND PUBLICATIONS"),
    ).toEqual({ category: "standalone" });
  });

  it("does NOT hit on keyword-overlap near-misses (false-positive guard)", async () => {
    await reloadIndex();
    // 与名单条目高度重叠但确属他刊的名字——模糊层会命中，精确层必须不命中
    const map = await BeallsListStore.batchLookupJournalExact([
      "International Journal of Advanced Research",
    ]);
    expect(map.size).toBe(0);
  });

  it("does NOT hit on publisher-level names", async () => {
    await reloadIndex();
    const map = await BeallsListStore.batchLookupJournalExact([
      "OMICS International",
    ]);
    expect(map.size).toBe(0);
  });

  it("empty/duplicate input is safe and deduped", async () => {
    await reloadIndex();
    expect(await BeallsListStore.batchLookupJournalExact([])).toEqual(
      new Map(),
    );
    const map = await BeallsListStore.batchLookupJournalExact([
      "",
      "   ",
      "Journal of Nanoscience and Technology",
      "Journal of Nanoscience and Technology",
    ]);
    expect(map.size).toBe(1);
  });
});
