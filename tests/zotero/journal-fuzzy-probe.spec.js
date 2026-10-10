/**
 * journal-fuzzy-probe — 「模糊搜索不完整单词返回空」的分层实机探针。
 *
 * 背景（2026-10-10 用户报告）：模糊搜索输入 "nature bio"（不完整单词）结果为空。
 * 静态分析结论：OpenAlex /sources?search=nature bio 实测 count=0（不完整单词
 * 不参与其整词匹配）；本地 JCR 表 LIKE '%NATURE BIO%' 应命中（测试库实证 2 行）。
 * 但 2026-10-09 21:52 的实机报告（hub-visual-journal-discover.json）显示本地有
 * 95 行 ONCOLOGY 命中的情况下 discover "oncology" 仍 0 行——本地层在真实
 * Zotero 里疑似同样落空。本 spec 逐层取证：
 *
 *   1. JCRStore.getLatestYear()      —— 数据在不在、年份缓存是否为 null
 *   2. JCRStore.searchByNameFuzzy()  —— 本地 LIKE 层（4 组关键词）
 *   3. journal.search RPC discover   —— 完整服务层（本地+OpenAlex 合并后）
 *
 * 失败一律抛纯对象（runner 的 JSON 往返只保留自有可枚举属性）。
 */
describe("journal fuzzy empty-result probe", function () {
  this.timeout(180000);

  const OUT_DIR = "D:\\github_code\\z-search\\tests\\zotero\\sdt-out";

  function reportError(name, e) {
    const reason = e?.message != null ? String(e.message) : String(e);
    throw {
      message:
        `[journal-fuzzy-probe][${name}] ${reason}\n${e?.stack || ""}`.slice(
          0,
          1500,
        ),
    };
  }

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

  it("probes every layer of the fuzzy journal search", async function () {
    const report = { layers: {} };

    // ── 层 1+2：本地数据与 LIKE 查询 ──────────────────────────────
    try {
      const { default: JCRStore } =
        await import("../../src/core/data/JCRStore.js");
      await JCRStore.initialize();
      const latestYear = await JCRStore.getLatestYear();
      report.layers.latestYear = latestYear;

      const keywords = ["nature bio", "nat bio", "oncology", "nature"];
      const fuzzy = {};
      for (const kw of keywords) {
        try {
          const rows = await JCRStore.searchByNameFuzzy(kw, 25);
          fuzzy[kw] = {
            count: rows.length,
            names: rows.slice(0, 5).map((r) => r.journal_name),
          };
        } catch (e) {
          fuzzy[kw] = { exception: String((e && e.message) || e) };
        }
      }
      report.layers.searchByNameFuzzy = fuzzy;
    } catch (e) {
      report.layers.localError = String((e && e.message) || e);
    }

    // ── 层 3：完整服务（RPC） ────────────────────────────────────
    async function rpcDiscover(query) {
      const state = { res: undefined, err: null };
      try {
        const { HubWindowBridge } =
          await import("../../src/ui/hub/HubWindowBridge.js");
        const bridge = new HubWindowBridge();
        bridge.handleIframeMessage(
          {
            type: "zsearch-req",
            id: `fuzzy-probe-${Math.random().toString(36).slice(2)}`,
            method: "journal.search",
            payload: {
              mode: "discover",
              query,
              limit: 25,
              sortBy: "relevance",
            },
          },
          {
            closed: false,
            postMessage: (msg) => {
              if (msg?.type === "zsearch-res" && msg.payload) {
                if (msg.payload.success) state.res = msg.payload.data;
                else state.err = msg.payload.error;
              }
            },
          },
        );
        const deadline = Date.now() + 90000;
        while (Date.now() < deadline && state.res === undefined && !state.err) {
          await Zotero.Promise.delay(400);
        }
      } catch (e) {
        state.err = String((e && e.message) || e);
      }
      return {
        error: state.err,
        serviceError: state.res?.error ?? null,
        listCount: (state.res?.list || []).length,
        listSample: (state.res?.list || []).slice(0, 6).map((x) => ({
          name: x.name,
          source: x.source,
          jif: x.jif ?? null,
        })),
      };
    }

    report.layers.rpcDiscoverNatureBio = await rpcDiscover("nature bio");
    report.layers.rpcDiscoverOncology = await rpcDiscover("oncology");
    report.layers.rpcDiscoverNature = await rpcDiscover("nature");

    await writeReport("journal-fuzzy-probe.json", report);

    // 探针只取证不断言失败——真正判读交给报告。
    if (!report.layers.latestYear) {
      reportError("probe", {
        message: `latestYear is ${report.layers.latestYear} — JCR 数据层缺席`,
      });
    }
  });
});
