/**
 * StructuredFullTextClient — P1-D 拉取客户端单测。
 *
 * AICache / Zotero.HTTP / Zotero.Prefs 全 mock。覆盖：
 *   - PMC 链路：idconv → pmcid → efetch，URL 形状与 XML 校验门
 *   - 负缓存：PMC miss 后同 DOI 第二次调用不再打网络
 *   - 正缓存：命中直接返回、零网络
 *   - OpenAlex key 门控：无 key 不打 content API；有 key 走 W-id 解析
 *   - 来源降级：PMC 失败 → OpenAlex 兜底
 *   - DOI 归一与非法输入
 *   - 文章级编排入口：PMCID 直取（跳过 idconv）/ PMID 反查 / DOI 优先短路 /
 *     DOI 链失败回退 PMID / PMID 负缓存 / 标识全空零网络
 *
 * @module tests/unit/core/pdf/StructuredFullTextClient
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  return {
    cacheGet: vi.fn(),
    cacheSet: vi.fn(),
    httpGet: vi.fn(),
    prefs: new Map<string, any>(),
  };
});

vi.mock("../../../../src/core/cache/AICache", () => ({
  default: { get: h.cacheGet, set: h.cacheSet },
  CacheKeys: {
    structuredXml: (source: string, doi: string) =>
      `content:structured-xml:${source}:${doi}`,
  },
}));

vi.hoisted(() => {
  (globalThis as any).Zotero = {
    debug: () => {},
    Items: { get: (_id: number) => null },
    Prefs: {
      get: (key: string) => {
        const full = key.startsWith("extensions.zotero.zsearch.")
          ? key
          : `extensions.zotero.zsearch.${key}`;
        return (globalThis as any).__prefs?.get(full);
      },
    },
    HTTP: {
      request: (...args: any[]) => (globalThis as any).__httpGet(...args),
    },
  };
  (globalThis as any).__prefs = h.prefs;
  (globalThis as any).__httpGet = h.httpGet;
});

import {
  fetchStructuredXmlByDoi,
  fetchStructuredXmlForArticle,
  normalizeDoi,
  fetchStructuredXmlForItem,
} from "../../../../src/core/pdf/StructuredFullTextClient";

const PMC_XML =
  "<article><body><sec sec-type='methods'><p>x</p></sec></body></article>";
const GROBID_XML =
  "<TEI xmlns='http://www.tei-c.org/ns/1.0'><text><body><div><p>x</p></div></body></text></TEI>";

function mockHttpResponse(
  byUrl: (url: string) => { status: number; text: string } | null,
) {
  h.httpGet.mockImplementation(async (_m: string, url: string) => {
    const r = byUrl(url);
    if (!r) return { status: 404, responseText: "" };
    return { status: r.status, responseText: r.text };
  });
}

describe("StructuredFullTextClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.prefs.clear();
    h.cacheGet.mockResolvedValue(null);
  });

  it("normalizeDoi strips url prefixes and lowercases", () => {
    expect(normalizeDoi("https://doi.org/10.1234/ABC.def")).toBe(
      "10.1234/abc.def",
    );
    expect(normalizeDoi("doi: 10.1234/X")).toBe("10.1234/x");
    expect(normalizeDoi("")).toBeNull();
    expect(normalizeDoi(null)).toBeNull();
  });

  it("PMC chain: idconv → pmcid → efetch, returns jats result", async () => {
    mockHttpResponse((url) => {
      if (url.includes("/pmc/utils/idconv")) {
        expect(url).toContain("10.1234%2Fabc");
        return {
          status: 200,
          text: JSON.stringify({ records: [{ pmcid: "PMC123" }] }),
        };
      }
      if (url.includes("efetch.fcgi") && url.includes("db=pmc")) {
        expect(url).toContain("id=PMC123");
        return { status: 200, text: PMC_XML };
      }
      return null;
    });
    const r = await fetchStructuredXmlByDoi("10.1234/ABC");
    expect(r).toEqual({ xml: PMC_XML, source: "pmc-jats" });
    // 正缓存写入
    expect(h.cacheSet).toHaveBeenCalledWith(
      "content:structured-xml:pmc:10.1234/abc",
      { xml: PMC_XML, source: "pmc-jats" },
      expect.any(Number),
    );
  });

  it("idconv without pmcid → negative-cached, second call hits no network", async () => {
    // 该例用 map 后备桩模拟缓存持久化（cacheGet 必须能读到 cacheSet 写入的负缓存）
    const store = new Map<string, any>();
    h.cacheGet.mockImplementation(
      async (key: string) => store.get(key) ?? null,
    );
    h.cacheSet.mockImplementation(async (key: string, value: any) => {
      store.set(key, value);
    });
    mockHttpResponse((url) =>
      url.includes("/pmc/utils/idconv")
        ? {
            status: 200,
            text: JSON.stringify({ records: [{ errmsg: "Not found" }] }),
          }
        : null,
    );
    expect(await fetchStructuredXmlByDoi("10.1234/none")).toBeNull();
    expect(h.cacheSet).toHaveBeenCalledWith(
      "content:structured-xml:pmc:10.1234/none",
      { xml: null, source: null },
      expect.any(Number),
    );
    expect(h.httpGet).toHaveBeenCalledTimes(1);
    // 第二次：负缓存命中 → 零网络；且继续走 openalex（也无 key → 也不打网）
    expect(await fetchStructuredXmlByDoi("10.1234/none")).toBeNull();
    expect(h.httpGet).toHaveBeenCalledTimes(1);
  });

  it("positive cache short-circuits all network calls", async () => {
    h.cacheGet.mockImplementation(async (key: string) =>
      key === "content:structured-xml:pmc:10.1234/cached"
        ? { xml: PMC_XML, source: "pmc-jats" }
        : null,
    );
    const r = await fetchStructuredXmlByDoi("10.1234/cached");
    expect(r?.source).toBe("pmc-jats");
    expect(h.httpGet).not.toHaveBeenCalled();
  });

  it("OpenAlex is key-gated — no key, no content API call", async () => {
    mockHttpResponse(() => null); // PMC 全失败
    expect(await fetchStructuredXmlByDoi("10.1234/x")).toBeNull();
    const urls = h.httpGet.mock.calls.map((c: any[]) => c[1] as string);
    expect(urls.some((u: string) => u.includes("api.openalex.org"))).toBe(
      false,
    );
  });

  it("falls back to OpenAlex grobid when key present and PMC fails", async () => {
    h.prefs.set("extensions.zotero.zsearch.apis.openalex.apiKey", "sk-test");
    mockHttpResponse((url) => {
      if (url.includes("/pmc/utils/idconv")) return { status: 200, text: "{}" }; // 无 records
      if (url.includes("api.openalex.org/works/doi:")) {
        expect(url).toContain("api_key=sk-test");
        return {
          status: 200,
          text: JSON.stringify({ id: "https://openalex.org/W1" }),
        };
      }
      if (url.includes("W1.grobid-xml"))
        return { status: 200, text: GROBID_XML };
      return null;
    });
    const r = await fetchStructuredXmlByDoi("10.1234/grobid");
    expect(r).toEqual({ xml: GROBID_XML, source: "openalex-grobid" });
  });

  it("rejects non-XML payloads (validation gate)", async () => {
    mockHttpResponse((url) => {
      if (url.includes("/pmc/utils/idconv"))
        return {
          status: 200,
          text: JSON.stringify({ records: [{ pmcid: "PMC1" }] }),
        };
      if (url.includes("efetch.fcgi"))
        return { status: 200, text: "<html>error page</html>" };
      return null;
    });
    // PMC XML 校验不过 → 负缓存；OpenAlex 无 key → 整体 null
    expect(await fetchStructuredXmlByDoi("10.1234/html")).toBeNull();
  });

  it("fetchStructuredXmlForItem returns null without DOI", async () => {
    expect(await fetchStructuredXmlForItem(1)).toBeNull();
    expect(h.httpGet).not.toHaveBeenCalled();
  });

  // ── 文章级编排入口（PMCID 直取 / PMID 反查 / DOI 优先）─────────────

  it("PMCID 直取：跳过 idconv，efetch 一把拿到 JATS", async () => {
    mockHttpResponse((url) => {
      if (url.includes("efetch.fcgi") && url.includes("db=pmc")) {
        expect(url).toContain("id=PMC9232980");
        return { status: 200, text: PMC_XML };
      }
      return null;
    });
    const r = await fetchStructuredXmlForArticle({ pmcid: "pmc9232980" });
    expect(r).toEqual({ xml: PMC_XML, source: "pmc-jats" });
    const urls = h.httpGet.mock.calls.map((c: any[]) => c[1] as string);
    expect(urls.some((u: string) => u.includes("idconv"))).toBe(false);
    expect(h.cacheSet).toHaveBeenCalledWith(
      "content:structured-xml:pmc:pmcid:PMC9232980",
      { xml: PMC_XML, source: "pmc-jats" },
      expect.any(Number),
    );
  });

  it("PMID 反查：idconv 自动识别输入类型 → pmcid → efetch", async () => {
    mockHttpResponse((url) => {
      if (url.includes("/pmc/utils/idconv")) {
        expect(url).toContain("ids=35273355");
        return {
          status: 200,
          text: JSON.stringify({ records: [{ pmcid: "PMC9232980" }] }),
        };
      }
      if (url.includes("efetch.fcgi")) {
        expect(url).toContain("id=PMC9232980");
        return { status: 200, text: PMC_XML };
      }
      return null;
    });
    const r = await fetchStructuredXmlForArticle({ pmid: "35273355" });
    expect(r).toEqual({ xml: PMC_XML, source: "pmc-jats" });
    expect(h.cacheSet).toHaveBeenCalledWith(
      "content:structured-xml:pmc:pmid:35273355",
      { xml: PMC_XML, source: "pmc-jats" },
      expect.any(Number),
    );
  });

  it("orchestrator：DOI 链成功即短路，不再尝试 PMID/PMCID 入口", async () => {
    h.prefs.set("extensions.zotero.zsearch.apis.openalex.apiKey", "sk-test");
    mockHttpResponse((url) => {
      if (url.includes("/pmc/utils/idconv")) return { status: 200, text: "{}" }; // DOI 无 PMC
      if (url.includes("api.openalex.org/works/doi:"))
        return {
          status: 200,
          text: JSON.stringify({ id: "https://openalex.org/W1" }),
        };
      if (url.includes("W1.grobid-xml"))
        return { status: 200, text: GROBID_XML };
      return null; // PMCID 直取若被调用会命中这条
    });
    const r = await fetchStructuredXmlForArticle({
      doi: "10.1234/grobid",
      pmid: "35273355",
      pmcid: "PMC1",
    });
    expect(r).toEqual({ xml: GROBID_XML, source: "openalex-grobid" });
    const urls = h.httpGet.mock.calls.map((c: any[]) => c[1] as string);
    // idconv 只被 DOI 打了一次；PMCID 直取（efetch id=PMC1）未发生
    expect(urls.filter((u: string) => u.includes("idconv"))).toHaveLength(1);
    expect(urls.some((u: string) => u.includes("id=PMC1"))).toBe(false);
  });

  it("orchestrator：DOI 链失败后回退 PMID 反查", async () => {
    mockHttpResponse((url) => {
      if (url.includes("/pmc/utils/idconv")) {
        if (url.includes("ids=10.1234%2Fall")) {
          return {
            status: 200,
            text: JSON.stringify({ records: [{ errmsg: "Not found" }] }),
          };
        }
        if (url.includes("ids=35273355")) {
          return {
            status: 200,
            text: JSON.stringify({ records: [{ pmcid: "PMC9" }] }),
          };
        }
        return null;
      }
      if (url.includes("efetch.fcgi") && url.includes("id=PMC9")) {
        return { status: 200, text: PMC_XML };
      }
      return null;
    });
    const r = await fetchStructuredXmlForArticle({
      doi: "10.1234/All",
      pmid: "35273355",
    });
    expect(r).toEqual({ xml: PMC_XML, source: "pmc-jats" });
  });

  it("orchestrator：PMID 负缓存，第二次调用零网络", async () => {
    const store = new Map<string, any>();
    h.cacheGet.mockImplementation(
      async (key: string) => store.get(key) ?? null,
    );
    h.cacheSet.mockImplementation(async (key: string, value: any) => {
      store.set(key, value);
    });
    mockHttpResponse(() => null); // idconv 与 efetch 全失败
    expect(await fetchStructuredXmlForArticle({ pmid: "35273355" })).toBeNull();
    const callsAfterFirst = h.httpGet.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);
    expect(await fetchStructuredXmlForArticle({ pmid: "35273355" })).toBeNull();
    expect(h.httpGet.mock.calls).toHaveLength(callsAfterFirst);
  });

  it("orchestrator：标识全空/非法 → null，零网络", async () => {
    expect(await fetchStructuredXmlForArticle({})).toBeNull();
    expect(
      await fetchStructuredXmlForArticle({
        doi: "",
        pmid: "abc",
        pmcid: "12345",
      }),
    ).toBeNull();
    expect(h.httpGet).not.toHaveBeenCalled();
  });
});
