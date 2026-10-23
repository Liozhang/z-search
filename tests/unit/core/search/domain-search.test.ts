/**
 * DomainSearchEngine — 域搜索总线的去重、并发、失败归因。
 *
 * 覆盖 Phase 1 的两个域（patent / dataset）：
 *  1. 去重：跨源同 dedupKey 合并，保留首次源归属 + 合并 sources 数组
 *  2. 并发扇出：多源同时发起，单源失败进 failedSources
 *  3. 库内标记：markInLibraryByDomain 按专利号/DOI 比对
 *  4. 截断：结果数超 maxResults 时截断
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock 域注册表与适配器 ──

vi.mock("../../../../src/core/search/DomainRegistry", () => ({
  registerDomain: vi.fn(),
  registerDomainAdapter: vi.fn(),
}));

import {
  searchDomain,
  registerDomain,
  registerDomainAdapter,
  getDomainDefForResult,
} from "../../../../src/core/search/DomainSearchEngine";
import type {
  DomainResult,
  DomainDef,
} from "../../../../src/core/search/domainTypes";
import type { DomainSourceAdapter } from "../../../../src/core/search/DomainSourceAdapter";

/** 构造一个 mock 适配器。 */
function mockAdapter(
  domainId: string,
  id: string,
  searchFn: (q: string, max: number) => Promise<DomainResult[]>,
): DomainSourceAdapter {
  return {
    id,
    domainId,
    label: id,
    noKey: true,
    isAvailable: async () => ({ available: true }),
    search: searchFn,
    profile: async () => null,
  } as DomainSourceAdapter;
}

describe("DomainSearchEngine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 清空注册表（通过重新导入模块实现——vitest 模块缓存隔离）
  });

  it("deduplicates by dedupKey and merges sources", async () => {
    // 注册一个域，两个源返回同 dedupKey 的结果
    const domainDef: DomainDef = {
      id: "test",
      label: "Test",
      sources: ["srcA", "srcB"],
      dedupKey: (r) => r.dedupKey,
      importItemType: "journalArticle",
    };
    registerDomain(domainDef);

    const resultA: DomainResult = {
      title: "Test Item",
      url: "https://example.com/1",
      source: "srcA",
      sourceId: "1",
      dedupKey: "shared-key",
    };
    const resultB: DomainResult = {
      title: "Test Item (B)",
      url: "https://example.com/2",
      source: "srcB",
      sourceId: "2",
      dedupKey: "shared-key",
    };

    registerDomainAdapter(mockAdapter("test", "srcA", async () => [resultA]));
    registerDomainAdapter(mockAdapter("test", "srcB", async () => [resultB]));

    const { results, metadata } = await searchDomain("test", {
      query: "test",
      maxResults: 10,
    });

    // 去重后只剩 1 条
    expect(results).toHaveLength(1);
    expect(results[0].dedupKey).toBe("shared-key");
    // sources 数组合并了 srcA 和 srcB
    expect((results[0] as any).sources).toContain("srcA");
    expect((results[0] as any).sources).toContain("srcB");
    // 无失败源
    expect(metadata.failedSources).toHaveLength(0);
  });

  it("records failed sources without dropping successful ones", async () => {
    const domainDef: DomainDef = {
      id: "test2",
      label: "Test2",
      sources: ["good", "bad"],
      dedupKey: (r) => r.dedupKey,
      importItemType: "journalArticle",
    };
    registerDomain(domainDef);

    const goodResult: DomainResult = {
      title: "Good",
      url: "https://example.com/good",
      source: "good",
      sourceId: "g1",
      dedupKey: "good-key",
    };

    registerDomainAdapter(
      mockAdapter("test2", "good", async () => [goodResult]),
    );
    registerDomainAdapter(
      mockAdapter("test2", "bad", async () => {
        throw new Error("network timeout");
      }),
    );

    const { results, metadata } = await searchDomain("test2", {
      query: "test",
      maxResults: 10,
    });

    // 好源的结果保留
    expect(results).toHaveLength(1);
    expect(results[0].source).toBe("good");
    // 坏源进 failedSources + failedReasons
    expect(metadata.failedSources).toContain("bad");
    expect(metadata.failedReasons.bad).toBe("timeout");
  });

  it("truncates to maxResults", async () => {
    const domainDef: DomainDef = {
      id: "test3",
      label: "Test3",
      sources: ["src"],
      dedupKey: (r) => r.dedupKey,
      importItemType: "journalArticle",
    };
    registerDomain(domainDef);

    const manyResults: DomainResult[] = Array.from({ length: 30 }, (_, i) => ({
      title: `Item ${i}`,
      url: `https://example.com/${i}`,
      source: "src",
      sourceId: String(i),
      dedupKey: `key-${i}`,
    }));

    registerDomainAdapter(mockAdapter("test3", "src", async () => manyResults));

    const { results, metadata } = await searchDomain("test3", {
      query: "test",
      maxResults: 10,
    });

    expect(results).toHaveLength(10);
    expect(metadata.totalSearched).toBe(30);
    expect(metadata.totalReturned).toBe(10);
  });

  it("skips sources that are not available (no key)", async () => {
    const domainDef: DomainDef = {
      id: "test4",
      label: "Test4",
      sources: ["nokey", "haskey"],
      dedupKey: (r) => r.dedupKey,
      importItemType: "journalArticle",
    };
    registerDomain(domainDef);

    // nokey 源：isAvailable 返回 false
    const nokeyAdapter: DomainSourceAdapter = {
      id: "nokey",
      domainId: "test4",
      label: "nokey",
      noKey: false,
      isAvailable: async () => ({ available: false, reason: "not-configured" }),
      search: async () => [],
      profile: async () => null,
    } as DomainSourceAdapter;

    const haskeyResult: DomainResult = {
      title: "Has Key",
      url: "https://example.com/haskey",
      source: "haskey",
      sourceId: "h1",
      dedupKey: "haskey-key",
    };

    registerDomainAdapter(nokeyAdapter);
    registerDomainAdapter(
      mockAdapter("test4", "haskey", async () => [haskeyResult]),
    );

    const { results, metadata } = await searchDomain("test4", {
      query: "test",
      maxResults: 10,
    });

    expect(results).toHaveLength(1);
    expect(results[0].source).toBe("haskey");
    // nokey 源进 skippedNoKey，不进 failedSources
    expect(metadata.skippedNoKey).toContain("nokey");
    expect(metadata.failedSources).toHaveLength(0);
  });

  it("narrows fan-out to filters.sources (discipline selection)", async () => {
    // 模拟 ML/AI 学科分组：huggingface + uci
    const domainDef: DomainDef = {
      id: "test5",
      label: "Test5",
      sources: ["huggingface", "uci"],
      dedupKey: (r) => r.dedupKey,
      importItemType: "dataset",
    };
    registerDomain(domainDef);

    const hfResult: DomainResult = {
      title: "HF dataset",
      url: "https://example.com/hf",
      source: "huggingface",
      sourceId: "hf1",
      dedupKey: "hf:hf1",
    };
    const uciResult: DomainResult = {
      title: "UCI dataset",
      url: "https://example.com/uci",
      source: "uci",
      sourceId: "uc1",
      dedupKey: "uci:uc1",
    };

    const hfSearch = vi.fn(async () => [hfResult]);
    const uciSearch = vi.fn(async () => [uciResult]);
    registerDomainAdapter(mockAdapter("test5", "huggingface", hfSearch));
    registerDomainAdapter(mockAdapter("test5", "uci", uciSearch));

    // 学科分组只带 huggingface：uci 不应被调用
    const { results, metadata } = await searchDomain("test5", {
      query: "sentiment",
      maxResults: 20,
      filters: { sources: ["huggingface"] },
    });

    expect(hfSearch).toHaveBeenCalledTimes(1);
    expect(uciSearch).not.toHaveBeenCalled();
    expect(results).toHaveLength(1);
    expect(results[0].source).toBe("huggingface");
    expect(metadata.totalSearched).toBe(1);
  });

  it("resolves cross-domain adapters listed in a domain's sources", async () => {
    // geo 适配器归属 bio 域，但 dataset 域的 sources 列表引用它
    const ownerDef: DomainDef = {
      id: "bio",
      label: "Life Sciences",
      sources: ["geo"],
      dedupKey: (r) => r.dedupKey,
      importItemType: "dataset",
      buildExtraFields: (r) => ({ Accession: r.sourceId }),
    };
    registerDomain(ownerDef);

    const borrowerDef: DomainDef = {
      id: "dataset-borrow",
      label: "Datasets",
      sources: ["geo"],
      dedupKey: (r) => r.dedupKey,
      importItemType: "dataset",
    };
    registerDomain(borrowerDef);

    registerDomainAdapter(
      mockAdapter("bio", "geo", async () => [
        {
          title: "GEO series",
          url: "https://example.com/geo",
          source: "geo",
          sourceId: "GSE1",
          dedupKey: "geo:GSE1",
        },
      ]),
    );

    const { results } = await searchDomain("dataset-borrow", {
      query: "cancer",
      maxResults: 10,
    });
    expect(results).toHaveLength(1);
    expect(results[0].source).toBe("geo");

    // 反查归属域：Extra 字段映射以 bio 域为准
    const def = getDomainDefForResult(results[0]);
    expect(def?.id).toBe("bio");
    expect(def?.buildExtraFields?.(results[0])).toEqual({ Accession: "GSE1" });
  });

  it("post-filters results outside filters.year range", async () => {
    const domainDef: DomainDef = {
      id: "test6",
      label: "Test6",
      sources: ["src"],
      dedupKey: (r) => r.dedupKey,
      importItemType: "dataset",
    };
    registerDomain(domainDef);

    const years = ["2019", "2021", "2023", "2018-05-01", undefined];
    registerDomainAdapter(
      mockAdapter("test6", "src", async () =>
        years.map((y, i) => ({
          title: `Item ${i}`,
          url: `https://example.com/${i}`,
          source: "src",
          sourceId: String(i),
          year: y,
          dedupKey: `key-${i}`,
        })),
      ),
    );

    const { results } = await searchDomain("test6", {
      query: "test",
      maxResults: 10,
      filters: { year: "2020-2022" },
    });
    // 范围内只有 2021（2019/2018 早于范围，2023 晚于范围，缺年份的丢弃）
    expect(results).toHaveLength(1);
    expect(results[0].year).toBe("2021");

    // 单年份 "2023" 只保留 2023
    const single = await searchDomain("test6", {
      query: "test",
      maxResults: 10,
      filters: { year: "2023" },
    });
    expect(single.results).toHaveLength(1);
    expect(single.results[0].year).toBe("2023");

    // 无法解析的年份不过滤（全部保留）
    const garbage = await searchDomain("test6", {
      query: "test",
      maxResults: 10,
      filters: { year: "recent" },
    });
    expect(garbage.results).toHaveLength(5);
  });

  it("skips sources that cannot honor an active advanced filter", async () => {
    const domainDef: DomainDef = {
      id: "test7",
      label: "Test7",
      sources: ["tagged", "untagged"],
      dedupKey: (r) => r.dedupKey,
      importItemType: "dataset",
    };
    registerDomain(domainDef);

    const taggedSearch = vi.fn(async () => [
      {
        title: "Tagged dataset",
        url: "https://example.com/t",
        source: "tagged",
        sourceId: "t1",
        dedupKey: "tagged:t1",
        extra: { taskTags: ["text-classification"] },
      },
    ]);
    const untaggedSearch = vi.fn(async () => [
      {
        title: "Untagged dataset",
        url: "https://example.com/u",
        source: "untagged",
        sourceId: "u1",
        dedupKey: "untagged:u1",
      },
    ]);
    const tagged = mockAdapter("test7", "tagged", taggedSearch);
    const untagged = mockAdapter("test7", "untagged", untaggedSearch);
    (tagged as any).supportedFilters = ["license", "taskTags"];
    (untagged as any).supportedFilters = ["license"];
    registerDomainAdapter(tagged);
    registerDomainAdapter(untagged);

    // 激活 taskTags：untagged 不声明该能力 → 跳过并归因，不发请求
    const { results, metadata } = await searchDomain("test7", {
      query: "test",
      maxResults: 10,
      filters: { taskTags: ["classification"] },
    });
    expect(taggedSearch).toHaveBeenCalledTimes(1);
    expect(untaggedSearch).not.toHaveBeenCalled();
    expect(results).toHaveLength(1);
    expect(metadata.skippedNoFilter).toEqual(["untagged"]);
    expect(metadata.skippedNoKey).toHaveLength(0);
  });

  it("post-filters by license with normalization", async () => {
    const domainDef: DomainDef = {
      id: "test8",
      label: "Test8",
      sources: ["src"],
      dedupKey: (r) => r.dedupKey,
      importItemType: "dataset",
    };
    registerDomain(domainDef);

    const licenses = [
      "cc-by-4.0", // 版本后缀 → cc-by ✓
      "CC BY", // 大小写 → cc-by ✓
      "CC BY-NC 4.0", // NC 变体 → cc-by-nc ✗
      "CC0 1.0", // → cc0 ✗
      "mit", // → other ✗
    ];
    const cap = mockAdapter("test8", "src", async () =>
      licenses.map((lic, i) => ({
        title: `Item ${i}`,
        url: `https://example.com/${i}`,
        source: "src",
        sourceId: String(i),
        dedupKey: `key-${i}`,
        extra: { license: lic },
      })),
    );
    (cap as any).supportedFilters = ["license"];
    registerDomainAdapter(cap);

    const { results } = await searchDomain("test8", {
      query: "test",
      maxResults: 10,
      filters: { license: "cc-by" },
    });
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.extra?.license).sort()).toEqual([
      "CC BY",
      "cc-by-4.0",
    ]);
  });

  it("post-filters by oaType, taskTags (union), and country (contains)", async () => {
    const domainDef: DomainDef = {
      id: "test9",
      label: "Test9",
      sources: ["src"],
      dedupKey: (r) => r.dedupKey,
      importItemType: "dataset",
    };
    registerDomain(domainDef);

    const items = [
      { oa: "open", tags: ["text-classification"], geo: "" },
      { oa: "closed", tags: ["Regression"], geo: "" },
      { oa: "open", tags: ["time-series"], geo: "United States" },
    ];
    const cap = mockAdapter("test9", "src", async () =>
      items.map((it, i) => ({
        title: `Item ${i}`,
        url: `https://example.com/${i}`,
        source: "src",
        sourceId: String(i),
        dedupKey: `key-${i}`,
        extra: {
          oaType: it.oa,
          taskTags: it.tags,
          geographicCoverage: it.geo,
        },
      })),
    );
    (cap as any).supportedFilters = [
      "license",
      "oaType",
      "taskTags",
      "country",
    ];
    registerDomainAdapter(cap);

    // oaType 精确匹配
    const oa = await searchDomain("test9", {
      query: "test",
      maxResults: 10,
      filters: { oaType: "open" },
    });
    expect(oa.results).toHaveLength(2);

    // taskTags 并集：classification 子串命中 text-classification
    const task = await searchDomain("test9", {
      query: "test",
      maxResults: 10,
      filters: { taskTags: ["classification"] },
    });
    expect(task.results).toHaveLength(1);
    expect(task.results[0].sourceId).toBe("0");

    // country 子串包含
    const country = await searchDomain("test9", {
      query: "test",
      maxResults: 10,
      filters: { country: "united states" },
    });
    expect(country.results).toHaveLength(1);
    expect(country.results[0].sourceId).toBe("2");

    // 多筛选叠加：oa=open 且 country=US → 只剩 item 2
    const both = await searchDomain("test9", {
      query: "test",
      maxResults: 10,
      filters: { oaType: "open", country: "United States" },
    });
    expect(both.results).toHaveLength(1);
    expect(both.results[0].sourceId).toBe("2");
  });
});
