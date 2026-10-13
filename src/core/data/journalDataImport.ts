/**
 * journalDataImport — 内置期刊数据集（JCR/中科院分区/预警/Beall's）的
 * schema 初始化与首次/补漏导入。
 *
 * 职责单一化（2026-10-13）：这段逻辑原是 servicesInit Phase 2 的内联体。
 * 启动导入与手动重导（journal.reimportData RPC，期刊页横幅「立即导入」
 * 按钮）共用同一实现——门控（按年判存/按表判空补导）、失败旗置位与复位、
 * 逐 stage 的日志事件名全部保持不变。
 *
 * 失败旗语义：任一 stage 失败 → journalData.importFailed=true（期刊页
 * 横幅消费）；一轮全部成功（含「数据已是期望年份、无需导入」的正常路径）
 * → 复位为 false，上一版本遗留的旗不再永久挂横幅。
 *
 * 并发：模块级在飞锁——启动导入与手动点击、重复触发收敛到同一次运行，
 * 后到者共享同一 Promise（导入幂等，重复执行无意义且白抢写锁）。
 *
 * @module core/data/journalDataImport
 */

import { warn, safeDebug } from "../../utils/logger";
import { setPrefDynamic } from "../../utils/prefs";
import { loadDataFile } from "./DataLoader";

export type JournalDataStageName =
  "schema" | "jcr" | "cass" | "warning" | "bealls";

export interface JournalDataStageResult {
  stage: JournalDataStageName;
  status: "skipped" | "imported" | "failed";
  /** imported=插入行数摘要；failed=异常消息（横幅与日志消费）。 */
  detail?: string;
}

export interface JournalDataImportResult {
  ok: boolean;
  stages: JournalDataStageResult[];
}

let inFlight: Promise<JournalDataImportResult> | null = null;

/**
 * 跑一轮内置数据集导入。在飞时返回同一个 Promise（不并发重入）。
 * 本函数不抛异常：一切失败都落在 ok=false 与 stages 里。
 */
export function runJournalDataImport(): Promise<JournalDataImportResult> {
  if (inFlight) return inFlight;
  inFlight = doRun().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function doRun(): Promise<JournalDataImportResult> {
  const stages: JournalDataStageResult[] = [];
  let journalDataFailed = false;

  const markJournalDataFailure = () => {
    journalDataFailed = true;
    try {
      setPrefDynamic("journalData.importFailed", true);
    } catch {
      /* 旗写失败不放大错误 */
    }
  };

  try {
    const [
      { default: JCRSchema },
      { default: JCRStore },
      { default: CASSSchema },
      { default: CASSStore },
      { default: WarningListSchema },
      { default: WarningListStore },
      { default: BeallsListSchema },
      { default: BeallsListStore, emptyBeallsSegments },
      { default: OpenAlexJournalCacheSchema },
      { default: OpenAlexJournalCacheStore },
    ] = await Promise.all([
      import("./JCRSchema"),
      import("./JCRStore"),
      import("./CASSSchema"),
      import("./CASSStore"),
      import("./WarningListSchema"),
      import("./WarningListStore"),
      import("./BeallsListSchema"),
      import("./BeallsListStore"),
      import("./OpenAlexJournalCacheSchema"),
      import("./OpenAlexJournalCacheStore"),
    ]);
    const initResults = await Promise.allSettled([
      JCRSchema.initialize(),
      CASSSchema.initialize(),
      WarningListSchema.initialize(),
      BeallsListSchema.initialize(),
      OpenAlexJournalCacheSchema.initialize(),
      OpenAlexJournalCacheStore.initialize(),
    ]);
    // 建表失败此前被 allSettled 静默吞掉，要拖到导入阶段才以晦涩的
    // 「no such table」暴露——这里显式落日志（stage 仍照跑，对应表会
    // 以清晰异常失败并置旗）。
    for (const r of initResults) {
      if (r.status === "rejected") {
        warn("startup.journal_schema_failed", { error: String(r.reason) });
      }
    }

    // 数据集导入失败旗（审计 P1-9）：此前只写 debug 日志，用户在期刊页
    // 只见「无数据」，无从得知内置数据集没装上。旗由期刊页横幅消费，
    // 可关闭；一轮全部成功即复位。

    // 1. JCR data — check the DB year BEFORE reading the large JSON.
    try {
      const JCR_EXPECTED_YEAR = 2024; // matches jcr-2024.json's embedded `year`
      // 门控谓词是「期望年份存在」而非「最大年份恰等于期望」：库里一旦
      // 出现更新年份（未来版本导入 2025），不等式会让每次启动都全量重导。
      if (!(await JCRStore.hasData(JCR_EXPECTED_YEAR))) {
        const jcr = await loadDataFile<{
          year: number;
          data: (string | number | null)[][];
        }>("jcr-2024.json");
        const JCR_COLUMNS = [
          "jcr_year",
          "journal_name",
          "abbreviated_name",
          "publisher",
          "issn",
          "eissn",
          "total_cites",
          "total_articles",
          "citable_items",
          "cited_half_life",
          "citing_half_life",
          "jif",
          "five_year_jif",
          "jif_without_self",
          "jci",
          "jif_quartile",
          "jif_rank",
        ];
        const objRows = jcr.data.map((tuple) => {
          const o: Record<string, unknown> = {};
          JCR_COLUMNS.forEach((c, i) => {
            o[c] = tuple[i];
          });
          return o;
        });
        const result = await JCRStore.importRows(objRows);
        stages.push({
          stage: "jcr",
          status: "imported",
          detail: `inserted=${result.inserted} (year ${jcr.year})`,
        });
        safeDebug(
          `[z-search] JCR data imported: ${result.inserted} records (year ${jcr.year})`,
        );
      } else {
        stages.push({ stage: "jcr", status: "skipped" });
      }
    } catch (e) {
      warn("startup.jcr_import_failed", { error: String(e) });
      markJournalDataFailure();
      stages.push({
        stage: "jcr",
        status: "failed",
        detail: String((e as any)?.message ?? e).slice(0, 300),
      });
    }

    // 2. CASS quartile data
    try {
      const CASS_EXPECTED_YEAR = 2025; // matches cass-2025.json's embedded `year`
      // 门控谓词同 JCR：按期望年份判存，不比最大年份。
      if (!(await CASSStore.hasData(CASS_EXPECTED_YEAR))) {
        const cass = await loadDataFile<{
          year: number;
          data: (string | number | null)[][];
        }>("cass-2025.json");
        const CASS_COLUMNS = [
          "cass_year",
          "journal_name",
          "issn",
          "eissn",
          "is_review",
          "is_oa",
          "wos_category",
          "major_category",
          "major_category_en",
          "major_quartile",
          "major_rank",
          "major_total",
          "is_top",
          "minor_categories",
        ];
        const objRows = cass.data.map((tuple) => {
          const o: Record<string, unknown> = {};
          CASS_COLUMNS.forEach((c, i) => {
            o[c] = tuple[i];
          });
          return o;
        });
        const result = await CASSStore.importRows(objRows);
        stages.push({
          stage: "cass",
          status: "imported",
          detail: `inserted=${result.inserted} (year ${cass.year})`,
        });
        safeDebug(
          `[z-search] CASS data imported: ${result.inserted} records (year ${cass.year})`,
        );
      } else {
        stages.push({ stage: "cass", status: "skipped" });
      }
    } catch (e) {
      warn("startup.cass_import_failed", { error: String(e) });
      markJournalDataFailure();
      stages.push({
        stage: "cass",
        status: "failed",
        detail: String((e as any)?.message ?? e).slice(0, 300),
      });
    }

    // 3. Warning list data
    try {
      const count = await WarningListStore.getCount();
      if (count === 0) {
        const warning = await loadDataFile<{
          data: (string | number | null)[][];
        }>("warning.json");
        const WARNING_COLUMNS = [
          "journal_name",
          "warning_year",
          "warning_level",
          "warning_level_en",
          "warning_reason",
          "warning_reason_en",
        ];
        const objRows = warning.data.map((tuple) => {
          const o: Record<string, unknown> = {};
          WARNING_COLUMNS.forEach((c, i) => {
            o[c] = tuple[i];
          });
          return o;
        });
        const result = await WarningListStore.importRows(objRows);
        stages.push({
          stage: "warning",
          status: "imported",
          detail: `inserted=${result.inserted}`,
        });
        safeDebug(
          `[z-search] Warning data imported: ${result.inserted} records`,
        );
      } else {
        stages.push({ stage: "warning", status: "skipped" });
      }
    } catch (e) {
      warn("startup.warninglist_import_failed", { error: String(e) });
      markJournalDataFailure();
      stages.push({
        stage: "warning",
        status: "failed",
        detail: String((e as any)?.message ?? e).slice(0, 300),
      });
    }

    // 4. Beall's list data (predatory journals/publishers/misleading metrics)
    try {
      // 按表补导（2026-10-11）：此前「三表全零才导入」——一次部分导入之后
      // （并发事务超时只落下最小的 metrics 表），非空表把补导条件永久挡死，
      // 实机出现 metrics=53 而 journals/publishers 恒空。哪张空就补哪张。
      const counts = await BeallsListStore.getCounts();
      const missing = emptyBeallsSegments(counts);
      if (missing.length > 0) {
        const bealls = await loadDataFile<{
          standalone: (string | null)[][];
          publishers: (string | null)[][];
          hijacked: (string | null)[][];
          misleading: (string | null)[][];
        }>("bealls.json");
        const standalone = bealls.standalone.map((t) => ({
          journal_name: t[0],
          journal_url: t[1],
          // 第三列是期刊缩写——查询层 L3 缩写匹配从 extra 读（见
          // BeallsListStore.ensureIndex），此前导入时被丢弃，缩写层形同虚设。
          extra: t[2] ?? null,
        }));
        const publishers = bealls.publishers.map((t) => ({
          publisher_name: t[0],
          publisher_url: t[1],
        }));
        const hijacked = bealls.hijacked.map((t) => ({
          journal_name: t[0],
          journal_url: t[1],
          extra: t[2],
        }));
        const misleading = bealls.misleading.map((t) => ({
          metric_name: t[0],
          metric_url: t[1],
        }));
        const imported = await BeallsListStore.importRows({
          standalone: missing.includes("journals") ? standalone : undefined,
          hijacked: missing.includes("journals") ? hijacked : undefined,
          publishers: missing.includes("publishers") ? publishers : undefined,
          misleading: missing.includes("metrics") ? misleading : undefined,
        });
        stages.push({
          stage: "bealls",
          status: "imported",
          detail: `journals=${imported.journals} publishers=${imported.publishers} metrics=${imported.metrics} (repaired: ${missing.join("+")})`,
        });
        safeDebug(
          `[z-search] Bealls data imported: ${imported.journals} journals, ${imported.publishers} publishers, ${imported.metrics} misleading metrics (empty segments repaired: ${missing.join("+")})`,
        );
      } else {
        stages.push({ stage: "bealls", status: "skipped" });
      }
    } catch (e) {
      warn("startup.bealls_import_failed", { error: String(e) });
      markJournalDataFailure();
      stages.push({
        stage: "bealls",
        status: "failed",
        detail: String((e as any)?.message ?? e).slice(0, 300),
      });
    }
    // 本轮无任何 stage 失败（含「数据已是期望年份、无需导入」的正常路径）
    // → 复位失败旗：上一版本遗留的 importFailed=true 不再永久挂横幅。
    if (!journalDataFailed) {
      try {
        setPrefDynamic("journalData.importFailed", false);
      } catch {
        /* 复位失败不放大 */
      }
    }
  } catch (e) {
    // 外层失败（数据模块动态导入失败等）同样置旗——横幅必须覆盖一切
    // 「内置数据集缺席」的形态，而不是只覆盖四个导入 stage。
    markJournalDataFailure();
    warn("startup.journal_data_failed", { error: String(e) });
    stages.push({
      stage: "schema",
      status: "failed",
      detail: String((e as any)?.message ?? e).slice(0, 300),
    });
  }

  return { ok: !journalDataFailed, stages };
}
