/**
 * servicesInit — z-search 启动初始化（搜索专用精简版）。
 *
 * 只初始化搜索管线需要的存储与配置：
 *  - ConfigManager：AI provider/model 配置（LLM 查询改写 / 评估 / 嵌入）
 *  - EmbeddingStore / PdfChunkStore / VectorIndex：向量与全文索引
 *  - JCR / CASS / Warning / Bealls：期刊指标数据（期刊搜索 + 学术评分）
 *  - TokenUsageStore / AICache：AI 用量与缓存
 *
 * 每个初始化独立 try/catch：单项失败不阻断其余项启动。
 */
import ConfigManager from "../utils/config/ConfigManager";
import AIProviderRegistry from "../core/ai/AIProviderRegistry";
import EmbeddingStore from "../core/search/EmbeddingStore";
import PdfChunkStore from "../core/search/PdfChunkStore";
import TokenUsageStore from "../core/ai/TokenUsageStore";
import AICache from "../core/cache/AICache";
import EmbeddingsManager from "../core/ai/EmbeddingsManager";
import { safeDebug, warn } from "../utils/logger";
import { loadDataFile } from "../core/data/DataLoader";
import { getPrefDynamic, setPrefDynamic } from "../utils/prefs";
import { handleSearchSourceMethod } from "../ui/hub/HubSearchSourceHandler";
import { API_KEY_GROUPS } from "../utils/apiKeySchema";
import { isAcademicKeyRequired } from "../core/sources/academic-search/keyFields";
import { config } from "../../package.json";

export async function servicesInit(): Promise<void> {
  // ── Phase 1: 核心存储（无依赖，先行） ─────────────────────────────
  const phase1: Promise<unknown>[] = [
    EmbeddingStore.initialize(),
    (async () => {
      await PdfChunkStore.initialize();
      // Boot must not depend on embedding being configured — getModelInfo()
      // throws when API mode has no model assigned; degrade silently here,
      // the actionable error surfaces when the user runs a search/build.
      let bootModelName = "";
      try {
        bootModelName = EmbeddingsManager.getModelInfo().name;
      } catch (e) {
        safeDebug(
          `[z-search] init: embedding model not configured, skipping PDF chunk index load: ${e}`,
        );
      }
      await PdfChunkStore.loadIndexFromDB(bootModelName);
    })(),
    TokenUsageStore.initialize(),
    AICache.initialize(),
  ];
  await Promise.allSettled(phase1);

  // ── Phase 2: 期刊数据 schema + 首次数据导入 ───────────────────────
  try {
    const [
      { default: JCRSchema },
      { default: JCRStore },
      { default: CASSSchema },
      { default: CASSStore },
      { default: WarningListSchema },
      { default: WarningListStore },
      { default: BeallsListSchema },
      { default: BeallsListStore },
      { default: OpenAlexJournalCacheSchema },
      { default: OpenAlexJournalCacheStore },
    ] = await Promise.all([
      import("../core/data/JCRSchema"),
      import("../core/data/JCRStore"),
      import("../core/data/CASSSchema"),
      import("../core/data/CASSStore"),
      import("../core/data/WarningListSchema"),
      import("../core/data/WarningListStore"),
      import("../core/data/BeallsListSchema"),
      import("../core/data/BeallsListStore"),
      import("../core/data/OpenAlexJournalCacheSchema"),
      import("../core/data/OpenAlexJournalCacheStore"),
    ]);
    await Promise.allSettled([
      JCRSchema.initialize(),
      CASSSchema.initialize(),
      WarningListSchema.initialize(),
      BeallsListSchema.initialize(),
      OpenAlexJournalCacheSchema.initialize(),
      OpenAlexJournalCacheStore.initialize(),
    ]);

    // 数据集导入失败旗（审计 P1-9）：此前只写 debug 日志，用户在期刊页只见
    // 「无数据」，无从得知内置数据集没装上。旗由期刊页横幅消费，可关闭。
    const markJournalDataFailure = (stage: string) => {
      try {
        setPrefDynamic("journalData.importFailed", true);
        setPrefDynamic("journalData.importFailedStage", stage);
      } catch {
        /* 旗写失败不放大错误 */
      }
    };

    // 1. JCR data — check the DB year BEFORE reading the large JSON.
    try {
      const JCR_EXPECTED_YEAR = 2024; // matches jcr-2024.json's embedded `year`
      const latestYear = await JCRStore.getLatestYear();
      if (latestYear !== JCR_EXPECTED_YEAR) {
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
        safeDebug(
          `[z-search] JCR data imported: ${result.inserted} records (year ${jcr.year})`,
        );
      }
    } catch (e) {
      warn("startup.jcr_import_failed", { error: String(e) });
      markJournalDataFailure("jcr");
    }

    // 2. CASS quartile data
    try {
      const CASS_EXPECTED_YEAR = 2025; // matches cass-2025.json's embedded `year`
      const latestYear = await CASSStore.getLatestYear();
      if (latestYear !== CASS_EXPECTED_YEAR) {
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
        safeDebug(
          `[z-search] CASS data imported: ${result.inserted} records (year ${cass.year})`,
        );
      }
    } catch (e) {
      warn("startup.cass_import_failed", { error: String(e) });
      markJournalDataFailure("cass");
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
        safeDebug(
          `[z-search] Warning data imported: ${result.inserted} records`,
        );
      }
    } catch (e) {
      warn("startup.warninglist_import_failed", { error: String(e) });
      markJournalDataFailure("warning");
    }

    // 4. Beall's list data (predatory journals/publishers/misleading metrics)
    try {
      const counts = await BeallsListStore.getCounts();
      if (
        counts.journals === 0 &&
        counts.publishers === 0 &&
        counts.metrics === 0
      ) {
        const bealls = await loadDataFile<{
          standalone: (string | null)[][];
          publishers: (string | null)[][];
          hijacked: (string | null)[][];
          misleading: (string | null)[][];
        }>("bealls.json");
        const standalone = bealls.standalone.map((t) => ({
          journal_name: t[0],
          journal_url: t[1],
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
          standalone,
          publishers,
          hijacked,
          misleading,
        });
        safeDebug(
          `[z-search] Bealls data imported: ${imported.journals} journals, ${imported.publishers} publishers, ${imported.metrics} misleading metrics`,
        );
      }
    } catch (e) {
      warn("startup.bealls_import_failed", { error: String(e) });
      markJournalDataFailure("bealls");
    }
  } catch (e) {
    warn("startup.journal_data_failed", { error: String(e) });
  }

  // ── Phase 3: 暴露单例（跨模块访问，避免循环导入） ─────────────────
  (_globalThis as any).addon.api.configManager = ConfigManager;
  (_globalThis as any).addon.api.aiProviderRegistry = AIProviderRegistry;
  // ConfigManager prefs are loaded lazily; force a load here so a pref
  // parse error surfaces at startup instead of on first provider use.
  try {
    ConfigManager.getAllProviders();
  } catch (e) {
    safeDebug("[z-search] ConfigManager prefs load failed: " + e);
  }
  (_globalThis as any).addon.search = {
    SearchPipeline: (await import("../core/search/SearchPipeline")).default,
    SemanticSearch: (await import("../core/search/SemanticSearch")).default,
    WebSearchProvider: (await import("../core/search/WebSearchProvider"))
      .default,
    JournalSearchService: (await import("../core/search/JournalSearchService"))
      .default,
    EmbeddingStore,
    PdfChunkStore,
  };

  // ── Phase 4: Zotero 设置面板（content/preferences.xhtml）直连接口 ──────
  // 设置页是 chrome 窗口的 XUL fragment，不经 Hub postMessage 桥——搜索源
  // 管理、pref 读写、本地化全部经 addon.api 暴露（与 Hub 侧同一事实源）。
  (_globalThis as any).addon.api.searchSources = handleSearchSourceMethod;
  (_globalThis as any).addon.api.getPrefDynamic = getPrefDynamic;
  (_globalThis as any).addon.api.setPrefDynamic = setPrefDynamic;
  // 学术检索源的 key 字段清单（apiKeySchema 的 academic 组是字段单一事实源，
  // required 取自 academic-search/keyFields.ts），面板据此渲染第二组密钥行；
  // 不复制字段表，防双源漂移。
  (_globalThis as any).addon.api.getAcademicKeyFields = (): any[] => {
    const fields =
      (API_KEY_GROUPS.find((g) => g.groupId === "academic") as any)?.fields ??
      [];
    return fields.map((f: any) => ({
      ...f,
      required: isAcademicKeyRequired(f.prefKey),
    }));
  };
  (_globalThis as any).addon.api.t = (
    key: string,
    args?: Record<string, unknown>,
  ): string => {
    const l10n = (_globalThis as any).addon.data.locale?.current;
    if (!l10n) return key;
    try {
      const msgs = l10n.formatMessagesSync([
        { id: `${config.addonRef}-${key}`, args },
      ]);
      let value = msgs?.[0]?.value;
      if (!value) return key;
      if (args) {
        for (const [k, v] of Object.entries(args)) {
          value = value.replace(
            new RegExp(`\\{\\s*\\$?\\s*${k}\\s*\\}`, "g"),
            String(v),
          );
        }
      }
      return value;
    } catch {
      return key;
    }
  };
}
