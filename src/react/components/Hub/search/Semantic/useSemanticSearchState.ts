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

/** 跳过原因码 → 本地化键（buildComplete.skips 的渲染用；未收录码原样展示）。
 *  与 PdfChunkIndexer 的 reason 常量保持同步。 */
const SKIP_REASON_KEYS: Record<string, string> = {
  "no-pdf-attachment": "semantic-skip-no-pdf-attachment",
  "extraction-failed": "semantic-skip-extraction-failed",
  "low-quality-text": "semantic-skip-low-quality-text",
  "empty-parse": "semantic-skip-empty-parse",
  "already-indexed": "semantic-skip-already-indexed",
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
  }, [refreshModelInfo, refreshIndexStatus]);

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
  }, []);

  const handleFindSimilar = useCallback(async () => {
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
    handleSearch,
    handleCancelSearch,
    handleClear,
    handleFindSimilar,
    handleScanDuplicates,
    handleBuildIndex,
    handleCancelBuild,
    handleRebuildIndex,
    handleOpenItem,
    retryLastAction,
  };
}
