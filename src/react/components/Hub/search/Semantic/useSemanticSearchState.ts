/**
 * useSemanticSearchState — shared state + handlers for semantic search features.
 *
 * Owns the three semantic capabilities (query search / find-similar /
 * duplicate scan) plus index build status, in a single hook consumed by the
 * Hub search page's 本地搜索 tab (LiteratureSearchPage, 2026-09-23 双 tab 化).
 *
 * The hook does NOT own which view the results area shows (search / similar /
 * duplicates) — that is page-level state. The hook only owns the data
 * and async logic each view drives (bridge requests, race guards, progress
 * notify listeners, watchdog timers).
 *
 * @module react/components/Hub/search/Semantic/useSemanticSearchState
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { getString } from "../../../../utils/locale";
import { handleUiError } from "../../../../utils/errorHandler";
import { semanticRequest } from "../../../../utils/semanticBridge";
import { onBridgeReady } from "../../../../utils/bridge";
import { zoteroNotify } from "@/utils/zoteroNotification";
import { useToast } from "@/components/ui/toast";
import { SearchResult, DuplicateGroup, ModelInfo } from "./types";
import type { EndpointProbeInfo } from "./types";

/** 跳过原因码 → 本地化键（buildComplete.skips 的渲染用；未收录码原样展示）。
 *  与 PdfChunkIndexer / runFullLibraryBuild 的 reason 常量保持同步。 */
const SKIP_REASON_KEYS: Record<string, string> = {
  "no-pdf-attachment": "semantic-skip-no-pdf-attachment",
  "extraction-failed": "semantic-skip-extraction-failed",
  "low-quality-text": "semantic-skip-low-quality-text",
  "empty-parse": "semantic-skip-empty-parse",
  "already-indexed": "semantic-skip-already-indexed",
  "metadata-embedding-unavailable":
    "semantic-skip-metadata-embedding-unavailable",
  "embedding-unconfigured": "semantic-skip-embedding-unconfigured",
};

export interface SemanticSearchState {
  // --- Search form ---
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  limit: number;
  setLimit: (v: number) => void;
  useFullText: boolean;
  setUseFullText: (v: boolean) => void;
  sectionCategory: string | undefined;
  setSectionCategory: (v: string | undefined) => void;

  // --- Search results ---
  isSearching: boolean;
  searchResults: SearchResult[];
  resultsHeader: string;

  // --- Find similar ---
  isFindingSimilar: boolean;
  similarResults: SearchResult[];
  /** True once a findSimilar call completed (mirrors hasScanned): lets the view
   *  separate "nothing selected yet" from "selected but 0 similar". */
  hasSimilarScan: boolean;

  // --- Error ---
  error: string | null;
  setError: (v: string | null) => void;

  // --- Build index ---
  isBuilding: boolean;
  buildProgress: { current: number; total: number } | null;
  buildResult: string | null;

  // --- Scan duplicates ---
  isScanning: boolean;
  scanProgress: { current: number; total: number } | null;
  duplicateResults: DuplicateGroup[];
  hasScanned: boolean;

  // --- Info ---
  modelInfo: ModelInfo | null;
  indexStatus: {
    metadataCount: number;
    chunkCount: number;
    bm25ChunkCount?: number;
  } | null;

  // --- 模型下载通道（本地模式） ---
  isDownloadingModel: boolean;
  isDetectingEndpoint: boolean;
  /** 最近一次端点检测的结果；null = 从未检测或两端点均不可达（用
   *  endpointDetected 区分这两种情形）。 */
  endpointProbe: EndpointProbeInfo | null;
  /** 是否跑过至少一次端点检测。 */
  endpointDetected: boolean;

  // --- Handlers ---
  handleSearch: (queryOverride?: string) => Promise<void>;
  /** Cancel an in-flight semantic.search. Client-side only (no backend RPC):
   *  bumps the requestId race guard so the pending response is dropped, and
   *  clears the loading flag. Keeps existing query/results intact. */
  handleCancelSearch: () => void;
  handleClear: () => void;
  handleFindSimilar: () => Promise<void>;
  handleScanDuplicates: () => Promise<void>;
  handleBuildIndex: () => Promise<void>;
  handleCancelBuild: () => Promise<void>;
  handleRebuildIndex: () => Promise<void>;
  handleOpenItem: (itemID: number) => void;
  /** 手动触发本地嵌入模型下载（绕过自动下载的失败冷却）。完成经
   *  semantic.modelDownloadComplete 通知回执，loading 旗在那里复位。 */
  handleDownloadModel: () => Promise<void>;
  /** 手动重测两个模型源，刷新 24 小时端点缓存；结果渲染在状态行。 */
  handleDetectEndpoint: () => Promise<void>;
  /** SE-2：重跑「最近一次失败的动作」（error 有 8 个写入点，重试不能一律查询检索） */
  retryLastAction: () => void;
}

export function useSemanticSearchState(isActive = true): SemanticSearchState {
  // JA-3（§31.1）：库内结果行的打开回执走 Hub toast = 用户点击所在窗；
  // ToastProvider 已挂全部 React 根（index.tsx mountDashboard / mountElement）。
  const toast = useToast();

  // Search form state
  const [searchQuery, setSearchQuery] = useState("");
  const [limit, setLimit] = useState(10);
  const [useFullText, setUseFullText] = useState(false);
  const [sectionCategory, setSectionCategory] = useState<string | undefined>(
    undefined,
  );

  const [isSearching, setIsSearching] = useState(false);
  const [isFindingSimilar, setIsFindingSimilar] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [similarResults, setSimilarResults] = useState<SearchResult[]>([]);
  // JA-4：找相似的 hasScanned 同款结算旗——区分「主窗无选中」（未跑成）与
  // 「有选中但 0 相似」（跑成、空手）。后者此前误报「请先选择一个条目」。
  const [hasSimilarScan, setHasSimilarScan] = useState(false);
  const [resultsHeader, setResultsHeader] = useState("");

  const [error, setError] = useState<string | null>(null);
  /** 最近一次发起的可失败动作（retryLastAction 的路由依据，见文件尾注释） */
  const lastActionRef = useRef<
    "search" | "findSimilar" | "scanDuplicates" | "buildIndex" | "rebuildIndex"
  >("search");

  // Build index state
  const [isBuilding, setIsBuilding] = useState(false);
  // 重入守卫：build/rebuild 是重型 embedding 操作，防止按钮重复点击触发并发构建损坏索引
  const isBuildingRef = useRef(false);
  const [buildProgress, setBuildProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [buildResult, setBuildResult] = useState<string | null>(null);

  // Scan duplicates state
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [duplicateResults, setDuplicateResults] = useState<DuplicateGroup[]>(
    [],
  );
  const [hasScanned, setHasScanned] = useState(false);

  // Model info
  const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null);

  // 模型下载通道（本地模式）：手动下载的 loading 旗 + 端点检测的展示态。
  // downloading 复位靠 semantic.modelDownloadComplete 通知（下载以分钟计，
  // 早应答的 RPC 不能承载完成时刻）。
  const isDownloadingModelRef = useRef(false);
  const [isDownloadingModel, setIsDownloadingModel] = useState(false);
  const [isDetectingEndpoint, setIsDetectingEndpoint] = useState(false);
  const [endpointProbe, setEndpointProbe] = useState<EndpointProbeInfo | null>(
    null,
  );
  /** 区分「还没检测过」（idle）与「检测过但两个源都不可达」（unreachable）。 */
  const [endpointDetected, setEndpointDetected] = useState(false);

  // Index status — distinguishes "library not indexed" (show onboarding card)
  // from "indexed but no matches" (show normal empty hint). null = not loaded yet.
  const [indexStatus, setIndexStatus] = useState<{
    metadataCount: number;
    chunkCount: number;
    /** BM25-only chunks (text-only indexing) — keyword search works without vectors. */
    bm25ChunkCount?: number;
  } | null>(null);

  // Race-condition guards for search / findSimilar
  const searchRequestId = useRef(0);
  const similarRequestId = useRef(0);
  // 找相似在途守卫（与 isBuildingRef 同款）：深链/按钮重复触发时直接忽略
  // 新请求，而不是让两次 RPC 竞速（后到者使先到者作废、双双真实跑一遍）。
  const isFindingSimilarRef = useRef(false);

  // Progress watchdog timestamps
  const buildProgressAt = useRef<number>(Date.now());
  const scanProgressAt = useRef<number>(Date.now());

  // Refresh model info callback
  const refreshModelInfo = useCallback(() => {
    semanticRequest<ModelInfo>("semantic.getModelInfo")
      .then((info) => {
        if (info) setModelInfo(info);
      })
      .catch((e) => {
        console.warn(
          "[z-search] useSemanticSearchState: cache read failed: ",
          e,
        );
      });
  }, []);

  // Refresh index status
  const refreshIndexStatus = useCallback(() => {
    semanticRequest<{
      metadataCount: number;
      chunkCount: number;
      bm25ChunkCount?: number;
    }>("semantic.getIndexStatus")
      .then((status) => {
        if (status) setIndexStatus(status);
      })
      .catch((e) => {
        console.warn(
          "[z-search] useSemanticSearchState: cache read failed: ",
          e,
        );
      });
  }, []);

  // Listen for fire-and-forget notifications.
  // 抗桥重建（审计 P2-4）：index.tsx 收到重复 init 消息会销毁旧桥换新桥——
  // 挂载时一次性绑定的订阅从此全部悬空（构建进度/完成事件静默丢失，只剩
  // 5 分钟看门狗兜底）。改为 onBridgeReady 事件驱动重绑：每次桥 attach
  // 广播都重新绑定到新桥实例。
  useEffect(() => {
    let unsubs: Array<() => void> = [];
    const bind = (): boolean => {
      const bridge = (window as any).__bridge;
      if (!bridge || typeof bridge.on !== "function") return false;
      for (const off of unsubs) {
        try {
          off();
        } catch {
          /* 旧桥已销毁 */
        }
      }
      unsubs = [];

      unsubs.push(
        bridge.on(
          "semantic.buildProgress",
          (p: { current: number; total: number }) => {
            // 孤儿进度守卫（2026-09-16 审计）：buildComplete/Error 之后到达的迟到
            // 通知（上一代构建的收尾事件等）会把「构建中 9 / 9」复活成与完成摘要、
            // 横幅 CTA 同屏的僵尸态。非构建期一律丢弃；watchdog 的前置也是
            // isBuilding（见下），孤儿进度只能在这里拦。
            if (!isBuildingRef.current) return;
            setBuildProgress(p);
            buildProgressAt.current = Date.now();
          },
        ),
      );
      unsubs.push(
        bridge.on(
          "semantic.buildComplete",
          (r: {
            processed: number;
            skipped: number;
            errors: number;
            failedList?: string;
            skips?: Array<{ reason: string; count: number }>;
            metadataFailed?: { errors: number; firstError: string } | null;
          }) => {
            setIsBuilding(false);
            isBuildingRef.current = false;
            setBuildProgress(null);
            // 跳过明细（2026-09-16 审计 B4）：后端按原因码聚合计数上抛，这里
            // 本地化渲染——原先非错误跳过只剩一个数字，全跳过时用户点构建→
            // 横幅原样→死循环，跳过原因无任何出口。
            const skipLines = (r.skips ?? [])
              .map(({ reason, count }) => {
                const key = SKIP_REASON_KEYS[reason];
                return `  • ${key ? getString(key) : reason} ×${count}`;
              })
              .join("\n");
            // 元数据腿失败的原因出口（2026-10-09）：模型下载失败等场景此前
            // 只有「失败 N 篇」计数，firstError 是后端拼好的本地化可行动文案
            // （网络/镜像指引），原样附在明细末尾。
            const metadataFailedLine = r.metadataFailed
              ? `\n${getString("semantic-metadata-failed", {
                  args: {
                    count: r.metadataFailed.errors,
                    detail: r.metadataFailed.firstError || "-",
                  },
                })}`
              : "";
            setBuildResult(
              getString("semantic-build-done", {
                args: {
                  processed: r.processed,
                  skipped: r.skipped,
                  errors: r.errors,
                },
              }) +
                (skipLines
                  ? `\n${getString("semantic-skipped-details")}\n${skipLines}`
                  : "") +
                metadataFailedLine +
                (r.failedList
                  ? `\n\n${getString("semantic-failed-items")}\n${r.failedList}`
                  : ""),
            );
            refreshModelInfo();
            refreshIndexStatus();
          },
        ),
      );
      unsubs.push(
        bridge.on("semantic.buildError", (r: { error: string }) => {
          setIsBuilding(false);
          isBuildingRef.current = false;
          setBuildProgress(null);
          setBuildResult(
            getString("semantic-build-failed", {
              args: { error: r.error.slice(0, 200) },
            }),
          );
        }),
      );
      // 手动下载的完成回执：后端早应答，这里才是终态——刷新模型状态
      // （downloaded 旗驱动「下载模型」按钮显隐），成功失败都给 Hub 窗内
      // 回执（JA-3 同款：点击所在的窗必须有可感知反馈）。
      unsubs.push(
        bridge.on(
          "semantic.modelDownloadComplete",
          (r: { ok: boolean; modelName?: string; error?: string }) => {
            isDownloadingModelRef.current = false;
            setIsDownloadingModel(false);
            refreshModelInfo();
            if (r.ok) {
              toast.success(getString("embedding-model-download-done"));
            } else {
              toast.error(
                r.error ||
                  getString("embedding-model-download-failed", {
                    args: { detail: "-" },
                  }),
              );
            }
          },
        ),
      );
      unsubs.push(
        bridge.on(
          "semantic.scanProgress",
          (p: { current: number; total: number }) => {
            setScanProgress(p);
            scanProgressAt.current = Date.now();
          },
        ),
      );
      unsubs.push(
        bridge.on(
          "semantic.scanComplete",
          (r: { results: DuplicateGroup[] }) => {
            setIsScanning(false);
            setScanProgress(null);
            setDuplicateResults(r.results);
            setHasScanned(true);
          },
        ),
      );
      unsubs.push(
        bridge.on("semantic.scanError", (r: { error: string }) => {
          setIsScanning(false);
          setScanProgress(null);
          setError(
            getString("semantic-scan-failed", { args: { error: r.error } }),
          );
        }),
      );
      return true;
    };

    let offReady: (() => void) | null = null;
    if (!bind()) {
      offReady = onBridgeReady(() => {
        bind();
        // 桥可能再次被替换——继续挂 ready 监听（notifyBridgeAttached 每次
        // attach 都会唤醒 pending 订阅者）
        offReady = onBridgeReady(bind);
      });
    } else {
      // 已有桥也保持监听后续替换
      offReady = onBridgeReady(bind);
    }

    return () => {
      for (const off of unsubs) {
        try {
          off();
        } catch {
          /* 旧桥已销毁 */
        }
      }
      offReady?.();
    };
    // toast：modelDownloadComplete 订阅里用到；bind 本就设计为可重跑
    // （桥重建即重绑），依赖变化多重绑一次无害。
  }, [refreshModelInfo, refreshIndexStatus, toast]);

  // Watchdog — if build/scan stalls for >5 min, force-clear loading flags.
  // 仅在 isActive 时运行，避免 SearchPane 切走后 30s 定时器空转。
  useEffect(() => {
    if (!isActive) return;
    const WATCHDOG_INTERVAL_MS = 30_000;
    const STALE_THRESHOLD_MS = 5 * 60_000;
    const timer = window.setInterval(() => {
      const now = Date.now();
      if (isBuilding && now - buildProgressAt.current > STALE_THRESHOLD_MS) {
        setIsBuilding(false);
        isBuildingRef.current = false;
        setBuildProgress(null);
        setError(
          getString("semantic-build-failed", {
            args: { error: getString("semantic-watchdog-timeout") },
          }),
        );
      }
      // 双保险（2026-09-16 审计）：isBuilding 已翻 false 而 buildProgress
      // 仍挂着（任何漏网路径的孤儿进度）——若只看 isBuilding 前置，孤儿
      // 进度行永远清不掉，与完成摘要/横幅 CTA 同屏。函数式更新读最新值，
      // 无孤儿时同值 bail-out 不触发重渲染。
      setBuildProgress((prev) =>
        !isBuildingRef.current && prev ? null : prev,
      );
      if (isScanning && now - scanProgressAt.current > STALE_THRESHOLD_MS) {
        setIsScanning(false);
        setScanProgress(null);
        setError(
          getString("semantic-scan-failed", {
            args: { error: getString("semantic-watchdog-timeout") },
          }),
        );
      }
    }, WATCHDOG_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [isBuilding, isScanning, isActive]);

  // Load model info + index status on mount
  useEffect(() => {
    refreshModelInfo();
    refreshIndexStatus();
  }, [refreshModelInfo, refreshIndexStatus]);

  // queryOverride lets callers fire a search with an explicit query (the Hub
  // merged page shares one input box with the literature engine) without
  // waiting a React render for setSearchQuery to flush into this closure.
  // Non-string args (e.g. a stray onClick event) fall back to state.
  const handleSearch = useCallback(
    async (queryOverride?: string) => {
      const trimmed = (
        typeof queryOverride === "string" ? queryOverride : searchQuery
      ).trim();
      if (!trimmed) return;

      const myId = ++searchRequestId.current;
      lastActionRef.current = "search";

      // 索引态三旗（每次调用现算，避免闭包陈旧）：
      //   nothingIndexed = 库内什么索引都没有——元数据语义腿只会触发模型加载
      //     然后空手（或挂到 30s 桥超时），直接跳过；指引由状态条 warn
      //     「索引未建」+ 横幅 CTA 承担。
      //   vectorGap = BM25 文本块在、向量缺席——元数据语义腿注定空手。改走
      //     全文 hybrid 通道：后端 chunkCount=0 时自降级 BM25-only 并带
      //     degraded 标记（F-26/R4-04），兑现横幅「仅 BM25 关键词通道可用」
      //     的承诺（2026-09-16 审计：默认接线绕开 BM25 通道的修复）。
      //   indexStatus 未载入（null）→ 两旗皆 false，保持原行为不拦。
      const gap =
        !!indexStatus &&
        (indexStatus.chunkCount ?? 0) <= 0 &&
        (indexStatus.bm25ChunkCount ?? 0) > 0;
      const nothingIndexed =
        !!indexStatus &&
        (indexStatus.metadataCount ?? 0) <= 0 &&
        (indexStatus.chunkCount ?? 0) <= 0 &&
        (indexStatus.bm25ChunkCount ?? 0) <= 0;

      setIsSearching(true);
      setError(null);
      // SE-6：不再发起时清空结果——外部腿明确保留旧结果（UX-M25）、刷新条
      // 文案也是「当前显示上次结果」；库内腿瞬间归零再回填曾造成列表跳变
      try {
        if (nothingIndexed) {
          if (myId !== searchRequestId.current) return;
          setSearchResults([]);
          setResultsHeader(
            getString("semantic-results-count", { args: { count: 0 } }),
          );
          return;
        }
        const payload =
          gap && !useFullText
            ? {
                query: trimmed,
                limit,
                fulltext: true,
                retrieval: "hybrid" as const,
              }
            : {
                query: trimmed,
                limit,
                fulltext: useFullText,
                sectionCategory: useFullText ? sectionCategory : undefined,
              };
        const results = await semanticRequest<SearchResult[]>(
          "semantic.search",
          payload,
          30000,
        );
        if (myId !== searchRequestId.current) return;
        if (results) {
          setSearchResults(results);
          setResultsHeader(
            getString("semantic-results-count", {
              args: { count: results.length },
            }),
          );
        }
      } catch (e: unknown) {
        if (myId !== searchRequestId.current) return;
        setError(handleUiError(e, { silent: true }));
      } finally {
        if (myId === searchRequestId.current) setIsSearching(false);
      }
    },
    [searchQuery, limit, useFullText, sectionCategory, indexStatus],
  );

  // Cancel an in-flight semantic.search. The backend exposes no
  // semantic.searchCancel RPC (only semantic.cancelBuild), so cancellation is
  // purely client-side: bumping the race-guard id makes the pending response a
  // no-op when it resolves (myId !== searchRequestId.current guard above), and
  // clearing isSearching unblocks the UI. Existing query/results are preserved
  // so the user can refine the query and re-run. Mirrors Literature's
  // handleStopSearch minus its backend RPC (which Semantic lacks).
  const handleCancelSearch = useCallback(() => {
    searchRequestId.current++;
    setIsSearching(false);
  }, []);

  const handleClear = useCallback(() => {
    searchRequestId.current++;
    setIsSearching(false);
    setSearchQuery("");
    setSearchResults([]);
    setResultsHeader("");
    setError(null);
    // 与 web 腿 handleClear 同口径：筛选维度一并复位（limit/全文/章节范围），
    // 否则「清除」后筛选角标仍显示生效计数。
    setLimit(10);
    setUseFullText(false);
    setSectionCategory(undefined);
  }, []);

  const handleFindSimilar = useCallback(async () => {
    if (isFindingSimilarRef.current) return;
    isFindingSimilarRef.current = true;
    const myId = ++similarRequestId.current;
    lastActionRef.current = "findSimilar";

    setError(null);
    setSimilarResults([]);
    setHasSimilarScan(false);
    setIsFindingSimilar(true);
    try {
      const results = await semanticRequest<SearchResult[]>(
        "semantic.findSimilar",
        {
          threshold: 0.8,
          limit: 10,
        },
        30000,
      );
      if (myId !== similarRequestId.current) return;
      if (results) {
        setSimilarResults(results);
        setHasSimilarScan(true);
      }
    } catch (e: unknown) {
      if (myId !== similarRequestId.current) return;
      setError(handleUiError(e, { silent: true }));
    } finally {
      isFindingSimilarRef.current = false;
      if (myId === similarRequestId.current) setIsFindingSimilar(false);
    }
  }, []);

  const handleScanDuplicates = useCallback(async () => {
    lastActionRef.current = "scanDuplicates";
    setIsScanning(true);
    setError(null);
    setDuplicateResults([]);
    setScanProgress(null);
    setHasScanned(false);
    scanProgressAt.current = Date.now();

    try {
      await semanticRequest("semantic.scanDuplicates", { threshold: 0.9 });
    } catch (e: unknown) {
      setIsScanning(false);
      setError(handleUiError(e, { silent: true }));
    }
  }, []);

  const handleBuildIndex = useCallback(async () => {
    if (isBuildingRef.current) return;
    lastActionRef.current = "buildIndex";
    isBuildingRef.current = true;
    setIsBuilding(true);
    setBuildProgress(null);
    setBuildResult(null);
    setError(null);
    buildProgressAt.current = Date.now();

    try {
      await semanticRequest("semantic.buildIndex");
    } catch (e: unknown) {
      setIsBuilding(false);
      isBuildingRef.current = false;
      setError(handleUiError(e, { silent: true }));
    }
  }, []);

  const handleCancelBuild = useCallback(async () => {
    await semanticRequest("semantic.cancelBuild");
  }, []);

  const handleRebuildIndex = useCallback(async () => {
    if (isBuildingRef.current) return;
    lastActionRef.current = "rebuildIndex";
    isBuildingRef.current = true;
    setIsBuilding(true);
    setBuildProgress(null);
    setBuildResult(null);
    setError(null);
    buildProgressAt.current = Date.now();

    try {
      await semanticRequest("semantic.rebuildIndex");
    } catch (e: unknown) {
      setIsBuilding(false);
      isBuildingRef.current = false;
      setError(handleUiError(e, { silent: true }));
    }
  }, []);

  // JA-3（§31.1 + §31.5）：库内结果行的打开是「Hub 页内点击」，成功必须有
  // Hub 窗内回执——此前只有失败侧有通知，成功静默（D5 不对称）。宿主同时
  // 会把 Zotero 主窗带到前台（选中的落点在那），故文案如实说明「已在
  // Zotero 中选中」；宿主报 focused:false（主窗缺失/聚焦调用抛错）时按
  // 降级措辞，提示用户自行切换窗口。本 handler 被库内结果行、找相似结果、
  // 查重组、批5 导入后「打开」四处消费，回执加在此处即全量生效，且调用方
  // 不另发自己的 toast（LiteratureSearchPage.tsx 的 onOpenItem/onOpen 直传
  // 本 handler，追踪动作的 toast 在别的 handler 上，不叠弹）。
  // 失败侧保持既有 zoteroNotify 原生通道不动：结果落在 Hub 窗之外
  // （§31.2 可穿透聚焦），且与同批「打开条目」通道 research.openItem
  // （CompletedResearchView.handleOpenItem）一致。
  const handleOpenItem = useCallback(
    (itemID: number) => {
      semanticRequest<{ opened?: boolean; focused?: boolean }>(
        "semantic.openItem",
        { itemID },
      )
        .then((res) => {
          // 桥不可达时 semanticRequest 返 null：既没选中也没聚焦，不谎报成功
          // （与既有 null = 无结果 的消费惯例一致）。
          if (!res?.opened) return;
          toast.success(
            res.focused === false
              ? getString("semantic-opened-focus-failed")
              : getString("semantic-opened-in-zotero"),
          );
        })
        .catch((e: unknown) => {
          const errMsg = handleUiError(e);
          zoteroNotify(errMsg);
        });
    },
    [toast],
  );

  // 手动触发模型下载：绕过自动通道的 60 秒失败冷却（用户显式点按钮就是
  // 要重试）。后端早应答 {started:true}，终态在 modelDownloadComplete 通知。
  // started 缺席 = 后端拒绝（无可用本地模型名，如 API 模式未配置），就地复位。
  const handleDownloadModel = useCallback(async () => {
    if (isDownloadingModelRef.current) return;
    isDownloadingModelRef.current = true;
    setIsDownloadingModel(true);
    try {
      const res = await semanticRequest<{ started: boolean }>(
        "semantic.downloadModel",
      );
      if (!res?.started) {
        isDownloadingModelRef.current = false;
        setIsDownloadingModel(false);
        toast.error(getString("semantic-model-download-unavailable"));
      }
    } catch (e: unknown) {
      isDownloadingModelRef.current = false;
      setIsDownloadingModel(false);
      toast.error(handleUiError(e, { silent: true }));
    }
  }, [toast]);

  // 手动重测两个模型源（并发探测，最快可达者当选并刷新 24 小时缓存）。
  // 25 秒超时 > 后端探测上限（两端点各 8 秒），桥抖动时不至于挂着按钮。
  const handleDetectEndpoint = useCallback(async () => {
    if (isDetectingEndpoint) return;
    setIsDetectingEndpoint(true);
    try {
      const res = await semanticRequest<EndpointProbeInfo | null>(
        "semantic.detectEndpoint",
        {},
        25000,
      );
      setEndpointProbe(res ?? null);
      setEndpointDetected(true);
      if (res) {
        toast.success(getString("semantic-model-detect-done"));
      } else {
        toast.warning(getString("semantic-model-endpoint-unreachable"));
      }
    } catch {
      setEndpointProbe(null);
      setEndpointDetected(true);
      toast.warning(getString("semantic-model-endpoint-unreachable"));
    } finally {
      setIsDetectingEndpoint(false);
    }
  }, [isDetectingEndpoint, toast]);

  // 重试路由（审计 SE-2）：error 有 8 个写入点（查询/找相似/查重/建索引/
  // 重建/watchdog…），重试按钮必须重跑「失败的那个操作」，不能一律
  // handleSearch——查重失败被重试成查询检索，页面被切走且失败操作从未被重试。
  const retryLastAction = useCallback(() => {
    switch (lastActionRef.current) {
      case "findSimilar":
        void handleFindSimilar();
        break;
      case "scanDuplicates":
        void handleScanDuplicates();
        break;
      case "buildIndex":
        void handleBuildIndex();
        break;
      case "rebuildIndex":
        void handleRebuildIndex();
        break;
      default:
        void handleSearch();
        break;
    }
  }, [
    handleSearch,
    handleFindSimilar,
    handleScanDuplicates,
    handleBuildIndex,
    handleRebuildIndex,
  ]);

  return {
    searchQuery,
    setSearchQuery,
    limit,
    setLimit,
    useFullText,
    setUseFullText,
    sectionCategory,
    setSectionCategory,
    isSearching,
    searchResults,
    resultsHeader,
    isFindingSimilar,
    similarResults,
    hasSimilarScan,
    error,
    setError,
    isBuilding,
    buildProgress,
    buildResult,
    isScanning,
    scanProgress,
    duplicateResults,
    hasScanned,
    modelInfo,
    indexStatus,
    isDownloadingModel,
    isDetectingEndpoint,
    endpointProbe,
    endpointDetected,
    handleSearch,
    handleCancelSearch,
    handleClear,
    handleFindSimilar,
    handleScanDuplicates,
    handleBuildIndex,
    handleCancelBuild,
    handleRebuildIndex,
    handleOpenItem,
    handleDownloadModel,
    handleDetectEndpoint,
    retryLastAction,
  };
}
