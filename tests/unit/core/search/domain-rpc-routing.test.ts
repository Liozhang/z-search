/**
 * domain.* RPC 路由验证 — 验证 HubLiteratureHandler 正确分发
 * domain.search / domain.import / domain.profile 到 DomainSearchEngine。
 *
 * 用 mock bridge 捕获 respond 调用，不依赖真实 Zotero 环境。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock 依赖
vi.mock("../../../../src/utils/httpHeaders", () => ({
  ZSEARCH_HTTP_HEADERS: {},
}));
vi.mock("../../../../src/utils/logger", () => ({
  safeDebug: vi.fn(),
}));
vi.mock("../../../../src/utils/prefs", () => ({
  getPrefDynamic: vi.fn(() => ""),
  setPrefDynamic: vi.fn(),
}));

// Mock Zotero globals
(globalThis as any).Zotero = {
  HTTP: {
    request: vi.fn(() => Promise.resolve({ status: 200, responseText: "{}" })),
  },
  Items: { get: vi.fn(() => null) },
  Collections: { get: vi.fn(() => null) },
  Libraries: { get: vi.fn(() => null) },
  Search: class {
    addCondition() {}
    async search() {
      return [];
    }
  },
  Prefs: { clear: vi.fn() },
  getActiveZoteroPane: vi.fn(() => null),
};

// 导入 DomainRegistry（触发注册副作用）
import "../../../../src/core/search/DomainRegistry";
import { getDomainDef } from "../../../../src/core/search/DomainSearchEngine";
import { handleLiteratureRequest } from "../../../../src/ui/hub/HubLiteratureHandler";

describe("domain.* RPC routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dataset domain is registered with 19 sources", () => {
    const def = getDomainDef("dataset");
    expect(def).toBeDefined();
    expect(def!.sources).toHaveLength(19);
    // 验证学科选择器声明的源都在
    const expected = [
      "huggingface",
      "zenodo",
      "kaggle",
      "uci",
      "openml",
      "dryad",
      "datacite-search",
      "re3data",
      "figshare",
      "dataverse",
      "osf",
      "worldbank",
      "gbif",
      "who-gho",
      "oecd",
      "nasa",
      "eurostat",
      "imf",
      "ukds",
    ];
    for (const src of expected) {
      expect(def!.sources).toContain(src);
    }
  });

  it("domain.search routes to dataset domain and returns articles array", async () => {
    let capturedResult: any = null;
    let capturedError: string | null = null;
    const mockBridge = {
      respond: (_id: any, result: any, error: string | null) => {
        capturedResult = result;
        capturedError = error;
      },
    };

    await handleLiteratureRequest(
      mockBridge as any,
      "domain.search",
      {
        domainId: "dataset",
        query: "test",
        maxResults: 5,
        filters: { discipline: "ml", sources: ["huggingface", "uci"] },
      },
      "test-1",
      {} as any,
    );

    // 不应该报 "unknown domain" 或 "missing" 错误
    expect(capturedError).toBeNull();
    // 结果应该包含 articles 数组
    expect(capturedResult).toBeDefined();
    expect(capturedResult.articles).toBeDefined();
    expect(Array.isArray(capturedResult.articles)).toBe(true);
  });

  it("domain.import rejects empty entries array", async () => {
    let capturedError: string | null = null;
    const mockBridge = {
      respond: (_id: any, _result: any, error: string | null) => {
        capturedError = error;
      },
    };

    await handleLiteratureRequest(
      mockBridge as any,
      "domain.import",
      {
        domainId: "dataset",
        entries: [],
      },
      "test-2",
      {} as any,
    );

    expect(capturedError).toContain("missing entries");
  });

  it("domain.profile routes correctly for dataset domain", async () => {
    let capturedError: string | null = null;
    const mockBridge = {
      respond: (_id: any, _result: any, error: string | null) => {
        capturedError = error;
      },
    };

    await handleLiteratureRequest(
      mockBridge as any,
      "domain.profile",
      {
        domainId: "dataset",
        sourceId: "test-id",
      },
      "test-3",
      {} as any,
    );

    // 不应该报 "unknown domain"（说明路由正确）
    expect(capturedError ?? "").not.toContain("unknown domain");
  });

  it("domain.search rejects unknown domainId", async () => {
    let capturedError: string | null = null;
    const mockBridge = {
      respond: (_id: any, _result: any, error: string | null) => {
        capturedError = error;
      },
    };

    await handleLiteratureRequest(
      mockBridge as any,
      "domain.search",
      {
        domainId: "nonexistent",
        query: "test",
      },
      "test-4",
      {} as any,
    );

    expect(capturedError).toContain("unknown domain");
  });
});
