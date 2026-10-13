/**
 * zk-journal-import-contention — 「内置期刊数据集未能加载」修复的实机验证。
 *
 * 背景（2026-10-13 排查 + 修复前探针实证）：启动导入与宿主启动期长事务争
 * 主库写锁时，Zotero.DB.executeTransaction 默认只等 30 秒即抛 TimeoutError，
 * 导入失败 → journalData.importFailed 置旗 → 期刊页横幅。
 *
 * 修复（本次验证对象）：
 *   a. crud.importRows 的等待上限放宽到 120 秒——短争用（<120s）不再失败；
 *   b. 导入逻辑抽到 core/data/journalDataImport，journal.reimportData RPC
 *      与期刊页横幅「立即导入」按钮共用（不依赖重启的恢复入口）。
 *
 * 四层取证：
 *   1. 安静基线 + 共享模块全跳过运行：启动后旗为 false、数据就位；
 *      runJournalDataImport() 幂等重跑应 ok=true 且四 stage 全 skipped。
 *   2. 强制补漏：清空预警名单表后重跑——warning stage 应 imported 且行数
 *      与随包 JSON 一致（验证抽模块没破坏真实导入路径）。
 *   3. 争用存活：持锁 40 秒期间经 importRows 写探针行——修复前此场景
 *      30s TimeoutError 必失败；修复后应等待并在锁释放后 ~40s 成功。
 *   4. 诚实失败：持锁 130 秒（>120s 上限）——应在 ~120s 抛 TimeoutError，
 *      释放后重试成功（超上限仍如实失败，不无限挂起）。
 *
 * 探针表 zsearch_import_probe 建在测试实例主库上，用后即删，不触碰真实
 * 数据表。失败一律抛纯对象（runner 的 JSON 往返只保留自有可枚举属性）。
 */
describe("journal dataset import fix verification", function () {
  // 用例内最长等待 ~130s（用例 4），留足余量
  this.timeout(300000);

  const OUT_DIR = "D:\\github_code\\z-search\\tests\\zotero\\sdt-out";
  const PROBE_TABLE = "zsearch_import_probe";
  const report = {
    baseline: {},
    forcedRepair: {},
    survive40s: {},
    failPastCeiling: {},
  };

  function reportError(name, e) {
    const reason = e?.message != null ? String(e.message) : String(e);
    throw {
      message:
        `[journal-import-contention][${name}] ${reason}\n${e?.stack || ""}`.slice(
          0,
          1500,
        ),
    };
  }

  async function writeReport() {
    try {
      await IOUtils.makeDirectory(OUT_DIR);
    } catch {
      /* 已存在 */
    }
    await Zotero.File.putContentsAsync(
      PathUtils.join(OUT_DIR, "journal-import-contention.json"),
      JSON.stringify(report, null, 2),
    );
  }

  after(async function () {
    // 探针表清理兜底（各用例自清理失败时）
    try {
      await Zotero.DB.queryAsync(`DROP TABLE IF EXISTS ${PROBE_TABLE}`);
    } catch {
      /* ignore */
    }
    await writeReport();
  });

  async function ensureProbeTable() {
    await Zotero.DB.queryAsync(
      `CREATE TABLE IF NOT EXISTS ${PROBE_TABLE} (id INTEGER PRIMARY KEY)`,
    );
  }

  /** 与期刊数据导入完全相同的写入原语（crud.importRows）。 */
  async function probeImport() {
    const crud = await import("../../src/core/data/utils/crud.js");
    return crud.importRows({
      tableName: PROBE_TABLE,
      columns: ["id"],
      rows: [{ id: 1 }],
      mode: "insert-or-ignore",
      conflictKeys: [["id"]],
    });
  }

  /**
   * loadDataFile 读 `${rootURI}data/${filename}`——rootURI 是插件 bootstrap
   * 沙箱的全局，真机插件里已定义（历史导入成功为证）；本测试窗口没有该
   * 全局。指向本仓库的构建输出目录（.scaffold/build/addon，与安装包同一
   * 布局、data/ 随包在内）——与开发模式（未打包目录、file: URI）语义一致。
   */
  async function ensurePluginRootURI() {
    const g = globalThis;
    if (typeof g.rootURI === "string" && g.rootURI) return;
    g.rootURI = "file:///D:/github_code/z-search/.scaffold/build/addon/";
  }

  /** 持锁 ms 毫秒后释放；返回 { holder, releaseLock }。 */
  function holdLock(ms) {
    let releaseLock;
    const holder = Zotero.DB.executeTransaction(async () => {
      await new Promise((resolve) => {
        releaseLock = resolve;
      });
    });
    const done = Zotero.Promise.delay(ms).then(() => releaseLock());
    return { holder, done };
  }

  it("quiet-startup baseline and idempotent module rerun", async function () {
    try {
      const importFailed = Zotero.Prefs.get(
        "extensions.zotero.zsearch.journalData.importFailed",
        true,
      );
      report.baseline.importFailedPref = importFailed === true;
      if (importFailed === true) {
        throw {
          message: "baseline: importFailed pref is true after quiet start",
        };
      }

      // 共享模块幂等重跑：数据已在（启动导入过），四 stage 应全 skipped，
      // ok=true，旗保持 false
      const { runJournalDataImport } =
        await import("../../src/core/data/journalDataImport.js");
      const result = await runJournalDataImport();
      report.baseline.rerunResult = result;
      if (!result.ok) {
        throw { message: "baseline: rerun ok=false", result };
      }
      const nonSkipped = result.stages.filter((s) => s.status !== "skipped");
      if (nonSkipped.length > 0) {
        throw { message: "baseline: expected all stages skipped", nonSkipped };
      }
      const prefAfter = Zotero.Prefs.get(
        "extensions.zotero.zsearch.journalData.importFailed",
        true,
      );
      if (prefAfter === true) {
        throw {
          message: "baseline: importFailed pref not reset after clean rerun",
        };
      }
    } catch (e) {
      reportError("baseline", e);
    }
  });

  it("forced repair: cleared warning table repopulates from bundled JSON", async function () {
    try {
      await ensurePluginRootURI();
      const { default: WarningListStore } =
        await import("../../src/core/data/WarningListStore.js");
      const crud = await import("../../src/core/data/utils/crud.js");
      const before = await WarningListStore.getCount();

      await crud.clearTable("zsearch_journal_warnings");
      const afterClear = await WarningListStore.getCount();
      if (afterClear !== 0) {
        throw { message: `forcedRepair: clear left ${afterClear} rows` };
      }

      const { runJournalDataImport } =
        await import("../../src/core/data/journalDataImport.js");
      const result = await runJournalDataImport();
      const warningStage = result.stages.find((s) => s.stage === "warning");
      report.forcedRepair = {
        before,
        afterClear,
        warningStage,
        resultOk: result.ok,
      };

      if (!warningStage || warningStage.status !== "imported") {
        throw {
          message: "forcedRepair: warning stage did not import",
          warningStage,
        };
      }
      const { loadDataFile } =
        await import("../../src/core/data/DataLoader.js");
      const warningJson = await loadDataFile("warning.json");
      const count = await WarningListStore.getCount();
      report.forcedRepair.countAfter = count;
      if (count !== warningJson.data.length) {
        throw {
          message: `forcedRepair: ${count} rows after reimport, expected ${warningJson.data.length}`,
        };
      }
    } catch (e) {
      reportError("forcedRepair", e);
    }
  });

  it("import survives a 40s lock hold (waits, then commits)", async function () {
    try {
      await ensureProbeTable();
      const { holder, done } = holdLock(40000);
      // 等持锁事务真正拿到 _transactionID 再发起争用方
      await Zotero.Promise.delay(1000);

      const t0 = Date.now();
      await probeImport();
      const elapsedMs = Date.now() - t0;
      await done;
      await holder;

      const rows = await Zotero.DB.valueQueryAsync(
        `SELECT COUNT(*) FROM ${PROBE_TABLE}`,
      );
      report.survive40s = { elapsedMs, rows: Number(rows) };

      if (elapsedMs < 35000) {
        throw {
          message: `survive40s: returned at ${elapsedMs}ms — did it wait for the lock?`,
        };
      }
      if (Number(rows) < 1) {
        throw { message: "survive40s: probe row missing after commit" };
      }
    } catch (e) {
      reportError("survive40s", e);
    } finally {
      await Zotero.DB.queryAsync(`DROP TABLE IF EXISTS ${PROBE_TABLE}`);
    }
  });

  it("import fails honestly past the 120s ceiling, then recovers", async function () {
    try {
      await ensureProbeTable();
      const { holder, done } = holdLock(130000);
      await Zotero.Promise.delay(1000);

      const t0 = Date.now();
      let error = null;
      try {
        await probeImport();
      } catch (e) {
        error = e;
      }
      const elapsedMs = Date.now() - t0;
      report.failPastCeiling.elapsedMs = elapsedMs;
      report.failPastCeiling.errorName = error
        ? String(error.name || error.constructor?.name)
        : null;

      if (!error) {
        throw { message: "failPastCeiling: no throw past the 120s ceiling" };
      }
      const name = String(error.name || error.constructor?.name);
      if (!name.includes("Timeout")) {
        throw {
          message: `failPastCeiling: expected TimeoutError, got ${name}`,
        };
      }
      if (elapsedMs < 110000 || elapsedMs > 135000) {
        throw {
          message: `failPastCeiling: threw at ${elapsedMs}ms, expected ~120000ms`,
        };
      }

      // 释放锁后重试应成功（诚实失败 + 可恢复，对应横幅按钮的重试语义）
      await done;
      await holder;
      const t1 = Date.now();
      await probeImport();
      report.failPastCeiling.retryElapsedMs = Date.now() - t1;
    } catch (e) {
      reportError("failPastCeiling", e);
    } finally {
      await Zotero.DB.queryAsync(`DROP TABLE IF EXISTS ${PROBE_TABLE}`);
    }
  });
});
