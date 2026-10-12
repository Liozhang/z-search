/**
 * zk-source-network-probe — 「zenodo / arxiv 搜索源网络连接失败」的实机探针。
 *
 * 背景（2026-10-12 用户报告）：Hub 检索中 zenodo 与 arxiv 两个源显示
 * 「网络连接失败」（hub-search-src-err-network）。本机 curl 两端点均
 * HTTP 200（zenodo 单条 7.9s 偏慢），说明不是域名被断连。本 spec 在
 * 真实 Zotero 的网络栈里逐层取证：
 *
 *   0. 对照层：Crossref 裸请求（同栈，应成功）
 *   1. arXiv 端点裸请求（Zotero.HTTP，与源实现同参）
 *   2. Zenodo 端点裸请求
 *   3. searchArxiv() 源实现
 *   4. searchZenodo() 源实现
 *
 * 失败不抛断言——本探针的目的是取证，全部结果写 JSON 报告后由人工判读。
 */
describe("zenodo/arxiv source network probe", function () {
  this.timeout(240000);

  const OUT_DIR = "D:\\github_code\\z-search\\tests\\zotero\\sdt-out";

  async function ensureOutDir() {
    try {
      await IOUtils.makeDirectory(OUT_DIR);
    } catch {
      /* 已存在 */
    }
  }

  async function writeReport(name, data) {
    await ensureOutDir();
    await Zotero.File.putContentsAsync(
      PathUtils.join(OUT_DIR, name),
      JSON.stringify(data, null, 2),
    );
  }

  /** 裸请求一层：返回状态/耗时/首段正文或错误要素。 */
  async function rawGet(label, url, headers) {
    const started = Date.now();
    try {
      const resp = await Zotero.HTTP.request("GET", url, {
        headers,
        responseType: "text",
        timeout: 30000,
        errorDelayMax: 0,
      });
      return {
        layer: label,
        ok: true,
        status: resp.status,
        ms: Date.now() - started,
        bodyHead: String(resp.responseText || "").slice(0, 160),
      };
    } catch (e) {
      return {
        layer: label,
        ok: false,
        ms: Date.now() - started,
        name: e?.name,
        status: e?.status,
        message: String(e?.message ?? e).slice(0, 300),
      };
    }
  }

  /** 源实现一层：调用 handler，记录 success/articles/error。 */
  async function sourceLayer(label, modPath, fnName, args) {
    const started = Date.now();
    try {
      const mod = await import(modPath);
      const r = await mod[fnName](args);
      return {
        layer: label,
        ok: r?.success !== false,
        ms: Date.now() - started,
        success: r?.success,
        error: r?.error ? String(r.error).slice(0, 300) : undefined,
        articleCount: Array.isArray(r?.articles)
          ? r.articles.length
          : undefined,
      };
    } catch (e) {
      return {
        layer: label,
        ok: false,
        ms: Date.now() - started,
        thrown: true,
        name: e?.name,
        message: String(e?.message ?? e).slice(0, 300),
      };
    }
  }

  it("probes arxiv and zenodo reachability inside Zotero", async function () {
    const report = { layers: [] };

    // ── 层 0：对照源（Crossref，同栈裸请求） ─────────────────────
    report.layers.push(
      await rawGet(
        "crossref-raw",
        "https://api.crossref.org/works?rows=1&query=test",
        {
          Accept: "application/json",
        },
      ),
    );

    // ── 层 1/2：两个故障源的端点裸请求（与源实现同参） ───────────
    report.layers.push(
      await rawGet(
        "arxiv-raw",
        "https://export.arxiv.org/api/query?search_query=all:test&start=0&max_results=3",
        { Accept: "application/atom+xml" },
      ),
    );
    report.layers.push(
      await rawGet(
        "zenodo-raw",
        "https://zenodo.org/api/records?q=test&size=3&type=publication",
        { Accept: "application/json" },
      ),
    );

    // ── 层 3/4：源实现（含解析与错误归一化） ─────────────────────
    report.layers.push(
      await sourceLayer(
        "arxiv-handler",
        "../../src/core/sources/academic-search/arxiv.js",
        "searchArxiv",
        { query: "test", maxResults: 3 },
      ),
    );
    report.layers.push(
      await sourceLayer(
        "zenodo-handler",
        "../../src/core/sources/academic-search/zenodo.js",
        "searchZenodo",
        { query: "test", maxResults: 3 },
      ),
    );

    await writeReport("zk-source-network-probe.json", report);
  });
});
