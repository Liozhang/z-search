/**
 * useLiteratureSearch — stateful core of the literature (external databases)
 * search, driving the Hub merged search page alongside the semantic engine.
 *
 * Owns: search request lifecycle (race-guard + cancel + elapsed ticker),
 * filters (sources / year / sort / max / author), selection & import maps
 * (keyed by stable article identity), per-article expand + translate state,
 * and the UX-M32 export actions (copy list / CSV). Purely presentational
 * concerns stay in the components.
 *
 * @module react/components/Hub/search/LiteratureSearch/useLiteratureSearch
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { getString, friendlyErrorMessage } from "../../../../utils/locale";
import { toErrorMessage } from "../../../../utils/error";
import { semanticRequest } from "../../../../utils/semanticBridge";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/toast";
import {
  ArticleResult,
  ImportResult,
  FulltextResult,
  AVAILABLE_SOURCES,
} from "./types";
import { mergeExternalArticles } from "../mergeResults";
import { useClipboard } from "@/hooks/useClipboard";
import { safeDebug } from "../../../../../utils/logger";

/** UX-M41: windowing page size for the results list (module const: stable dep). */
export const VISIBLE_STEP = 30;

/** Stable key for an article (doi / title / positional fallback). Same article
 *  always yields the same key, so selection/import/expand state survives
 *  result-list reordering / filtering. */
export const getArticleKey = (r: ArticleResult, i: number): string =>
  r.doi || r.title || `idx-${i}`;

/** UX-M32: RFC-4180 escaping for CSV cell values. */
const csvEscape = (v: unknown): string => {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function useLiteratureSearch() {
  const confirm = useConfirm();
  const toast = useToast();

  // Search state
  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<ArticleResult[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchPerformed, setSearchPerformed] = useState(false);

  // UX-M23: elapsed-seconds ticker + requested-source count for the loading
  // state, plus per-source progress（渐进检索：逐源并行 RPC，状态条消费
  // done/total 与失败源名单）。
  const [searchElapsed, setSearchElapsed] = useState(0);
  const [searchSourceCount, setSearchSourceCount] = useState(0);

  // 渐进检索（2026-09-23）：外部腿改为逐源并行 RPC，源到齐前结果分批
  // 上屏。进度三件套：已结算源数 / 失败源名单 / 搜索代数（页面的窗口化
  // 重置按代数走，防止每次源落地把可视窗口弹回初始值）。
  const [sourcesDone, setSourcesDone] = useState(0);
  const [searchGen, setSearchGen] = useState(0);

  // 未产出结果的源（2026-09-23 可观测性）：缺 API Key 未发起请求的 / 发起
  // 了但跑失败的。渐进扇出后逐源结算：单源回执的 skippedNoKey/failedSources
  // 与 RPC 本身的抛错都汇入这两张名单。
  const [skippedNoKey, setSkippedNoKey] = useState<string[]>([]);
  const [failedSources, setFailedSources] = useState<string[]>([]);

  // Filters state
  const now = new Date().getFullYear();
  const [yearRange, setYearRange] = useState(`${now - 10 + 1}-${now}`);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<string>("cited");
  const [maxResults, setMaxResults] = useState(100);
  const [authorFilter, setAuthorFilter] = useState("");
  const [journalFilter, setJournalFilter] = useState("");
  const [openAccessOnly, setOpenAccessOnly] = useState(false);

  // Selection + import state — keyed by stable article identity (doi / title /
  // positional fallback) so state survives result-list reordering / filtering.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [importingIds, setImportingIds] = useState<Set<string>>(new Set());
  const [importResults, setImportResults] = useState<Map<string, ImportResult>>(
    new Map(),
  );

  // Expand + translate state (per-article, keyed by stable article identity)
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [translatingKeys, setTranslatingKeys] = useState<Set<string>>(
    new Set(),
  );
  const [translationResults, setTranslationResults] = useState<
    Map<
      string,
      {
        status: "loading" | "success" | "error";
        translatedText?: string;
        truncated?: boolean;
        error?: string;
      }
    >
  >(new Map());

  // Full-text fetch state (per-article, keyed by stable article identity).
  // 拉取走宿主侧 literature.fetchFulltext（PMC 开放获取 JATS XML 优先，
  // OA 网页兜底）；成功即展开，再点一次按钮收起。
  const [fulltextKeys, setFulltextKeys] = useState<Set<string>>(new Set());
  const [fulltextOpenKeys, setFulltextOpenKeys] = useState<Set<string>>(
    new Set(),
  );
  const [fulltextResults, setFulltextResults] = useState<
    Map<string, FulltextResult>
  >(new Map());

  const requestId = useRef(0);
  // 批量导入重入守卫：位置映射（keys[i]↔data[i]）要求单批顺序响应，并发批会错乱
  const importingRef = useRef(false);

  // UX-M23: 1s ticker while a search is in flight (drives the elapsed readout).
  useEffect(() => {
    if (!isSearching) return;
    const started = Date.now();
    setSearchElapsed(0);
    const timer = window.setInterval(() => {
      setSearchElapsed(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isSearching]);

  // Derived: use all sources if none selected
  const activeSources =
    selectedSources.length > 0 ? selectedSources : undefined;

  const handleSearch = useCallback(async () => {
    const trimmed = query.trim();
    if (!trimmed) return;

    const myId = ++requestId.current;
    setIsSearching(true);
    setSearchError(null);
    setSearchPerformed(true);
    setSearchGen((g) => g + 1);
    setSourcesDone(0);
    setSkippedNoKey([]);
    setFailedSources([]);

    // UX-M25（渐进变体）：旧结果保留（灰显于刷新条之后）直到第一批新结果
    // 落地——首个落地源替换列表，其后各源追加；选择/展开/导入/全文状态
    // 只在替换那一刻重置，追加阶段保持可用。
    let firstLanded = false;
    const merge = (incoming: ArticleResult[]) => {
      if (myId !== requestId.current) return;
      const replacing = !firstLanded;
      firstLanded = true;
      // 不在累积时切片（审计 P1-3）：逐源落地即 slice 会让先到源占满
      // maxResults 坑位，晚到的高相关/高被引结果整源被截。累积保留全量
      // 合并集，展示侧（webList / visibleCount）负责排序与窗口。
      if (replacing) {
        setSelectedIds(new Set());
        setImportResults(new Map());
        setExpandedKeys(new Set());
        setTranslationResults(new Map());
        setFulltextKeys(new Set());
        setFulltextOpenKeys(new Set());
        setFulltextResults(new Map());
        setResults(mergeExternalArticles([], incoming));
      } else {
        setResults((prev) => mergeExternalArticles(prev, incoming));
      }
    };

    const requestedSources =
      activeSources ?? AVAILABLE_SOURCES.map((s) => s.value);
    setSearchSourceCount(requestedSources.length);

    // 渐进扇出（2026-09-23）：一次大 RPC 拆成 N 个并行单源 RPC——谁先回来
    // 谁先上屏，慢源（如 30s 级 API）不再拖累其余源；取消走既有
    // literature.searchCancel（遍历 abort 信号 Map 全部置位，天然覆盖并行批）。
    // 跨源去重上移到前端（mergeExternalArticles：DOI 归一优先，标题退化）。
    let landedAny = false;
    let failedCount = 0;

    const perSource = async (src: string) => {
      try {
        const data = await semanticRequest<{
          articles: ArticleResult[];
          skippedNoKey?: string[];
          failedSources?: string[];
        }>(
          "literature.search",
          {
            query: trimmed,
            year: yearRange || undefined,
            sources: [src],
            maxResults,
            sort: sortBy,
            author: authorFilter || undefined,
            journal: journalFilter || undefined,
            openAccessOnly: openAccessOnly || undefined,
          },
          60000,
        );
        if (myId !== requestId.current) return;
        // 缺 Key / 源内失败由回执名单带出（并发 handler 不再以抛错上报）
        if (data?.skippedNoKey?.length) {
          setSkippedNoKey((prev) => [...prev, src]);
        }
        if (data?.failedSources?.length) {
          failedCount++;
          setFailedSources((prev) => [...prev, src]);
        }
        // aborted:true 等非良构回执 = 已取消，丢弃即可
        if (Array.isArray(data?.articles) && data.articles.length > 0) {
          landedAny = true;
          merge(data.articles);
        }
      } catch {
        if (myId !== requestId.current) return;
        failedCount++;
        setFailedSources((prev) => [...prev, src]);
      } finally {
        if (myId === requestId.current) setSourcesDone((d) => d + 1);
      }
    };

    try {
      await Promise.allSettled(requestedSources.map(perSource));
      if (myId !== requestId.current) return;
      // 全军覆没 ≠ 「0 条结果」——显式 error 态（SE-1 同款立法：失败不说谎）
      if (!landedAny && failedCount >= requestedSources.length) {
        setSearchError(getString("lit-all-sources-failed"));
      } else if (!landedAny) {
        // 本次零命中：清掉上一轮结果——否则旧列表继续显示并谎报为本次
        // 「完成 N 条」（审计 P1-6）
        setResults([]);
        setSelectedIds(new Set());
        setImportResults(new Map());
        setExpandedKeys(new Set());
        setTranslationResults(new Map());
        setFulltextKeys(new Set());
        setFulltextOpenKeys(new Set());
        setFulltextResults(new Map());
      }
    } catch (e: unknown) {
      if (myId !== requestId.current) return;
      setSearchError(friendlyErrorMessage(toErrorMessage(e)));
    } finally {
      if (myId === requestId.current) setIsSearching(false);
    }
  }, [
    query,
    yearRange,
    activeSources,
    maxResults,
    sortBy,
    authorFilter,
    journalFilter,
  ]);

  const handleClear = useCallback(() => {
    const wasSearching = isSearching;
    requestId.current++;
    setIsSearching(false);
    setQuery("");
    setResults([]);
    setSearchPerformed(false);
    setSearchError(null);
    setSkippedNoKey([]);
    setFailedSources([]);
    setSelectedIds(new Set());
    setImportResults(new Map());
    setExpandedKeys(new Set());
    setTranslationResults(new Map());
    setFulltextKeys(new Set());
    setFulltextOpenKeys(new Set());
    setFulltextResults(new Map());
    setSourcesDone(0);
    setYearRange(`${now - 10 + 1}-${now}`);
    setSelectedSources([]);
    setSortBy("cited");
    setMaxResults(100);
    setAuthorFilter("");
    setJournalFilter("");
    // If a search is in flight, also tell the Bridge to stop iterating
    // sources; otherwise the backend loop keeps running to completion.
    if (wasSearching) {
      semanticRequest("literature.searchCancel", undefined, 5000).catch(
        () => {},
      );
    }
  }, [isSearching, now]);

  const handleStopSearch = useCallback(async () => {
    // requestId++ must run before setIsSearching (CLAUDE.md: setState before await).
    // It also drops the in-flight response when it eventually resolves.
    requestId.current++;
    setIsSearching(false);
    try {
      await semanticRequest("literature.searchCancel", undefined, 5000);
    } catch (e) {
      safeDebug("[z-search] " + e);
      /* UI already stopped; cancel failure is non-blocking */
    }
  }, []);

  const toggleSelect = useCallback((key: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(results.map((a, i) => getArticleKey(a, i))));
  }, [results]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const toggleExpand = useCallback((key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleTranslate = useCallback(
    async (article: ArticleResult, key: string) => {
      const text = article.abstract?.trim();
      if (!text) return;

      setTranslatingKeys((prev) => new Set(prev).add(key));
      setTranslationResults((prev) => {
        const next = new Map(prev);
        next.set(key, { status: "loading" });
        return next;
      });

      try {
        const data = await semanticRequest<{
          success: boolean;
          translatedText?: string;
          truncated?: boolean;
          error?: string;
        }>("literature.translate", { text }, 60000);
        if (data?.success && data.translatedText) {
          setTranslationResults((prev) => {
            const next = new Map(prev);
            next.set(key, {
              status: "success",
              translatedText: data.translatedText,
              truncated: data.truncated,
            });
            return next;
          });
        } else {
          setTranslationResults((prev) => {
            const next = new Map(prev);
            next.set(key, {
              status: "error",
              error: data?.error || getString("lit-translate-error"),
            });
            return next;
          });
        }
      } catch (e: unknown) {
        setTranslationResults((prev) => {
          const next = new Map(prev);
          next.set(key, {
            status: "error",
            error: friendlyErrorMessage(toErrorMessage(e)),
          });
          return next;
        });
      } finally {
        setTranslatingKeys((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [],
  );

  const handleFetchFulltext = useCallback(
    async (article: ArticleResult, key: string) => {
      // 已成功：按钮退化为展开/收起开关（不重复打网络）。
      const existing = fulltextResults.get(key);
      if (existing?.status === "success") {
        setFulltextOpenKeys((prev) => {
          const next = new Set(prev);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          return next;
        });
        return;
      }

      setFulltextKeys((prev) => new Set(prev).add(key));
      setFulltextResults((prev) => {
        const next = new Map(prev);
        next.set(key, { status: "loading" });
        return next;
      });

      try {
        const data = await semanticRequest<{
          success: boolean;
          reason?: string;
          text?: string;
          source?: string;
          wordCount?: number;
          truncated?: boolean;
          error?: string;
        }>(
          "literature.fetchFulltext",
          {
            doi: article.doi || undefined,
            pmid: article.pmid,
            pmcid: article.pmcid,
            oaUrl: article.oaUrl,
            // 内联展示档位：2 万字符（宿主端上限 6 万，超限截断并标 truncated）。
            maxChars: 20_000,
          },
          90_000,
        );
        if (data?.success && data.text) {
          setFulltextResults((prev) => {
            const next = new Map(prev);
            next.set(key, {
              status: "success",
              text: data.text,
              source: data.source,
              wordCount: data.wordCount,
              truncated: data.truncated,
            });
            return next;
          });
          setFulltextOpenKeys((prev) => new Set(prev).add(key));
        } else {
          setFulltextResults((prev) => {
            const next = new Map(prev);
            next.set(key, {
              status: "error",
              // reason=unavailable → 说实话的静态文案；网络/解析错 → 具体错误。
              error:
                data?.reason === "unavailable"
                  ? getString("lit-fulltext-empty")
                  : (data?.error ?? getString("lit-fulltext-failed")),
            });
            return next;
          });
        }
      } catch (e: unknown) {
        setFulltextResults((prev) => {
          const next = new Map(prev);
          next.set(key, {
            status: "error",
            error: friendlyErrorMessage(toErrorMessage(e)),
          });
          return next;
        });
      } finally {
        setFulltextKeys((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [fulltextResults],
  );

  const handleImport = useCallback(
    async (article: ArticleResult, key: string) => {
      if (!article.doi && !article.title) {
        toast.warning(getString("lit-import-no-doi"));
        return;
      }

      setImportingIds((prev) => {
        const next = new Set(prev);
        next.add(key);
        return next;
      });

      try {
        // entries 契约统一承载（有无 DOI 都走它）：宿主侧标题→DOI 回退解析
        // 后入库；pdfUrl 是 OA PDF 附件的零成本提示（P0-1，有则免一次
        // OpenAlex 反查）。
        const data = await semanticRequest<ImportResult[]>(
          "literature.import",
          {
            entries: [
              {
                doi: article.doi || undefined,
                title: article.title,
                year: article.year ? String(article.year) : undefined,
                pdfUrl: article.pdfUrl || undefined,
              },
            ],
          },
          article.doi ? 30000 : 60000,
        );

        const result = data?.[0];
        if (result) {
          setImportResults((prev) => new Map(prev).set(key, result));
          if (result.imported) {
            toast.success(
              getString("lit-import-success", {
                args: { title: (article.title || "").slice(0, 40) },
              }),
            );
          }
        }
      } catch (e: unknown) {
        setImportResults((prev) =>
          new Map(prev).set(key, {
            success: false,
            title: article.title,
            error: friendlyErrorMessage(toErrorMessage(e)),
            imported: false,
          }),
        );
      } finally {
        setImportingIds((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [toast],
  );

  const handleBatchImport = useCallback(async () => {
    if (importingRef.current) return;
    importingRef.current = true;
    // Build key→article pairs for all selected articles（无 DOI 条目不再剔除，
    // 核心侧 entries 契约做标题→DOI 回退；2026-09-10 P0 链）。
    // Order is preserved so response[i] maps back to keys[i].
    const keyArticlePairs = Array.from(selectedIds)
      .map((k) => {
        const idx = results.findIndex((a, i) => getArticleKey(a, i) === k);
        return idx === -1 ? null : { key: k, article: results[idx] };
      })
      .filter((p): p is { key: string; article: ArticleResult } => p !== null);

    if (keyArticlePairs.length === 0) {
      importingRef.current = false;
      return;
    }

    // 原生 confirm() 在 Hub iframe 内焦点割裂；改用共享 useConfirm（ConfirmDialog）。
    const ok = await confirm({
      message: getString("lit-batch-import-confirm", {
        args: { count: keyArticlePairs.length },
      }),
      confirmLabel: getString("lit-import-btn"),
      cancelLabel: getString("btn-cancel"),
    });
    if (!ok) {
      importingRef.current = false;
      return;
    }

    const entries = keyArticlePairs.map((p) => ({
      doi: p.article.doi,
      title: p.article.title,
      year: p.article.year ? String(p.article.year) : undefined,
      // OA PDF 零成本提示（P0-1）：命中则宿主免一次 OpenAlex 反查
      pdfUrl: p.article.pdfUrl || undefined,
    }));
    const keys = keyArticlePairs.map((p) => p.key);

    setImportingIds(new Set(keys));

    try {
      // 标题→DOI 解析含外网查询+退避重试，超时较纯 DOI 路径放宽。
      const data = await semanticRequest<ImportResult[]>(
        "literature.import",
        { entries },
        120000,
      );

      const resultsMap = new Map(importResults);
      data?.forEach((r: ImportResult, i: number) => {
        if (i < keys.length) {
          resultsMap.set(keys[i], r);
        }
      });
      setImportResults(resultsMap);

      const successCount =
        data?.filter((r: ImportResult) => r.imported).length ?? 0;
      toast.success(
        getString("lit-batch-import-done", {
          args: { count: successCount, total: entries.length },
        }),
      );
      // SE-4：导入批次落地后清空选择——后端对 DOI 路径无存在性检查，
      // 保留选中态时再点一次「导入选中」会对同一批文献重复建条目
      setSelectedIds(new Set());
    } catch (e: unknown) {
      toast.error(
        getString("lit-batch-import-error", {
          args: { error: friendlyErrorMessage(toErrorMessage(e)) },
        }),
      );
    } finally {
      setImportingIds(new Set());
      importingRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, results, importResults, toast]);

  const selectedCount = selectedIds.size;
  const importCount = Array.from(importResults.values()).filter(
    (r) => r.imported,
  ).length;

  // ─── UX-M32: export actions ────────────────────────────────────────────
  const clipboard = useClipboard();

  /** 导出/复制清单的数据集（审计 P2-8）：有勾选时作用于选中集（与同行
   *  「导入选中 (N)」的语义对齐），无勾选时作用于全部结果。 */
  const exportTarget = useCallback(
    () =>
      selectedIds.size > 0
        ? results.filter((_, i) =>
            selectedIds.has(getArticleKey(results[i], i)),
          )
        : results,
    [results, selectedIds],
  );

  const handleCopyList = useCallback(async () => {
    const lines = exportTarget().map((r, i) => {
      const byline = [r.authors || "—"];
      if (r.year) byline.push(`(${r.year})`);
      const block = [`${i + 1}. ${r.title || "—"}`, `    ${byline.join(" ")}`];
      if (r.doi) block.push(`    DOI: ${r.doi}`);
      return block.join("\n");
    });
    const ok = await clipboard.copy(lines.join("\n"));
    if (ok) toast.success(getString("copy-success"));
    else toast.error(getString("copy-failed"));
  }, [exportTarget, clipboard, toast]);

  const handleExportCsv = useCallback(() => {
    const target = exportTarget();
    if (target.length === 0) return;
    try {
      const header = [
        getString("csv-header-title"),
        getString("csv-header-authors"),
        getString("csv-header-year"),
        getString("csv-header-journal"),
        getString("csv-header-doi"),
        getString("csv-header-citations"),
        getString("csv-header-source"),
        getString("csv-header-pdf-url"),
      ];
      const rows = target.map((r) => [
        r.title,
        r.authors,
        r.year,
        r.journal,
        r.doi,
        r.citationCount,
        r.source,
        r.pdfUrl,
      ]);
      // BOM keeps Excel from mangling CJK titles.
      const csv =
        "\uFEFF" +
        [header, ...rows]
          .map((row) => row.map(csvEscape).join(","))
          .join("\r\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `literature-search-${Date.now()}.csv`;
      // Firefox 系（Zotero 内核同源）要求 <a> 在 DOM 中 click 才触发下载；
      // 游离元素可能静默失败（2026-08-25 审计批 D 残余项）。
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      safeDebug("[z-search] " + e);
      toast.error(getString("ux3-lit-export-failed"));
    }
  }, [exportTarget, toast]);

  return {
    // query
    query,
    setQuery,
    // search lifecycle
    isSearching,
    searchError,
    setSearchError,
    searchPerformed,
    searchElapsed,
    searchSourceCount,
    sourcesDone,
    failedSources,
    searchGen,
    skippedNoKey,
    handleSearch,
    handleStopSearch,
    handleClear,
    // filters
    yearRange,
    setYearRange,
    selectedSources,
    setSelectedSources,
    sortBy,
    setSortBy,
    maxResults,
    setMaxResults,
    authorFilter,
    setAuthorFilter,
    journalFilter,
    setJournalFilter,
    openAccessOnly,
    setOpenAccessOnly,
    // results
    results,
    // selection + import
    selectedIds,
    selectedCount,
    importCount,
    importingIds,
    importResults,
    toggleSelect,
    selectAll,
    clearSelection,
    handleImport,
    handleBatchImport,
    // expand + translate
    expandedKeys,
    toggleExpand,
    translatingKeys,
    translationResults,
    handleTranslate,
    // full text
    fulltextKeys,
    fulltextOpenKeys,
    fulltextResults,
    handleFetchFulltext,
    // export
    handleCopyList,
    handleExportCsv,
  };
}

export type LiteratureSearchState = ReturnType<typeof useLiteratureSearch>;
