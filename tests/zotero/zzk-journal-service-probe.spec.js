/**
 * zzk-journal-service-probe — journal.search 服务端取证（2026-10-13）。
 *
 * 背景：第四轮起实机套件中期刊域 UI 用例（掠夺性标志/发现列表/模糊探针）
 * 稳定失败，而测试库四表数据完好（SQL 直查 18871/21772/157/1425 行）、
 * OpenAlex 当日配额耗尽（429，Retry-After 52 564s）。UI 断言只能给出
 * 「标志缺失/列表空」，本探针绕过 UI 直接调 JournalSearchService，
 * 记录每次调用的耗时/返回形状/错误文本，把失败定位到服务层还是 UI 层。
 *
 * 全部调用只读（lookup/discover 均为查询；OpenAlex 结果照常进缓存，
 * 与 UI 路径一致）。报告落 sdt-out/journal-service-probe.json。
 */
describe("journal service direct probe", function () {
  this.timeout(180000);

  const OUT_DIR = "D:\\github_code\\z-search\\tests\\zotero\\sdt-out";

  async function writeReport(data) {
    try {
      await IOUtils.makeDirectory(OUT_DIR);
    } catch {
      /* 已存在 */
    }
    await Zotero.File.putContentsAsync(
      PathUtils.join(OUT_DIR, "journal-service-probe.json"),
      JSON.stringify(data, null, 2),
    );
  }

  it("calls metric + discover directly and records timing/shape", async function () {
    const report = { startedAt: new Date().toISOString(), calls: {} };
    let service;
    try {
      const mod = await import(
        "../../src/core/search/JournalSearchService.js"
      );
      service = mod.default;
    } catch (e) {
      report.importError = String((e && e.message) || e);
      await writeReport(report);
      throw { message: "service import failed: " + report.importError };
    }

    const calls = [
      {
        name: "metricBealls",
        payload: { mode: "metric", query: "Academic Exchange Quarterly" },
      },
      {
        name: "metricJcr",
        payload: { mode: "metric", query: "Nature" },
      },
      {
        name: "discoverOncology",
        payload: { mode: "discover", query: "oncology", limit: 25 },
      },
    ];

    for (const c of calls) {
      const t0 = Date.now();
      try {
        const res = await service.search(c.payload);
        const elapsed = Date.now() - t0;
        report.calls[c.name] = {
          elapsedMs: elapsed,
          mode: res?.mode,
          error: res?.error ?? null,
          hasMetric: !!res?.metric,
          metricKeys: res?.metric ? Object.keys(res.metric) : [],
          beallsFlag: res?.metric?.bealls ?? res?.metric?.predatory ?? null,
          listCount: (res?.list || []).length,
          listSample: (res?.list || []).slice(0, 3).map((x) => ({
            name: x.name,
            jif: x.jif ?? null,
            quartile: x.quartile ?? null,
          })),
        };
      } catch (e) {
        report.calls[c.name] = {
          elapsedMs: Date.now() - t0,
          threw: String((e && e.message) || e),
        };
      }
    }

    await writeReport(report);

    // 取证探针不判读失败——报告即交付。仅当服务层整体抛错时让用例红，
    // 保证轮次结果能反映服务可用性。
    if (report.importError) {
      throw { message: "service import failed" };
    }
  });
});
