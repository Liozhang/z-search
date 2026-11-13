/**
 * literature.search 标识符分流 + AcademicQueryAdapter 哨兵。
 *
 * 用户实测回归（2026-11-13）：DOI 整串进检索框，此前走关键词扇出，
 * Crossref/OpenAlex 按数字碎片相关度匹配返回一堆无关文章。现在：
 *  1. literature.search 对标识符查询走精确反查，回执带 identifierLookup
 *     （命中/未命中/故障三种归因，界面据此给不同提示）
 *  2. AcademicQueryAdapter 对标识符查询不再拆词、不再送 LLM 改写
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock 依赖 ──
vi.mock("../../../../src/utils/httpHeaders", () => ({
  ZSEARCH_HTTP_HEADERS: {},
}));
vi.mock("../../../../src/utils/logger", () => ({ safeDebug: vi.fn() }));
vi.mock("../../../../src/utils/prefs", () => ({
  getPrefDynamic: vi.fn(() => ""),
  setPrefDynamic: vi.fn(),
}));
vi.mock("../../../../src/utils/openalexThrottle", () => ({
  openalexThrottle: vi.fn(async () => {}),
}));
vi.mock("../../../../src/utils/ncbiThrottle", () => ({
  ncbiThrottle: vi.fn(async () => {}),
}));
// 适配器哨兵用例不需要真 provider：命哨兵时 llmAdapt 根本不该被调用
vi.mock("../../../../src/core/ai/AIProviderRegistry", () => ({
  default: { getProviderForFeature: vi.fn(() => null) },
}));

// ── Zotero.HTTP 桩：按 URL 分流，>=400 抛错 ──
type Route = (url: string) => { status: number; responseText: string };
let route: Route = () => ({ status: 404, responseText: "{}" });

const httpRequest = vi.fn(async (_method: string, url: string) => {
  const r = route(url);
  if (r.status >= 400) {
    const err: any = new Error(`HTTP ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return r;
});

(globalThis as any).Zotero = {
  HTTP: { request: (...args: any[]) => httpRequest(...args) },
  Items: { get: vi.fn(() => null) },
  Search: class {
    addCondition() {}
    async search() {
      return [];
    }
  },
  Prefs: { clear: vi.fn() },
  getActiveZoteroPane: vi.fn(() => null),
};

// DomainRegistry 是副作用模块：import 即完成子域注册（handler 依赖）
import "../../../../src/core/search/DomainRegistry";
import { handleLiteratureRequest } from "../../../../src/ui/hub/HubLiteratureHandler";
import { AcademicQueryAdapter } from "../../../../src/core/search/AcademicQueryAdapter";

const CROSSREF_WORK = {
  DOI: "10.1038/s41586-021-03819-2",
  title: ["Highly accurate protein structure prediction with AlphaFold"],
  author: [{ given: "John", family: "Jumper" }],
  published: { "date-parts": [[2021, 7, 15]] },
  "container-title": ["Nature"],
  "is-referenced-by-count": 30000,
  URL: "https://doi.org/10.1038/s41586-021-03819-2",
};

/** 捕获 respond 回执。 */
async function callSearch(payload: any): Promise<{
  result: any;
  error: string | null;
}> {
  let captured: any = null;
  let capturedError: string | null = null;
  const bridge = {
    respond: (_id: any, result: any, error: string | null) => {
      captured = result;
      capturedError = error;
    },
  };
  await handleLiteratureRequest(
    bridge as any,
    "literature.search",
    payload,
    "t-1",
    {} as any,
  );
  return { result: captured, error: capturedError };
}

beforeEach(() => {
  httpRequest.mockClear();
  route = () => ({ status: 404, responseText: "{}" });
});

describe("literature.search 标识符分流", () => {
  it("DOI 命中：单篇精确结果 + identifierLookup.found=true", async () => {
    route = (url) =>
      url.includes("api.crossref.org/works/")
        ? {
            status: 200,
            responseText: JSON.stringify({ message: CROSSREF_WORK }),
          }
        : { status: 404, responseText: "{}" };

    const { result, error } = await callSearch({
      query: "10.1038/s41586-021-03819-2",
      // 年份/源/排序等关键词语义的参数在标识符路径上一并被忽略
      year: "2020-2026",
      sources: ["arxiv", "pubmed"],
      sort: "cited",
      maxResults: 20,
    });

    expect(error).toBeNull();
    expect(result.articles).toHaveLength(1);
    expect(result.articles[0].title).toContain("AlphaFold");
    expect(result.articles[0].doi).toBe("10.1038/s41586-021-03819-2");
    expect(result.articles[0].source).toBe("crossref");
    expect(result.identifierLookup).toMatchObject({
      kind: "doi",
      value: "10.1038/s41586-021-03819-2",
      found: true,
      source: "crossref",
    });
  });

  it("DOI 未命中：零结果 + found=false + 无 error（真实未找到）", async () => {
    const { result } = await callSearch({ query: "10.1038/nope-nope" });
    expect(result.articles).toHaveLength(0);
    expect(result.identifierLookup.found).toBe(false);
    expect(result.identifierLookup.error).toBeUndefined();
  });

  it("DOI 接口故障：found=false + error 非空（不得谎报未找到）", async () => {
    route = () => {
      throw new Error("connection reset");
    };
    const { result } = await callSearch({
      query: "10.1038/s41586-021-03819-2",
    });
    expect(result.articles).toHaveLength(0);
    expect(result.identifierLookup.found).toBe(false);
    expect(result.identifierLookup.error).toBe("network");
  });

  it("普通关键词查询不走标识符路径（无 identifierLookup 回执）", async () => {
    route = () => ({
      status: 200,
      responseText: JSON.stringify({ message: { items: [] } }),
    });
    const { result, error } = await callSearch({
      query: "deep learning protein structure",
      sources: ["crossref"],
    });
    expect(error).toBeNull();
    expect(result.identifierLookup).toBeUndefined();
    expect(result.articles).toEqual([]);
  });
});

describe("AcademicQueryAdapter 标识符哨兵", () => {
  const adapter = new AcademicQueryAdapter();
  const doi = "10.1038/s41586-021-03819-2";

  it("adapt：六个引擎原样透传，不拆词", async () => {
    const q = await adapter.adapt(doi);
    expect(q.pubmed).toBe(doi);
    expect(q.arxiv).toBe(doi);
    expect(q.crossref).toBe(doi);
    expect(q["semantic-scholar"]).toBe(doi);
    expect(q.openalex).toBe(doi);
    expect(q["europe-pmc"]).toBe(doi);
  });

  it("adaptForReview：同样透传", async () => {
    const q = await adapter.adaptForReview(doi);
    expect(q.pubmed).toBe(doi);
    expect(q.crossref).toBe(doi);
  });

  it("普通查询仍走规则改写（哨兵不误伤）", async () => {
    const q = await adapter.adapt("deep learning for protein structure");
    // 规则路径会给 PubMed 的非 MeSH 词带上字段标签（与哨兵透传不同）
    expect(q.pubmed).toContain("[All Fields]");
    expect(q.pubmed).not.toBe("deep learning for protein structure");
  });
});
