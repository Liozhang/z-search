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

  it("dataset domain is registered with 23 sources", () => {
    const def = getDomainDef("dataset");
    expect(def).toBeDefined();
    expect(def!.sources).toHaveLength(23);
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
      // 学科专用源：适配器归属 bio/chemistry/geoscience/social-science 域，
      // 经跨域索引在 dataset 域下解析
      "geo",
      "pubchem",
      "pangaea",
      "icpsr",
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
        source: "huggingface",
        sourceId: "test-id",
      },
      "test-3",
      {} as any,
    );

    // 不应该报 "unknown domain"（说明路由正确）
    expect(capturedError ?? "").not.toContain("unknown domain");
  });

  it("domain.profile rejects missing source", async () => {
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
        domainId: "researcher",
        sourceId: "0000-0002-1825-0097",
      },
      "test-5",
      {} as any,
    );

    expect(capturedError).toContain("missing source");
  });

  it("domain.profile routes ORCID iD to ORCID adapter and maps record fields", async () => {
    // ORCID /record 样例响应（ Josiah Carberry 是 ORCID 官方文档虚构学者）
    const recordJson = JSON.stringify({
      person: {
        name: {
          "given-names": { value: "Josiah" },
          "family-name": { value: "Carberry" },
        },
        biography: { value: "Fictional professor of psychoceramics." },
        keywords: { keyword: [{ content: "psychoceramics" }] },
        employments: {
          "employment-summary": [
            {
              organization: { name: "Alpha University" },
              "role-title": "Professor",
              department: "Department of Psychoceramics",
              "start-date": { year: { value: "2000" } },
              "end-date": null,
            },
          ],
        },
      },
      "activities-summary": {
        works: { group: [{}, {}] },
      },
    });
    const httpRequest = vi.fn(() =>
      Promise.resolve({ status: 200, responseText: recordJson }),
    );
    (globalThis as any).Zotero.HTTP.request = httpRequest;

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
      "domain.profile",
      {
        domainId: "researcher",
        source: "orcid",
        sourceId: "0000-0002-1825-0097",
      },
      "test-6",
      {} as any,
    );

    expect(capturedError).toBeNull();
    // 记录 ID 只发往 ORCID /record 端点，不会被误投 OpenAlex / Semantic Scholar
    const requestedUrls = httpRequest.mock.calls.map((call: any[]) =>
      String(call[1]),
    );
    expect(requestedUrls.length).toBeGreaterThan(0);
    for (const url of requestedUrls) {
      expect(url).toContain("pub.orcid.org/v3.0/0000-0002-1825-0097/record");
      expect(url).not.toContain("openalex.org");
      expect(url).not.toContain("semanticscholar.org");
    }
    // 字段映射：姓名 / 作品数 / 履历 / 关键词 / 简介
    expect(capturedResult.title).toBe("Josiah Carberry");
    expect(capturedResult.metrics.works).toBe(2);
    expect(capturedResult.extra.employments[0].organization).toBe(
      "Alpha University",
    );
    expect(capturedResult.extra.employments[0].role).toBe("Professor");
    expect(capturedResult.extra.employments[0].startDate).toBe("2000");
    expect(capturedResult.extra.keywords).toContain("psychoceramics");
    expect(capturedResult.extra.biography).toContain("psychoceramics");
  });

  it("domain.profile returns null for unknown source adapter", async () => {
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
      "domain.profile",
      {
        domainId: "researcher",
        source: "nonexistent-source",
        sourceId: "some-id",
      },
      "test-7",
      {} as any,
    );

    // 未知适配器：不报错，返回 null（前端走「暂无详情」空态）
    expect(capturedError).toBeNull();
    expect(capturedResult).toBeNull();
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
