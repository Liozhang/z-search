/**
 * 区域限定端点的消费侧单测：EasyScholar / MinerU 云 / 维基百科。
 *
 * 三个服务的端点都只在其所属区域运营，覆盖 pref 是跨境用户的常规操作——
 * 这里锁死「覆盖生效、内置回落、坏值不生效」三态，防回归成硬编码域名。
 *
 * @module tests/unit/core/region-endpoints
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  prefs: new Map<string, any>(),
  httpRequest: vi.fn(),
  debug: [] as string[],
}));

vi.hoisted(() => {
  const full = (key: string) =>
    key.startsWith("extensions.zotero.zsearch.")
      ? key
      : `extensions.zotero.zsearch.${key}`;
  (globalThis as any).Zotero = {
    debug: (...args: any[]) => h.debug.push(args.map(String).join(" ")),
    locale: "en-US",
    Prefs: {
      get: (key: string) => h.prefs.get(full(key)),
      set: (key: string, value: any) => {
        h.prefs.set(full(key), value);
      },
    },
    HTTP: {
      request: (...args: any[]) => h.httpRequest(...args),
    },
  };
});

beforeEach(() => {
  h.prefs.clear();
  h.httpRequest.mockReset();
  h.debug.length = 0;
});

// ── EasyScholar ──────────────────────────────────────────────────────

describe("EasyScholar 端点覆盖", () => {
  it("无覆盖时用内置端点", async () => {
    const { batchLookupChineseCore } =
      await import("../../../src/core/data/EasyScholarClient");
    h.prefs.set("extensions.zotero.zsearch.apis.easyscholar.apiKey", "k");
    h.httpRequest.mockResolvedValue({
      responseText: JSON.stringify({ code: 200, data: { 北大核心: "2023" } }),
    });
    const out = await batchLookupChineseCore(["某期刊"]);
    expect(out.get("某期刊")).toEqual(["pku"]);
    const url = String(h.httpRequest.mock.calls[0][1]);
    expect(
      url.startsWith("https://www.easyscholar.cc/openapi/api/paper/query?"),
    ).toBe(true);
  });

  it("apis.easyscholar.serverUrl 覆盖为自建代理", async () => {
    const { resolveEasyScholarEndpoint } =
      await import("../../../src/core/data/EasyScholarClient");
    h.prefs.set(
      "extensions.zotero.zsearch.apis.easyscholar.serverUrl",
      "https://mirror.example.com/openapi/api/paper/query/",
    );
    expect(resolveEasyScholarEndpoint()).toBe(
      "https://mirror.example.com/openapi/api/paper/query",
    );
  });

  it("非法覆盖（无协议 / 非字符串）回落内置端点", async () => {
    const { resolveEasyScholarEndpoint } =
      await import("../../../src/core/data/EasyScholarClient");
    h.prefs.set(
      "extensions.zotero.zsearch.apis.easyscholar.serverUrl",
      "mirror.example.com",
    );
    expect(resolveEasyScholarEndpoint()).toContain("easyscholar.cc");
    h.prefs.set("extensions.zotero.zsearch.apis.easyscholar.serverUrl", "   ");
    expect(resolveEasyScholarEndpoint()).toContain("easyscholar.cc");
  });
});

// ── MinerU 云 ────────────────────────────────────────────────────────

describe("MinerU 云端端点覆盖", () => {
  it("无覆盖时用内置 mineru.net", async () => {
    const { loadMinerUConfig } =
      await import("../../../src/core/pdf/MinerUApiClient");
    expect(loadMinerUConfig().cloudBaseUrl).toBe("https://mineru.net/api/v4");
  });

  it("pdfParser.mineru.cloudUrl 覆盖生效（并去尾斜杠）", async () => {
    const { loadMinerUConfig } =
      await import("../../../src/core/pdf/MinerUApiClient");
    h.prefs.set(
      "extensions.zotero.zsearch.pdfParser.mineru.cloudUrl",
      "https://proxy.example.com/mineru/api/v4/",
    );
    expect(loadMinerUConfig().cloudBaseUrl).toBe(
      "https://proxy.example.com/mineru/api/v4",
    );
  });

  it("非法覆盖回落内置端点", async () => {
    const { loadMinerUConfig } =
      await import("../../../src/core/pdf/MinerUApiClient");
    h.prefs.set(
      "extensions.zotero.zsearch.pdfParser.mineru.cloudUrl",
      "mineru.net/api/v4",
    );
    expect(loadMinerUConfig().cloudBaseUrl).toBe("https://mineru.net/api/v4");
  });
});

// ── JRE 下载镜像 ─────────────────────────────────────────────────────

describe("Adoptium JRE 下载镜像", () => {
  it("无覆盖时用官方 api.adoptium.net", async () => {
    const { resolveAdoptiumBase } =
      await import("../../../src/core/pdf/JavaRuntimeManager");
    expect(resolveAdoptiumBase()).toBe("https://api.adoptium.net/v3");
  });

  it("pdfParser.opendataloader.jreMirror 覆盖生效（去尾斜杠）", async () => {
    const { resolveAdoptiumBase } =
      await import("../../../src/core/pdf/JavaRuntimeManager");
    h.prefs.set(
      "extensions.zotero.zsearch.pdfParser.opendataloader.jreMirror",
      "https://mirror.example.com/adoptium/v3/",
    );
    expect(resolveAdoptiumBase()).toBe(
      "https://mirror.example.com/adoptium/v3",
    );
  });

  it("非法覆盖回落官方地址", async () => {
    const { resolveAdoptiumBase } =
      await import("../../../src/core/pdf/JavaRuntimeManager");
    h.prefs.set(
      "extensions.zotero.zsearch.pdfParser.opendataloader.jreMirror",
      "mirror.example.com/adoptium",
    );
    expect(resolveAdoptiumBase()).toBe("https://api.adoptium.net/v3");
  });
});

// ── 维基百科 ─────────────────────────────────────────────────────────

describe("维基百科域名跟随界面语言", () => {
  it("中文界面打中文维基（构建请求 URL 与结果 URL 同域）", async () => {
    const { default: webSearchProvider } =
      await import("../../../src/core/search/WebSearchProvider");
    (globalThis as any).Zotero.locale = "zh-CN";
    h.httpRequest.mockResolvedValue({
      status: 200,
      responseText: JSON.stringify({
        query: { searchinfo: { totalhits: 1 }, search: [{ title: "引力波" }] },
      }),
    });
    const out = await webSearchProvider.search({
      query: "引力波",
      provider: "wikipedia",
    });
    expect(out.error).toBeUndefined();
    const url = String(h.httpRequest.mock.calls[0][1]);
    expect(url.startsWith("https://zh.wikipedia.org/w/api.php?")).toBe(true);
    expect(out.results[0].url).toBe(
      "https://zh.wikipedia.org/wiki/%E5%BC%95%E5%8A%9B%E6%B3%A2",
    );
  });

  it("英文界面仍打英文维基", async () => {
    const { default: webSearchProvider } =
      await import("../../../src/core/search/WebSearchProvider");
    (globalThis as any).Zotero.locale = "en-US";
    h.httpRequest.mockResolvedValue({
      status: 200,
      responseText: JSON.stringify({
        query: {
          searchinfo: { totalhits: 1 },
          search: [{ title: "Gravity wave" }],
        },
      }),
    });
    await webSearchProvider.search({ query: "gravity", provider: "wikipedia" });
    expect(
      String(h.httpRequest.mock.calls[0][1]).startsWith(
        "https://en.wikipedia.org/w/api.php?",
      ),
    ).toBe(true);
  });

  it("search.web.wikipedia.host 覆盖为镜像/其它语言站", async () => {
    const { default: webSearchProvider } =
      await import("../../../src/core/search/WebSearchProvider");
    (globalThis as any).Zotero.locale = "en-US";
    h.prefs.set(
      "extensions.zotero.zsearch.search.web.wikipedia.host",
      "zh.m.wikipedia.org",
    );
    h.httpRequest.mockResolvedValue({
      status: 200,
      responseText: JSON.stringify({
        query: { searchinfo: { totalhits: 1 }, search: [{ title: "引力波" }] },
      }),
    });
    await webSearchProvider.search({ query: "引力波", provider: "wikipedia" });
    expect(
      String(h.httpRequest.mock.calls[0][1]).startsWith(
        "https://zh.m.wikipedia.org/w/api.php?",
      ),
    ).toBe(true);
  });
});
