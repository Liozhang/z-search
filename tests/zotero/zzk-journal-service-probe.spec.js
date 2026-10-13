/**
 * zzk-journal-service-probe — journal.search 服务端取证（2026-10-13）。
 *
 * 背景：第四轮起实机套件中期刊域 UI 用例（掠夺性标志/发现列表/模糊探针）
 * 稳定失败，而测试库四表数据完好（SQL 直查 18871/21772/157/1425 行）。
 * UI 断言只能给出「标志缺失/列表空」，本探针绕过 UI 直接调
 * JournalSearchService，把失败定位到服务层还是 UI 层。
 *
 * v2（2026-10-14）：逐步留痕——每完成一步立即落盘一次报告，失败点即使
 * 中断后续步骤，已完成步骤与当前步骤名也会留在磁盘上（v1 失败时报告
 * 完全缺失，无法区分「挂在哪步」）。
 */
describe("journal service direct probe", function () {
  this.timeout(180000);

  const OUT_DIR = "D:\\github_code\\z-search\\tests\\zotero\\sdt-out";
  const REPORT = "journal-service-probe.json";

  async function writeReport(data) {
    try {
      await IOUtils.makeDirectory(OUT_DIR);
    } catch {
      /* 已存在 */
    }
    await Zotero.File.putContentsAsync(
      PathUtils.join(OUT_DIR, REPORT),
      JSON.stringify(data, null, 2),
    );
  }

  it("calls metric + discover directly and records timing/shape", async function () {
    const t0 = Date.now();
    const report = {
      startedAt: new Date().toISOString(),
      steps: [],
    };
    let stepIndex = 0;
    // 每步完成立即落盘；落盘自身失败不遮蔽主流程
    async function step(name, data) {
      stepIndex += 1;
      report.steps.push({
        step: stepIndex,
        name,
        elapsedMs: Date.now() - t0,
        ...(data || {}),
      });
      try {
        await writeReport(report);
      } catch (e) {
        report.steps[report.steps.length - 1].reportWriteError = String(
          (e && e.message) || e,
        );
      }
    }

    try {
      await step("begin");

      const mod = await import("../../src/core/search/JournalSearchService.js");
      const service = mod.default;
      await step("import-ok", {
        hasSearch: typeof (service && service.search),
      });

      let res = await service.search({
        mode: "metric",
        query: "Academic Exchange Quarterly",
      });
      await step("metric-bealls-done", {
        elapsedMs: Date.now() - t0,
        mode: res && res.mode,
        error: (res && res.error) || null,
        hasMetric: !!(res && res.metric),
        metricKeys: res && res.metric ? Object.keys(res.metric) : [],
        beallsFlag: (res && res.metric && res.metric.bealls) || null,
      });

      res = await service.search({ mode: "metric", query: "Nature" });
      await step("metric-jcr-done", {
        elapsedMs: Date.now() - t0,
        error: (res && res.error) || null,
        hasMetric: !!(res && res.metric),
        jif: (res && res.metric && res.metric.jif) || null,
      });

      res = await service.search({
        mode: "discover",
        query: "oncology",
        limit: 25,
      });
      await step("discover-oncology-done", {
        elapsedMs: Date.now() - t0,
        error: (res && res.error) || null,
        listCount: (res && res.list ? res.list : []).length,
        total: (res && res.total) || null,
      });

      await step("all-done");
    } catch (e) {
      report.fatal = String((e && e.message) || e);
      report.fatalStack = String((e && e.stack) || "").slice(0, 1200);
      await writeReport(report);
      throw { message: "[journal-service-probe] fatal: " + report.fatal };
    }
  });
});
