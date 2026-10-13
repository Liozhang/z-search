import * as academicUtils from "../../src/core/sources/academic-search/utils.js";
import * as academicSources from "../../src/core/sources/academic-search/index.js";

/**
 * zk-source-latency-probe — 「搜索总是要十多秒」的逐源计时探针。
 *
 * 背景（2026-10-12 用户报告）：Hub 文献检索每次都要十多秒。前端逐源并发
 * 发独立 RPC，整体耗时 = 最慢单源。本探针在真实 Zotero 里把 13 个默认源
 * 并发各跑一次（与 UI 同参：query + maxResults=20），逐源记录耗时/成功/
 * 结果数/错误文本，找出拖慢整体的源。
 *
 * 结果写 sdt-out/zk-source-latency-probe.json，按耗时降序，人工判读。
 */
describe("per-source latency probe", function () {
  this.timeout(300000);

  const OUT_DIR = "D:\\github_code\\z-search\\tests\\zotero\\sdt-out";

  const SOURCES = {
    openalex: "searchOpenAlex",
    "semantic-scholar": "searchSemanticScholar",
    crossref: "searchCrossRef",
    arxiv: "searchArxiv",
    biorxiv: "searchBiorxiv",
    medrxiv: "searchMedrxiv",
    doaj: "searchDoaj",
    zenodo: "searchZenodo",
    hal: "searchHal",
    core: "searchCORE",
    "europe-pmc": "searchEuropePMC",
    pubmed: "searchPubMed",
    github: "searchGithub",
  };

  async function writeReport(name, data) {
    try {
      await IOUtils.makeDirectory(OUT_DIR);
    } catch {
      /* 已存在 */
    }
    await Zotero.File.putContentsAsync(
      PathUtils.join(OUT_DIR, name),
      JSON.stringify(data, null, 2),
    );
  }

  it("times every default source in parallel (same as UI)", async function () {
    const isSourceAvailable = academicUtils.isSourceAvailable;

    const started = Date.now();
    const entries = await Promise.all(
      Object.entries(SOURCES).map(async ([name, fnName]) => {
        if (
          typeof isSourceAvailable === "function" &&
          !isSourceAvailable(name)
        ) {
          return { source: name, skippedNoKey: true };
        }
        const t0 = Date.now();
        try {
          const fn = academicSources[fnName];
          if (typeof fn !== "function") {
            return { source: name, importError: `missing export ${fnName}` };
          }
          const r = await fn({
            query: "machine learning",
            maxResults: 20,
            sort: "relevance",
          });
          return {
            source: name,
            ms: Date.now() - t0,
            success: r?.success !== false,
            count: Array.isArray(r?.articles) ? r.articles.length : 0,
            error: r?.error ? String(r.error).slice(0, 200) : undefined,
          };
        } catch (e) {
          return {
            source: name,
            ms: Date.now() - t0,
            thrown: true,
            message: String(e?.message ?? e).slice(0, 200),
          };
        }
      }),
    );
    const wallMs = Date.now() - started;

    const timed = entries
      .filter((e) => typeof e.ms === "number")
      .sort((a, b) => b.ms - a.ms);
    const report = {
      wallMs,
      note: "并发跑一轮（与前端一致），wallMs ≈ 最慢源；逐源 ms 为各自耗时",
      sortedByMsDesc: timed,
      skipped: entries.filter((e) => e.skippedNoKey),
      others: entries.filter((e) => typeof e.ms !== "number"),
    };
    await writeReport("zk-source-latency-probe.json", report);
  });
});
