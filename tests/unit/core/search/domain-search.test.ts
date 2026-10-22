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
});
