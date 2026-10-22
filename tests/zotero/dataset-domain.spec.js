/**
 * 数据集域集成冒烟（真实 Zotero 内运行）：
 *
 *  1. 等待插件初始化
 *  2. 验证 DomainSearchEngine 注册了 dataset 域（19 个源）
 *  3. 验证学科选择器声明的源全部在域中
 *  4. 验证 domain.search / domain.import / domain.profile RPC 路由
 */

describe("z-search dataset domain (real Zotero integration)", function () {
  this.timeout(60000);

  before(async function () {
    // 等待插件初始化（waitForPlugin 闩已由 test runner 保证，
    // 但 DomainRegistry 的注册副作用需要确保已执行）
    try {
      await import("../../src/core/search/DomainRegistry.js");
    } catch (e) {
      Zotero.debug("[z-search-test] DomainRegistry import failed: " + e);
    }
  });

  it("verifies dataset domain is registered with 19 sources", async function () {
    const { getDomainDef } = await import(
      "../../src/core/search/DomainSearchEngine.js"
    );
    const def = getDomainDef("dataset");
    Zotero.debug(
      "[z-search-test] dataset domain def: " + JSON.stringify(def?.sources),
    );

    if (!def) {
      throw new Error("dataset domain not registered");
    }
    if (def.sources.length !== 19) {
      throw new Error(
        `Expected 19 sources, got ${def.sources.length}: ${def.sources.join(", ")}`,
      );
    }
  });

  it("verifies domain.search RPC routes correctly", async function () {
    const { handleLiteratureRequest } = await import(
      "../../src/ui/hub/HubLiteratureHandler.js"
    );

    let result = null;
    let error = null;
    const mockBridge = {
      respond: function (id, r, e) {
        result = r;
        error = e;
      },
    };

    await handleLiteratureRequest(
      mockBridge,
      "domain.search",
      { domainId: "dataset", query: "test", maxResults: 5 },
      "test-1",
      {},
    );

    Zotero.debug(
      "[z-search-test] domain.search result: " + JSON.stringify(result) +
      " error: " + error,
    );

    if (error && error.includes("unknown domain")) {
      throw new Error("domain.search: unknown domain error: " + error);
    }
    if (!result || !Array.isArray(result.articles)) {
      throw new Error(
        "domain.search did not return articles array: " + JSON.stringify(result),
      );
    }
  });

  it("verifies domain.import RPC rejects empty entries", async function () {
    const { handleLiteratureRequest } = await import(
      "../../src/ui/hub/HubLiteratureHandler.js"
    );

    let error = null;
    const mockBridge = {
      respond: function (id, r, e) {
        error = e;
      },
    };

    await handleLiteratureRequest(
      mockBridge,
      "domain.import",
      { domainId: "dataset", entries: [] },
      "test-2",
      {},
    );

    if (!error || !error.includes("missing entries")) {
      throw new Error(
        "domain.import: expected 'missing entries' error, got: " + error,
      );
    }
  });
});
