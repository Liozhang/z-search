/**
 * Host-side smoke test — loads the built bootstrap bundle
 * (.scaffold/build/addon/content/scripts/zsearch.js) in a stubbed Zotero
 * environment and verifies the plugin boots:
 *   - Zotero.ZSearch instance is registered
 *   - hooks.onStartup() completes without throwing
 *   - data.initialized flips true
 *
 * The bundle is the exact artifact the plugin ships; running it under Node
 * with stubbed globals catches import-time and init-time crashes that pure
 * tsc/webpack cannot.
 *
 * Requires a prior `npx zotero-plugin build --dev` (or npm run build).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const BUNDLE = resolve(
  __dirname,
  "../../.scaffold/build/addon/content/scripts/zsearch.js",
);

const hasBundle = existsSync(BUNDLE);

function installStubs() {
  const prefs = new Map<string, any>();
  const db = {
    queryAsync: async () => [],
    executeTransaction: async (fn: any) => fn(),
  };
  const stubZotero = {
    Prefs: {
      get: (key: string, _global?: boolean) => prefs.get(key),
      set: (key: string, value: any) => prefs.set(key, value),
      clear: (key: string) => prefs.delete(key),
    },
    debug: () => {},
    getMainWindows: () => [],
    getActiveZoteroPane: () => undefined,
    getMainWindow: () => undefined,
    Items: { get: () => false, getAll: () => [] },
    Collections: { get: () => false },
    Libraries: { userLibraryID: 1, getName: () => "My Library" },
    DB: db,
    HTTP: {
      request: async () => ({ responseText: "{}", status: 200 }),
      promise: async () => ({ responseText: "{}", status: 200 }),
    },
    File: { getContentsAsync: async () => "{}" },
    locale: "en-US",
    initializationPromise: Promise.resolve(),
    unlockPromise: Promise.resolve(),
    uiReadyPromise: Promise.resolve(),
    // Minimal Localization constructor: formatValueSync falls back to the key.
    getGlobal: (_key: string) =>
      class {
        constructor(_ids: string[], _generate: boolean) {}
        formatValueSync(id: string) {
          return id;
        }
        formatValue(id: string) {
          return Promise.resolve(id);
        }
      },
    UIProperties: { registerRoot: () => {} },
  };
  (globalThis as any).Zotero = stubZotero;
  (globalThis as any).__env__ = "development";
  return { stubZotero, prefs };
}

describe("host bundle smoke", () => {
  beforeAll(() => {
    installStubs();
  });

  it("boots the plugin bundle and initializes search services", async () => {
    if (!hasBundle) {
      console.warn("bundle missing — run `npm run build` first; skipping");
      return;
    }
    // Load the exact shipped artifact.
    await import(BUNDLE);

    const addon = (globalThis as any).Zotero?.ZSearch;
    expect(addon, "Zotero.ZSearch should be registered").toBeTruthy();
    expect(addon.data.config.addonID).toBe("zsearch@z-search.dev");
    expect(typeof addon.hooks.onStartup).toBe("function");

    await addon.hooks.onStartup();
    expect(addon.data.initialized).toBe(true);

    // Search singletons exposed for cross-module access.
    expect((globalThis as any).addon?.search?.SemanticSearch).toBeTruthy();
    expect((globalThis as any).addon?.search?.SearchPipeline).toBeTruthy();
    expect((globalThis as any).addon?.search?.WebSearchProvider).toBeTruthy();
    expect(
      (globalThis as any).addon?.search?.JournalSearchService,
    ).toBeTruthy();
  }, 60000);

  it("runs the four search engines against stubbed HTTP", async () => {
    if (!hasBundle) return;
    // Route every outbound HTTP call to canned JSON so the engines exercise
    // their real request-building + response-parsing paths.
    const httpRequests: string[] = [];
    (globalThis as any).Zotero.HTTP.request = async (
      method: string,
      url: string,
      _opts: any,
    ) => {
      httpRequests.push(`${method} ${url}`);
      if (url.includes("api.github.com/search/repositories")) {
        // 仓库搜索 (GitHub repo search)
        return {
          status: 200,
          responseText: JSON.stringify({
            total_count: 1,
            items: [
              {
                full_name: "zotero/zotero",
                name: "zotero",
                owner: { login: "zotero" },
                created_at: "2008-01-01T00:00:00Z",
                description: "Zotero is a free, easy-to-use tool",
                html_url: "https://github.com/zotero/zotero",
                stargazers_count: 9000,
                language: "JavaScript",
              },
            ],
          }),
        };
      }
      if (url.includes("api.openalex.org")) {
        // 学术搜索 (OpenAlex academic search)
        return {
          status: 200,
          responseText: JSON.stringify({
            meta: { count: 1 },
            results: [
              {
                id: "https://openalex.org/W1",
                doi: "https://doi.org/10.1/abc",
                title: "A Paper",
                publication_year: 2023,
                cited_by_count: 5,
                open_access: { is_oa: true, oa_url: "https://x/y.pdf" },
                primary_location: { source: { display_name: "Nature" } },
                authorships: [
                  {
                    author: { display_name: "A. Author" },
                    raw_author_name: "A. Author",
                  },
                ],
              },
            ],
          }),
        };
      }
      if (url.includes("html.duckduckgo.com") || url.includes("duckduckgo")) {
        // 网络搜索 (DuckDuckGo web search)
        return {
          status: 200,
          responseText:
            '<div class="result__a" href="https://example.com">Example</div>',
        };
      }
      return { status: 200, responseText: "{}" };
    };
    (globalThis as any).Zotero.HTTP.promise = (
      globalThis as any
    ).Zotero.HTTP.request;

    // ── 仓库搜索 ──
    const { searchGithub } =
      await import("../../src/core/sources/academic-search/github");
    const gh = await searchGithub("zotero", undefined, 5);
    expect(gh.articles?.length).toBeGreaterThan(0);
    expect(gh.articles[0].title).toBe("zotero/zotero");
    expect(gh.articles[0].source).toBe("github");

    // ── 学术搜索（OpenAlex 源） ──
    const academicSearch = (
      await import("../../src/core/tool/builtin/handlers/academic-search/index")
    ).default;
    const lit = await academicSearch.callSearchAPI(
      "openalex",
      "zotero",
      undefined,
      5,
    );
    expect(lit.articles?.length).toBeGreaterThan(0);
    expect(lit.articles[0].title).toBe("A Paper");

    // ── 网络搜索 ──
    const webSearchProvider = (
      await import("../../src/core/search/WebSearchProvider")
    ).default;
    const web = await webSearchProvider.search({
      query: "zotero plugin",
      provider: "duckduckgo",
      maxResults: 3,
    });
    // Either results or a clean error envelope — the engine must not throw.
    expect(web).toHaveProperty("results");
    expect(httpRequests.some((r) => r.includes("api.github.com"))).toBe(true);
    expect(httpRequests.some((r) => r.includes("api.openalex.org"))).toBe(true);

    // ── 向量搜索（库内索引引擎可加载；全文 hybrid 通道在无向量索引时
    //    降级为 BM25；空库时抛出可操作的 PDF_CHUNKS_NOT_INDEXED） ──
    const SemanticSearchMod =
      await import("../../src/core/search/SemanticSearch");
    const SemanticSearch = SemanticSearchMod.default;
    let semantic: unknown;
    try {
      semantic = await SemanticSearch.searchFullText("zotero", {
        threshold: 0.5,
        limit: 5,
        retrieval: "hybrid",
      });
      expect(Array.isArray(semantic)).toBe(true);
    } catch (e) {
      // 空库（桩 DB 无 chunks）→ 设计行为：可操作的「先建索引」错误
      expect(String((e as Error).message)).toContain("PDF_CHUNKS_NOT_INDEXED");
    }
  }, 60000);
});
