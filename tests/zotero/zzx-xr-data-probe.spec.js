/**
 * zzx-xr-data-probe — JCR 2025 + 新锐分区 2026 数据集实机取证（2026-10-15）。
 *
 * 背景：两份新数据集（jcr-2025.json / xr-2026.json）经本地 SQLite 演练
 * （node:sqlite 全量导入 + 查询口径核对）后接入，缺一环真机验证：启动
 * 导入（journalDataImport 的 xr 阶段与 JCR 多年份门控）、XRStore 查询、
 * 服务层与文献富集层的新锐字段下发。
 *
 * 断言分两级：
 *   - 硬断言（throw）：存储层事实（表行数、store 查询命中）——不依赖
 *     区域门控与 UI；
 *   - 软记录（落盘）：服务层/富集层的字段下发（cassEnabled 影响可见性，
 *     当前出厂默认可见，但断言不押注在 pref 上）。
 *
 * 报告：tests/zotero/sdt-out/xr-data-probe.json，逐步落盘（同 zzk 探针
 * v2 的留痕范式）。
 */
describe("xr data import probe", function () {
  this.timeout(300000);

  const OUT_DIR = "D:\\github_code\\z-search\\tests\\zotero\\sdt-out";
  const REPORT = "xr-data-probe.json";

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

  /**
   * 启动导入与探针并发——按 1s 间隔轮询。导入是分块写入的，行数单调增长，
   * 不能见 >0 就断言（首跑曾在 20647 行的中间态上误报）：等到达到官方口径
   * 总数，或连续 10 次采样不再变化（真实数据缺陷会稳定在错误值上，同样能
   * 够暴露），再交给断言。
   */
  async function waitForNewDatasets(maxMs) {
    const t0 = Date.now();
    let lastXr = -1;
    let stablePolls = 0;
    for (;;) {
      const last = {
        jcr25: Number(
          await Zotero.DB.valueQueryAsync(
            `SELECT COUNT(*) FROM zsearch_impact_factors WHERE jcr_year = 2025`,
          ),
        ),
        xr: Number(
          await Zotero.DB.valueQueryAsync(
            `SELECT COUNT(*) FROM zsearch_xr_quartiles`,
          ),
        ),
      };
      if (last.jcr25 === 22643 && last.xr === 22299) {
        return { waitedMs: Date.now() - t0, ...last, settled: true };
      }
      stablePolls = last.xr === lastXr ? stablePolls + 1 : 0;
      lastXr = last.xr;
      if (stablePolls >= 10) {
        return { waitedMs: Date.now() - t0, ...last, settled: true };
      }
      if (Date.now() - t0 > maxMs) {
        return { waitedMs: Date.now() - t0, ...last, timedOut: true };
      }
      await Zotero.Promise.delay(1000);
    }
  }

  it("imports both new datasets and serves XR lookups end to end", async function () {
    const t0 = Date.now();
    const report = { startedAt: new Date().toISOString(), steps: [] };
    let stepIndex = 0;
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

      // 0. 自愈（2026-10-15）：年份门控按「期望年份存在即跳过」判定，上一轮
      // 运行留下的残缺表（曾因空字符串 ISSN 撞唯一索引丢行）不会被补导。先
      // 清两份新数据集，再显式触发一轮导入，验证完整重导路径。
      const beforeXr = Number(
        await Zotero.DB.valueQueryAsync(
          `SELECT COUNT(*) FROM zsearch_xr_quartiles`,
        ),
      );
      const beforeJcr25 = Number(
        await Zotero.DB.valueQueryAsync(
          `SELECT COUNT(*) FROM zsearch_impact_factors WHERE jcr_year = 2025`,
        ),
      );
      if (beforeXr !== 22299 || beforeJcr25 !== 22643) {
        await Zotero.DB.queryAsync(`DELETE FROM zsearch_xr_quartiles`);
        await Zotero.DB.queryAsync(
          `DELETE FROM zsearch_impact_factors WHERE jcr_year = 2025`,
        );
        const { runJournalDataImport } =
          await import("../../src/core/data/journalDataImport.js");
        const result = await runJournalDataImport();
        await step("reset-and-reimport", {
          beforeXr,
          beforeJcr25,
          stages: result.stages,
        });
      }

      // 1. 等启动导入落库（升级路径：老库已有 2024/CASS，本轮补 2025+XR）
      const wait = await waitForNewDatasets(240000);
      await step("startup-import-wait", wait);
      if (wait.timedOut) {
        throw new Error(
          `startup import did not land within wait window: jcr2025=${wait.jcr25} xr=${wait.xr}`,
        );
      }

      // 2. 存储层行数（硬断言）
      const counts = {
        jcr2024: Number(
          await Zotero.DB.valueQueryAsync(
            `SELECT COUNT(*) FROM zsearch_impact_factors WHERE jcr_year = 2024`,
          ),
        ),
        jcr2025: Number(
          await Zotero.DB.valueQueryAsync(
            `SELECT COUNT(*) FROM zsearch_impact_factors WHERE jcr_year = 2025`,
          ),
        ),
        xrTotal: Number(
          await Zotero.DB.valueQueryAsync(
            `SELECT COUNT(*) FROM zsearch_xr_quartiles`,
          ),
        ),
        xrUnderReview: Number(
          await Zotero.DB.valueQueryAsync(
            `SELECT COUNT(*) FROM zsearch_xr_quartiles WHERE is_under_review = 1`,
          ),
        ),
        cass: Number(
          await Zotero.DB.valueQueryAsync(
            `SELECT COUNT(*) FROM zsearch_cass_quartiles`,
          ),
        ),
        warnings: Number(
          await Zotero.DB.valueQueryAsync(
            `SELECT COUNT(*) FROM zsearch_journal_warnings`,
          ),
        ),
      };
      await step("table-counts", counts);
      // 官方口径：JCR 2025 快照 22,643 本（下载源 ShowJCR 与 Clarivate 公告
      // 双核对）；新锐 2026 官方 22,299 本 + Under Review 37 本。
      if (counts.jcr2025 !== 22643) {
        throw new Error(`jcr 2025 rows = ${counts.jcr2025}, expect 22643`);
      }
      if (counts.xrTotal !== 22299 || counts.xrUnderReview !== 37) {
        throw new Error(
          `xr rows = ${counts.xrTotal} (expect 22299), underReview = ${counts.xrUnderReview} (expect 37)`,
        );
      }

      // 3. Store 层查询（硬断言——不依赖区域门控）
      const { default: JCRStore } =
        await import("../../src/core/data/JCRStore.js");
      const { default: XRStore } =
        await import("../../src/core/data/XRStore.js");
      const latestYear = await JCRStore.getLatestYear();
      await step("jcr-latest-year", { latestYear });
      if (latestYear !== 2025) {
        throw new Error(`JCR latest year = ${latestYear}, expect 2025`);
      }
      const natureJcr = await JCRStore.lookup({ journalName: "Nature" });
      if (
        !natureJcr ||
        natureJcr.jif !== 56.1 ||
        natureJcr.jif_quartile !== "Q1"
      ) {
        throw new Error(
          `JCR lookup Nature = ${JSON.stringify(natureJcr && { jif: natureJcr.jif, q: natureJcr.jif_quartile })}, expect jif 56.1 Q1 (2025 年度)`,
        );
      }
      const natureXr = await XRStore.lookup({ journalName: "Nature" });
      if (
        !natureXr ||
        natureXr.major_quartile !== 1 ||
        natureXr.is_top !== true ||
        !(natureXr.minor_categories || []).length
      ) {
        throw new Error(
          `XR lookup Nature = ${JSON.stringify(natureXr && { q: natureXr.major_quartile, top: natureXr.is_top })}, expect 1 区 + Top + 小类`,
        );
      }
      const byIssn = await XRStore.batchLookupByIssn(["0028-0836"]);
      const xrByIssn = byIssn.get("00280836");
      if (!xrByIssn || xrByIssn.journal_name !== "NATURE") {
        throw new Error(
          `XR batch by ISSN 0028-0836 → ${JSON.stringify(xrByIssn && xrByIssn.journal_name)}, expect NATURE`,
        );
      }
      await step("store-lookups-ok", {
        natureJif: natureJcr.jif,
        natureXrQuartile: natureXr.major_quartile,
        natureXrTop: natureXr.is_top,
        xrMinorCount: (natureXr.minor_categories || []).length,
      });

      // 4. 服务层（metric 模式）——新锐字段下发（软记录）
      const { default: service } =
        await import("../../src/core/search/JournalSearchService.js");
      const metricRes = await service.search({
        mode: "metric",
        query: "Nature",
      });
      const metric = metricRes && metricRes.metric;
      const xrFields = metric
        ? {
            jif: metric.jif,
            jcrQuartile: metric.jifQuartile,
            cassQuartile: metric.cassQuartile,
            cassIsTop: metric.cassIsTop,
            xrQuartile: metric.xrQuartile,
            xrIsTop: metric.xrIsTop,
            xrUnderReview: metric.xrUnderReview ?? null,
            xrMinorCount: (metric.xrMinorCategories || []).length,
          }
        : null;
      await step("service-metric-nature", {
        error: metricRes.error || null,
        xrFields,
      });
      if (!metric || metric.xrQuartile !== 1 || metric.jif !== 56.1) {
        throw new Error(
          `service metric Nature → ${JSON.stringify(xrFields)}, expect xrQuartile 1 + jif 56.1`,
        );
      }

      // 5. 文献富集层（软记录 + 与门控无关的硬断言：cass 出厂可见）
      const { enrichJournalMetrics } =
        await import("../../src/core/search/literatureSearchHelpers.js");
      const article = { issn: "0028-0836", journalName: "Nature" };
      await enrichJournalMetrics([article]);
      const enriched = {
        jif: article.jif,
        jcrQuartile: article.jcrQuartile,
        cassQuartile: article.cassQuartile,
        xrQuartile: article.xrQuartile,
        xrUnderReview: article.xrUnderReview ?? null,
      };
      await step("enrich-article", enriched);
      if (article.xrQuartile !== 1 || article.jif !== 56.1) {
        throw new Error(
          `enriched article → ${JSON.stringify(enriched)}, expect xrQuartile 1 + jif 56.1`,
        );
      }

      // 6. discover 模式不因新表接入而劣化（软记录）
      const disc = await service.search({
        mode: "discover",
        query: "oncology",
        limit: 10,
      });
      await step("discover-oncology", {
        error: disc.error || null,
        listCount: (disc.list || []).length,
        withXr: (disc.list || []).filter((i) => i.xrQuartile != null).length,
      });

      await step("all-done");
    } catch (e) {
      report.fatal = String((e && e.message) || e);
      report.fatalStack = String((e && e.stack) || "").slice(0, 1200);
      await writeReport(report);
      throw { message: "[xr-data-probe] fatal: " + report.fatal };
    }
  });
});
