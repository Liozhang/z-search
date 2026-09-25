/**
 * JournalSearchDashboard — Hub "Journal" tab. Single input box + 2-way mode
 * segmented control (lookup / discover). E3: the library mode moved to
 * Stats > Bibliometrics (JournalLibraryView); JournalSearchMode keeps the
 * 'library' member only for that shared RPC consumer.
 *
 * Self-contained: owns its own state and bridge
 * calls. All async work happens in JournalSearchService (main script); this
 * component only renders results and guards request races.
 *
 * @module react/components/Hub/search/JournalSearch/JournalSearchDashboard
 */

import React, { useState, useRef, useCallback, useEffect } from "react";
import { getString } from "../../../../utils/locale";
import { NewspaperIcon } from "../../../../utils/icons";
import { semanticRequest } from "../../../../utils/semanticBridge";
import { handleUiError } from "../../../../utils/errorHandler";
import Button from "@/components/ui/button";
import { SearchInput } from "@/components/ui/SearchInput";
import EmptyState from "@/components/ui/EmptyState";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useToast } from "@/components/ui/toast";
import JournalMetricCard from "./JournalMetricCard";
import JournalListItemView from "./JournalListItem";
import { MODE_OPTIONS, DISCOVER_SORT_OPTIONS } from "./types";
import type {
  JournalMetric,
  JournalListItem,
  JournalSearchMode,
  JournalSearchResult,
  JournalSortBy,
} from "../../../../../types/journalSearch";
import { Spinner } from "@/components/ui/Spinner";
import { ICON } from "../../../../utils/iconSizes";

import { isIMEComposing } from "../../../../../utils/ime";
export function JournalSearchDashboard(): React.ReactElement {
  const [mode, setMode] = useState<JournalSearchMode>("metric");
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<JournalSortBy>("relevance");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metric, setMetric] = useState<JournalMetric | null>(null);
  const [list, setList] = useState<JournalListItem[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  /** True once at least one search has completed (drives empty-state copy). */
  const [hasSearched, setHasSearched] = useState(false);
  /** 内置期刊数据集导入失败旗（审计 P1-9）：启动导入挂掉时提示用户数据
   *  缺席的原因，而不是只看到「无数据」。可关闭。 */
  const [dataImportFailed, setDataImportFailed] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const failed = await semanticRequest<boolean>("prefs.getDynamic", {
          key: "journalData.importFailed",
        });
        if (failed === true) setDataImportFailed(true);
      } catch {
        /* 非关键 */
      }
    })();
  }, []);

  const dismissDataBanner = () => {
    setDataImportFailed(false);
    void semanticRequest("prefs.setDynamic", {
      key: "journalData.importFailed",
      value: false,
    }).catch(() => {
      /* 关闭失败不放大 */
    });
  };

  // UX-M23: elapsed-seconds ticker for the loading state. The journal handler
  // (JournalSearchService via HubLiteratureHandler) emits no progress events,
  // so elapsed time + an indeterminate bar is the available feedback.
  const [loadElapsed, setLoadElapsed] = useState(0);

  useEffect(() => {
    if (!isLoading) return;
    const started = Date.now();
    setLoadElapsed(0);
    const timer = window.setInterval(() => {
      setLoadElapsed(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isLoading]);

  // Race guard: increment per request; ignore stale responses.
  const requestId = useRef(0);

  const isMetricMode = mode === "metric";
  const isDiscoverMode = mode === "discover";

  // E3: mode is metric|discover in this UI (library moved to the stats page)
  const placeholderKey = isMetricMode
    ? "journal-placeholder-metric"
    : "journal-placeholder-discover";

  const inputDisabled = false;

  // nextSort: callers that change the sort (Select onChange) pass the new
  // value explicitly — the useCallback closure below still holds the previous
  // sortBy until React re-renders, so reading state there would fire the
  // request with the stale sort (first change looks like a no-op).
  const onSearch = useCallback(
    async (nextSort?: JournalSortBy) => {
      const trimmed = query.trim();
      // Library mode needs no query; the others do.
      if (!trimmed) return;

      const effectiveSort = nextSort ?? sortBy;
      const myId = ++requestId.current;
      setIsLoading(true);
      setError(null);
      setHasSearched(false);

      try {
        const result = await semanticRequest<JournalSearchResult>(
          "journal.search",
          {
            mode,
            query: trimmed,
            limit: isDiscoverMode ? 25 : undefined,
            sortBy: isDiscoverMode ? effectiveSort : undefined,
          },
          60000,
        );
        if (myId !== requestId.current) return;

        if (!result) {
          setError(
            getString("journal-search-failed", {
              args: { error: getString("ux3-journal-no-response") },
            }),
          );
          return;
        }

        // 服务侧错误（如 OpenAlex 断网）与「无结果」分流——不再谎报空态
        // （审计 P1-8）
        if ((result as { error?: string }).error) {
          setError(
            getString("journal-search-failed", {
              args: { error: String(result.error).slice(0, 160) },
            }),
          );
          return;
        }

        setMetric(result.metric ?? null);
        setList(result.list ?? []);
        setTotal(result.total ?? null);
        setHasSearched(true);
      } catch (e: unknown) {
        if (myId !== requestId.current) return;
        setError(
          handleUiError(e, { silent: true }) ||
            getString("journal-search-failed", { args: { error: "" } }),
        );
      } finally {
        if (myId === requestId.current) setIsLoading(false);
      }
    },
    [query, mode, sortBy, isDiscoverMode],
  );

  /**
   * Run a metric-mode lookup for an explicit target (journal name or ISSN),
   * bypassing the `query` state. Used by list-item clicks in discover mode
   * to drill into a full metric card without the caller having to wait
   * for two setState rounds (mode + query) to flush.
   */
  const runMetricLookup = useCallback(async (target: string) => {
    const trimmed = target.trim();
    if (!trimmed) return;

    const myId = ++requestId.current;
    setIsLoading(true);
    setError(null);
    setHasSearched(false);

    try {
      const result = await semanticRequest<JournalSearchResult>(
        "journal.search",
        {
          mode: "metric",
          query: trimmed,
        },
        60000,
      );
      if (myId !== requestId.current) return;

      if (!result) {
        setError(
          getString("journal-search-failed", {
            args: { error: getString("ux3-journal-no-response") },
          }),
        );
        return;
      }
      setMetric(result.metric ?? null);
      setHasSearched(true);
    } catch (e: unknown) {
      if (myId !== requestId.current) return;
      setError(
        handleUiError(e, { silent: true }) ||
          getString("journal-search-failed", { args: { error: "" } }),
      );
    } finally {
      if (myId === requestId.current) setIsLoading(false);
    }
  }, []);

  // 错误通知 toast 化（2026-09-01 用户裁决；Hub 通知统一批 08-29 同范式，文献页同款）：
  // 一次性上抛 + 重试按钮，ref 去重防同一错误重复弹。
  const toast = useToast();
  const errorNotifiedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!error) {
      errorNotifiedRef.current = null;
      return;
    }
    if (errorNotifiedRef.current === error) return;
    errorNotifiedRef.current = error;
    toast.error(error, 0, {
      label: getString("btn-retry"),
      onClick: () => {
        errorNotifiedRef.current = null;
        void onSearch();
      },
    });
  }, [error, onSearch, toast]);

  const onModeChange = (next: JournalSearchMode) => {
    setMode(next);
    setError(null);
    setMetric(null);
    setList([]);
    setTotal(null);
    setHasSearched(false);
    if (next === "discover") setSortBy("relevance");
  };

  const showSortSelect = isDiscoverMode && list.length > 1 && hasSearched;
  const sortOptions = DISCOVER_SORT_OPTIONS;

  // 2026-09-01 用户裁决：外层节奏归位 --space-4 对齐文献页（原 space-2-5 无立法）
  return (
    // 水平轨道唯一归 pane 根 --page-inline-pad（R11-D5；2026-09-09 清双 pad 回归，
    // 与文献页同批）：本层只管纵向。2026-09-22 节奏统一收口：上下律从原型
    // .pane（上 24/下 48 全页统一），32 顶距配方退役。
    <div className="flex flex-col gap-[var(--space-4)] flex-1 min-h-0 overflow-y-auto [scrollbar-width:thin] pt-[var(--space-6)] pb-[var(--space-12)]">
      {/* 模式切换 seg——2026-09-01 用户裁决：underline TabBar→seg（原注释误写
          pill，semantic-mode-segmented 死类零 CSS），与 pane 级 文献|期刊 切换
          同款白片轨道，同屏同形；单选清空 no-op 防御与 SearchPane 同款。 */}
      <ToggleGroup
        multiple={false}
        className="self-start" /* 2026-09-02 值级批：self-center→self-start，用户拍板左对齐；同屏 pane 级 seg 已立法左置 leadero-hub-search.css:23-33 */
        value={[mode]}
        onValueChange={(v) => {
          if (v.length) onModeChange(v[0] as JournalSearchMode);
        }}
        aria-label={getString("hub-search-seg-journal")}
      >
        {MODE_OPTIONS.map((opt) => (
          <ToggleGroupItem key={opt.id} value={opt.id}>
            {getString(opt.labelKey)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {/* 数据集导入失败横幅（审计 P1-9） */}
      {dataImportFailed && (
        <div className="flex items-center justify-between gap-[var(--space-2)] rounded-[var(--radius-sm)] border border-[color:var(--warning)] px-[var(--space-2)] py-[var(--space-1)]">
          <span className="text-[length:var(--text-xs)] text-[color:var(--warning)]">
            {getString("journal-data-import-failed")}
          </span>
          <Button variant="ghost" size="sm" onClick={dismissDataBanner}>
            {getString("btn-close")}
          </Button>
        </div>
      )}

      {/* Input row——2026-09-01 清死类（semantic-search-row/journal-search-row
          全 CSS 零规则）改显式 flex 行对齐文献页工具行；is-anchor-mode 同为死类
          删除（禁用态走 SearchInput disabled 本态）。 */}
      <div className="flex items-center gap-[var(--space-2)] relative">
        <SearchInput
          placeholder={getString(placeholderKey)}
          value={inputDisabled ? "" : query}
          disabled={inputDisabled}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (isIMEComposing(e)) return; // IME：合成期回车=确认候选词，非提交
            if (e.key === "Enter" && !isLoading && !inputDisabled)
              void onSearch();
          }}
        />
        <Button
          variant="default"
          size="default"
          disabled={isLoading || !query.trim()}
          onClick={() => void onSearch()}
        >
          {isLoading
            ? getString("common-searching")
            : getString("common-search")}
        </Button>
      </div>

      {/* 错误走 toast（下方 effect）；ErrorBanner 已按 2026-09-01 裁决退役 */}

      {/* Results header——2026-09-01：容器死类（semantic-results-header）换显式
          utilities（对齐文献页结果头配方）；排序 Select→filter chip（用户裁决，
          与文献页排序同职能同形；semantic-sort-select/leadero-form-select 死类随之退役）。 */}
      {hasSearched && !isMetricMode && list.length > 0 && (
        <div className="flex flex-wrap justify-between items-center gap-[var(--space-2)] py-[var(--space-1)]">
          <span>
            {getString("journal-results-count", {
              args: { count: total ?? list.length },
            })}
          </span>
          {showSortSelect && (
            <ToggleGroup
              variant="filter"
              multiple={false}
              value={[sortBy]}
              onValueChange={(v) => {
                if (!v.length) return;
                const next = v[0] as JournalSortBy;
                setSortBy(next);
                // Re-query with new sort (cheap; local enrichment only).
                // Pass `next` directly — onSearch's closure captures the
                // pre-update sortBy, so calling it bare would search with
                // the old sort (issue: sort only applied on 2nd change).
                void onSearch(next);
              }}
              aria-label={getString("journal-sort-label")}
            >
              {sortOptions.map((o) => (
                <ToggleGroupItem key={o.value} value={o.value}>
                  {getString(o.labelKey)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          )}
        </div>
      )}

      {/* Results body */}
      {isLoading ? (
        <EmptyState
          icon={<Spinner size={16} />}
          busy
          title={getString("ux3-journal-searching")}
          desc={getString("progress-duration-seconds", {
            args: { seconds: loadElapsed },
          })}
        >
          {/* Indeterminate bar — the service reports no progress events.
              2026-09-01：补 --border 实底轨道+高度归 --space-1（对齐文献页同款；
              原型 .pbar 轨道 var(--line) :441——08-31 C3 修复漏传期刊页）。 */}
          <div
            className="w-48 h-[var(--space-1)] rounded-full overflow-hidden bg-[var(--border)]"
            aria-hidden="true"
          >
            {/* 2026-09-21 复审 P2：Tailwind 内建脉冲循环退役 → 法定骨架
                呼吸（leadero-pbar-fill，单次后静置；reduced-motion 由
                components.css 覆盖） */}
            <div className="leadero-pbar-fill h-full w-1/2 rounded-full bg-[var(--accent)]" />
          </div>
        </EmptyState>
      ) : error ? (
        /* CX-5（批1）：失败 ≠ 空——检索失败此前只活在与页面同寿的 toast 里，
            toast 关掉后回落「无数据/初始提示」空态谎报。错误行 + 重试常驻
            页面（isSearching 先判、空态后置；toast 降为补充信号，与 cron
            列表/追踪事件节同制）。 */
        <div className="hub-empty-slim" role="alert">
          <span className="hub-empty-slim-title">{error}</span>
          <Button variant="outline" size="sm" onClick={() => void onSearch()}>
            {getString("btn-retry")}
          </Button>
        </div>
      ) : isMetricMode ? (
        metric ? (
          <JournalMetricCard metric={metric} />
        ) : hasSearched ? (
          <EmptyState
            icon={<NewspaperIcon size={ICON.xl} />}
            desc={getString("journal-not-found")}
          />
        ) : (
          <EmptyState
            icon={<NewspaperIcon size={ICON.xl} />}
            desc={getString("journal-empty-hint")}
          />
        )
      ) : list.length === 0 ? (
        <EmptyState
          desc={
            hasSearched
              ? getString("journal-no-data")
              : // 列表分支只在 discover 模式渲染（metric 已在上方分流）
                getString("journal-empty-hint-discover")
          }
        />
      ) : (
        <div className="flex flex-col gap-[var(--space-2)]">
          {/* 2026-09-02 值级批：gap-1.5→gap-2，与同 pane 文献视图 8px 统一，切
              tab 行距不跳变 */}
          {list.map((item, idx) => (
            <JournalListItemView
              key={`${item.name}-${idx}`}
              item={item}
              countKind="works"
              onClick={(name, issn) => {
                // Drill into a full metric card: switch mode, seed the query
                // box (so the user sees what was looked up), then fire the
                // lookup immediately — no second manual click needed.
                const target = issn || name;
                setMode("metric");
                setQuery(target);
                void runMetricLookup(target);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default JournalSearchDashboard;
