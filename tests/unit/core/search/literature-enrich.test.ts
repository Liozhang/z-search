/**
 * enrichJournalMetrics — 文献结果卡富集的字段写入与静默失败。
 *
 * 宿主侧 literature.search 在去重后调用本函数，卡片徽章的四个数据源
 * （JCR/CASS 按 ISSN、预警与 Beall's 按期刊名）在此一次性并查。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../src/core/data/JCRStore", () => ({
  default: { batchLookupByIssn: vi.fn() },
}));
vi.mock("../../../../src/core/data/CASSStore", () => ({
  default: { batchLookupByIssn: vi.fn() },
}));
vi.mock("../../../../src/core/data/WarningListStore", () => ({
  default: { batchLookupWarnings: vi.fn() },
}));
vi.mock("../../../../src/core/data/BeallsListStore", () => ({
  default: { batchLookupJournalExact: vi.fn() },
}));

import JCRStore from "../../../../src/core/data/JCRStore";
import CASSStore from "../../../../src/core/data/CASSStore";
import WarningListStore from "../../../../src/core/data/WarningListStore";
import BeallsListStore from "../../../../src/core/data/BeallsListStore";
import { enrichJournalMetrics } from "../../../../src/core/search/literatureSearchHelpers";

const jcrLookup = JCRStore.batchLookupByIssn as unknown as ReturnType<
  typeof vi.fn
>;
const cassLookup = CASSStore.batchLookupByIssn as unknown as ReturnType<
  typeof vi.fn
>;
const warnLookup =
  WarningListStore.batchLookupWarnings as unknown as ReturnType<typeof vi.fn>;
const beallsLookup =
  BeallsListStore.batchLookupJournalExact as unknown as ReturnType<
    typeof vi.fn
  >;

function emptyMaps() {
  jcrLookup.mockResolvedValue(new Map());
  cassLookup.mockResolvedValue(new Map());
  warnLookup.mockResolvedValue(new Map());
  beallsLookup.mockResolvedValue(new Map());
}

describe("enrichJournalMetrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    emptyMaps();
  });

  it("assigns jif/quartiles/warning/beallsHit from the four stores", async () => {
    jcrLookup.mockResolvedValue(
      new Map([["12345678", { jif: 3.5, jif_quartile: "Q1" }]]),
    );
    cassLookup.mockResolvedValue(
      new Map([
        [
          "12345678",
          { major_quartile: 2, major_category: "医学", is_top: true },
        ],
      ]),
    );
    warnLookup.mockResolvedValue(
      new Map([["PREDATORY JOURNAL OF SCIENCE", { warning_level: "高" }]]),
    );
    beallsLookup.mockResolvedValue(
      new Map([["PREDATORY JOURNAL OF SCIENCE", { category: "standalone" }]]),
    );

    const articles = [
      { issn: "1234-5678", journalName: "Predatory Journal of Science" },
    ];
    await enrichJournalMetrics(articles);

    expect(articles[0]).toMatchObject({
      jif: 3.5,
      jcrQuartile: "Q1",
      cassQuartile: 2,
      cassCategory: "医学",
      cassIsTop: true,
      warningLevel: "高",
      beallsHit: { category: "standalone" },
    });
  });

  it("name-keyed lookups work for ISSN-less articles", async () => {
    warnLookup.mockResolvedValue(
      new Map([["SOME JOURNAL", { warning_level: "中" }]]),
    );
    beallsLookup.mockResolvedValue(
      new Map([["SOME JOURNAL", { category: "hijacked" }]]),
    );

    const articles = [{ containerTitle: "Some Journal" }];
    await enrichJournalMetrics(articles);

    expect(articles[0].warningLevel).toBe("中");
    expect(articles[0].beallsHit).toEqual({ category: "hijacked" });
    expect(articles[0].jif).toBeUndefined(); // 无 ISSN → JCR/CASS 跳过
  });

  it("swallows store failures — search must never break on metrics", async () => {
    jcrLookup.mockRejectedValue(new Error("db locked"));

    const articles = [{ issn: "1234-5678", journalName: "Any Journal" }];
    await expect(enrichJournalMetrics(articles)).resolves.toBeUndefined();
    expect(articles[0].jif).toBeUndefined();
    expect(articles[0].beallsHit).toBeUndefined();
  });
});
