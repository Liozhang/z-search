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
import { getPrefDynamic, setPrefDynamic } from "../utils/prefs";
import { handleSearchSourceMethod } from "../ui/hub/HubSearchSourceHandler";
import { syncToolbarButtons } from "../modules/menuManager";
import { API_KEY_GROUPS } from "../utils/apiKeySchema";
import { ENDPOINT_FIELDS } from "../utils/endpointSchema";
import {
  normalizeEndpointValue,
  validateEndpointValue,
} from "../utils/endpointSchema";
import {
  applyRegionRecommendations,
  getNetworkRegion,
  isChinaContentHidden,
  normalizeRegion,
  setNetworkRegion,
} from "../utils/region";
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
  const phase1Results = await Promise.allSettled(phase1);
  // 核心存储初始化失败不允许静默：EmbeddingStore/PdfChunkStore 初始化内部
  // 刻意 catch→log→rethrow，rejection 落到这里若无人消费，启动照常、首个
  // 症状是搜索期晦涩的「no such table」。至少落到 warn 日志。
  for (const r of phase1Results) {
    if (r.status === "rejected") {
      warn("startup.core_store_failed", { error: String(r.reason) });
    }
  }

  // 条目删除 → 索引清理的观察者（此前清理 API 全部无人调用，删除条目的
  // 分块与向量永久残留并在搜索里复活）。注册幂等。
  try {
    const { registerLibraryIndexNotifier, removeOrphanIndexRows } =
      await import("../modules/libraryIndexNotifier");
    registerLibraryIndexNotifier();
    // 孤儿清理（同步还原、附件级联删除等绕过通知器的场景）：启动后异步
    // 跑一次，不阻塞引导。
    void removeOrphanIndexRows();
  } catch (e) {
    safeDebug("[z-search] index cleanup notifier register failed: " + e);
  }

  // ── Phase 2: 期刊数据 schema + 首次数据导入 ───────────────────────
  // 实现已抽到 core/data/journalDataImport（2026-10-13）：启动与期刊页
  // 横幅「立即导入」（journal.reimportData RPC）共用同一实现、门控与失败
  // 旗置位/复位逻辑。此处只消费结果落日志。
  try {
    const { runJournalDataImport } =
      await import("../core/data/journalDataImport");
    const result = await runJournalDataImport();
    if (!result.ok) {
      const failed = result.stages
        .filter((s) => s.status === "failed")
        .map((s) => s.stage)
        .join(",");
      warn("startup.journal_data_failed", { failed: failed || "unknown" });
    }
  } catch (e) {
    // 模块动态导入本身失败等极端情况：模块内部已尽力置旗，这里兜底再置
    // 一次——横幅必须覆盖一切「内置数据集缺席」的形态。
    try {
      setPrefDynamic("journalData.importFailed", true);
    } catch {
      /* 旗写失败不放大 */
    }
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
  // 工具栏按钮显隐的即时同步（设置面板写 pref 后直调；P0-4）。必须静态
  // 引用：运行时动态 import 在插件沙箱里解析出另一模块实例，调不到注册
  // 时用的那份 module state（实机踩坑 2026-09-26）。
  (_globalThis as any).addon.api.syncToolbarButton = syncToolbarButtons;
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
  // 区域限定端点字段表（endpointSchema 是单一事实源：面板渲染 + 各客户端
  // 求值同源），与 getAcademicKeyFields 同一制式。校验/归一化也走宿主侧：
  // 面板是 chrome 沙箱里的 XUL 脚本，能不持有正则就不持有（防双源漂移）。
  (_globalThis as any).addon.api.getEndpointFields = (): any[] => [
    ...ENDPOINT_FIELDS,
  ];
  (_globalThis as any).addon.api.validateEndpointValue = (
    fieldId: string,
    value: string,
  ): string => {
    const field = ENDPOINT_FIELDS.find((f) => f.fieldId === fieldId);
    return field
      ? validateEndpointValue(field, value)
      : "pref-endpoint-invalid";
  };
  (_globalThis as any).addon.api.normalizeEndpointValue = (
    fieldId: string,
    value: string,
  ): string => {
    const field = ENDPOINT_FIELDS.find((f) => f.fieldId === fieldId);
    return field ? normalizeEndpointValue(field, value) : String(value ?? "");
  };
  // 网络区域选择：读/写/套用推荐值都在宿主侧完成（推荐值的写入守门看
  // 「当前值是否仍是出厂默认」，那判断必须与 prefs 同进程，故不放面板里）。
  (_globalThis as any).addon.api.getNetworkRegion = (): string =>
    getNetworkRegion();
  (_globalThis as any).addon.api.setNetworkRegion = (region: string): void =>
    setNetworkRegion(normalizeRegion(region));
  (_globalThis as any).addon.api.applyRegionRecommendations = (
    region: string,
    force?: boolean,
  ): string[] =>
    applyRegionRecommendations(normalizeRegion(region), {
      force: !!force,
    }) as string[];
  // 中国大陆相关内容的整组显隐（region.hideChinaContent）：读侧单一事实源
  // 在宿主（与区域读写同制式），面板据此过滤 CN 专属行。
  (_globalThis as any).addon.api.isChinaContentHidden = (): boolean =>
    isChinaContentHidden();
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
