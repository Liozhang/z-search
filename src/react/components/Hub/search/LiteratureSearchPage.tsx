/**
 * LiteratureSearchPage — the 文献 half of the Hub merged search page.
 *
 * 2026-09-23 双 tab 化（用户裁决）：一个输入框全域并联、库内+外部混出一个
 * 列表的形态退役，改为两个 tab——
 *
 *   - 网络搜索（默认）：纯外部学术数据库（literature.search）。零配置可用，
 *     首访不被索引问题拦住；工具行 = 筛选/清除；结果 = 外部文献卡 + 导入。
 *   - 本地搜索：纯文库语义/全文（semantic.search）。索引生命周期全部收进
 *     这个 tab——状态条只读库内腿，构建/重建/进度住状态区，而「构建全文
 *     索引」的主按钮住空态（无索引或向量缺口时，空态即引导，不再平铺横幅）。
 *
 * tab 即范围：筛选弹窗按 scope 分流分区（web=来源/查询，local=库内全文
 * 范围），includeLibrary 开关与混列表随之退役。
 *
 * 三段稳定骨架（任何状态高度恒定零跳动）：
 *   tab 行 + 工具行（唯一）：查询输入 + 搜索/取消 ‖ 锚点工具（按 tab 分流）；
 *   状态区（条件渲染）：当前 tab 的单腿读数 +（本地）索引生命周期；
 *   结果区：唯一滚动容器，结果头 + 窗口化列表；锚点工具输出以整块替换
 *   body（✕ 返回横幅，仅本地 tab）。
 *
 * 排序/去重/开窗仍走 mergeResults（纯函数、单测覆盖）——web 传空库内腿、
 * local 传空外部腿，同一套工具服务两个 tab。
 *
 * @module react/components/Hub/search/LiteratureSearchPage
 */

import React, { useState, useMemo, useEffect, useRef } from "react";
import { getString } from "../../../utils/locale";
import { useErrorToast } from "../../../hooks/useErrorToast";
import {
  SearchIconSvg,
  FunnelIcon,
  SparklesIconSvg,
  SparklesIcon,
  CopyIcon,
  BroomIcon,
  DatabaseIconSvg,
} from "../../../utils/icons";
import Button from "@/components/ui/button";
import { SearchInput } from "@/components/ui/SearchInput";
import EmptyState from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { ConfirmButton } from "@/components/ui/ConfirmButton";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Spinner } from "@/components/ui/Spinner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ICON } from "../../../utils/iconSizes";
import { useSemanticSearchState } from "./Semantic/useSemanticSearchState";
import ResultItem from "./Semantic/ResultItem";
import DuplicateGroupItem from "./Semantic/DuplicateGroupItem";
import {
  useLiteratureSearch,
  getArticleKey,
  VISIBLE_STEP,
} from "./LiteratureSearch/useLiteratureSearch";
import { LiteratureResultCard } from "./LiteratureSearch/LiteratureResultCard";
import CitationExplorerDialog, {
  type CitationDirection,
} from "./LiteratureSearch/CitationExplorerDialog";
import type { ArticleResult } from "./LiteratureSearch/types";
import { AVAILABLE_SOURCES } from "./LiteratureSearch/types";
import {
  mergeResults,
  sortMixedResults,
  DISPLAY_SORT_OPTIONS,
  type MixedSortBy,
} from "./mergeResults";
import { SubPageHeader } from "../SubPageHeader";
import { isIMEComposing } from "../../../../utils/ime";
import {
  LiteratureFilterDialog,
  countActiveLiteratureFilters,
  type LiteratureFilterValues,
} from "./LiteratureFilterDialog";

/** Results-area view: query-mixed list (default) or an anchor tool's output. */
type ResultsView = "search" | "similar" | "duplicates";

/** 页面 tab：网络=外部数据库，本地=文库（tab 即范围）。 */
type SearchScope = "web" | "local";

const SCOPE_TABS: ReadonlyArray<{ id: SearchScope; labelKey: string }> = [
  { id: "web", labelKey: "hub-search-tab-web" },
  { id: "local", labelKey: "hub-search-tab-local" },
];

/** 源值 → 本地化展示名（来源标签单源在 AVAILABLE_SOURCES；未知值回落原值）。 */
const sourceNames = (values: string[]): string =>
  values
    .map((v) => {
      const found = AVAILABLE_SOURCES.find((s) => s.value === v);
      return found ? getString(found.labelKey) : v;
    })
    .join(" · ");

/**
 * 引擎状态标记（v2 §4.5 批6）：两腿引擎共用一个标记位——
 *   ok   → 信号绿 ✓ 字符（「通了」，不占视觉预算）
 *   busy → Spinner（构建中，有实时信息）
 *   其余 → 6px 色点（idle 灰 / warn 黄 / error 红，§23.4 色随语义）
 */
function EngineMark({ tone }: { tone: string }): React.ReactElement {
  if (tone === "busy") return <Spinner size={12} />;
  if (tone === "ok") {
    return (
      <span
        aria-hidden="true"
        className="[color:var(--signal-green-dark)] leading-none"
      >
        {"\u2713"}
      </span>
    );
  }
  return (
    <span
      className="hub-search-engine-dot"
      aria-hidden="true"
      style={{
        background:
          tone === "error"
            ? "var(--destructive)"
            : tone === "warn"
              ? "var(--warning)"
              : "var(--text-tertiary)",
      }}
    />
  );
}

export function LiteratureSearchPage({
  isActive = true,
}: {
  isActive?: boolean;
}): React.ReactElement {
  const sem = useSemanticSearchState(isActive);
  const lit = useLiteratureSearch();

  // tab（范围）：默认网络——零配置即可用；本地 tab 承接全部索引生命周期。
  const [scope, setScope] = useState<SearchScope>("web");
  // 筛选弹窗开关（页面唯一的配置入口）。
  const [showFilters, setShowFilters] = useState(false);
  // Which tool owns the results area (search results vs 找相似 / 查重 output).
  const [resultsView, setResultsView] = useState<ResultsView>("search");
  // 构建摘要折叠态（低频管理信息默认收起）。
  const [showBuildResult, setShowBuildResult] = useState(false);

  // 显示排序 + 分 tab 开窗（两 tab 各一份，切 tab 不丢对方的位置）。
  const [displaySort, setDisplaySort] = useState<MixedSortBy>("relevance");
  const [webVisible, setWebVisible] = useState(VISIBLE_STEP);
  const [localVisible, setLocalVisible] = useState(VISIBLE_STEP);

  // 错误 toast 只挂当前 tab——后台 tab 的失败不弹（切回去时错误仍在，
  // dedup ref 会被重置从而正常复弹）。
  useErrorToast(
    scope === "web" ? lit.searchError : null,
    () => void lit.handleSearch(),
  );
  useErrorToast(scope === "local" ? sem.error : null, sem.retryLastAction);

  // ── 索引态旗（本地 tab 显示与工具可用性） ─────────────────────────────────
  // BM25-only library (text-only indexing, no vectors) — keyword search is
  // fully usable, so it counts as "indexed"; the badge says which engine.
  const hasBm25Index = !!(
    sem.indexStatus && (sem.indexStatus.bm25ChunkCount ?? 0) > 0
  );
  // D-IA-1：BM25-only 向量缺口——文本索引在、向量未建（或全为 dimension=0
  // 哨兵行），语义排序缺席。
  const hasVectorGap = hasBm25Index && (sem.indexStatus?.chunkCount ?? 0) <= 0;
  const hasIndex = !!(
    sem.indexStatus &&
    (sem.indexStatus.metadataCount > 0 ||
      sem.indexStatus.chunkCount > 0 ||
      hasBm25Index)
  );
  // 本地 tab 空态 CTA 的出场条件：库内什么都没有，或只有 BM25 没有向量。
  const needsIndexBuild = !hasIndex || hasVectorGap;

  // ── 当前 tab 的查询/检索/清除 ────────────────────────────────────────────
  const query = scope === "web" ? lit.query : sem.searchQuery;
  const isSearching = scope === "web" ? lit.isSearching : sem.isSearching;
  const runSearch = () => {
    if (scope === "web") void lit.handleSearch();
    else void sem.handleSearch(query);
  };
  const cancelSearch = () => {
    if (scope === "web") void lit.handleStopSearch();
    else sem.handleCancelSearch();
  };
  const clearAll = () => {
    if (scope === "web") lit.handleClear();
    else sem.handleClear();
    setResultsView("search");
  };
  const switchScope = (next: SearchScope) => {
    if (next === scope) return;
    setScope(next);
    // 相似/查重输出是本地 tab 的整块替换视图，不跨 tab 逗留。
    setResultsView("search");
  };

  // 各 tab 的「已检索过」：web 看外部腿 performed，local 看结果头/命中。

  // 右键菜单「查找相似文献」深链（2026-09-25 审计 P1-3）：宿主经
  // hub.setActiveTab(action=findSimilar) 送达，SearchShell 转 window 事件——
  // 此处切到本地腿并自动发起找相似（RPC 侧回退解析主窗选中条目）。
  // 视图必须落在 similar 子页（2026-09-26 实机审计）：结果只在
  // resultsView==="similar" 分支渲染——此前写成 "search"，检索发了但
  // 用户永远看不到结果（应用内按钮 runFindSimilar 是切视图的）。
  const deepLinkFindSimilar = sem.handleFindSimilar;
  useEffect(() => {
    const onFindSimilar = () => {
      setScope("local");
      setResultsView("similar");
      void deepLinkFindSimilar();
    };
    window.addEventListener("zsearch:find-similar", onFindSimilar);
    return () =>
      window.removeEventListener("zsearch:find-similar", onFindSimilar);
  }, [deepLinkFindSimilar]);
  const webHasSearched = lit.searchPerformed;
  const localHasSearched = !!sem.resultsHeader || sem.searchResults.length > 0;
  const hasSearched = scope === "web" ? webHasSearched : localHasSearched;
  const isClearable = !!query.trim() || hasSearched || resultsView !== "search";

  // ── 单腿状态读数（当前 tab 只显示自己那条腿） ─────────────────────────────
  const libStatus = sem.isSearching
    ? { tone: "busy", text: getString("hub-search-engine-searching") }
    : sem.error
      ? { tone: "error", text: getString("hub-search-engine-error") }
      : sem.searchResults.some((r) => r.degraded || r.rerankUnavailable)
        ? // R4-04：hybrid 的向量腿不可用 → 命中实为 BM25-only。此前这条
          // 事实只活在 RPC 原始 JSON 里，UI 与用户都以为结果是完整语义
          // 融合排序。降级必须可见（F-26 立法「UI 可据此提示」的兑现）。
          { tone: "warn", text: getString("hub-search-engine-degraded") }
        : sem.searchResults.length > 0
          ? {
              tone: "ok",
              text: getString("hub-search-engine-done", {
                args: { count: sem.searchResults.length },
              }),
            }
          : !sem.indexStatus?.chunkCount && hasBm25Index
            ? // vectors absent, BM25-only: honest engine label instead of
              // the misleading generic "indexed" state.
              { tone: "ok", text: getString("hub-search-engine-bm25") }
            : !hasIndex
              ? { tone: "warn", text: getString("hub-search-empty-index") }
              : { tone: "idle", text: getString("hub-search-engine-idle") };

  // 外部腿状态（渐进检索，2026-09-23）：检索中显示逐源进度；部分源失败
  // 显式 warn（F-31 同源——失败不得消化成「0」），全失败走 error。
  const extStatus = lit.isSearching
    ? {
        tone: "busy",
        text: getString("hub-search-engine-progress", {
          args: {
            done: lit.sourcesDone,
            total: lit.searchSourceCount,
            seconds: lit.searchElapsed,
          },
        }),
      }
    : lit.searchError
      ? { tone: "error", text: getString("hub-search-engine-error") }
      : lit.failedSources.length > 0 && lit.results.length > 0
        ? {
            tone: "warn",
            text: getString("hub-search-engine-partial", {
              args: { count: lit.failedSources.length },
            }),
          }
        : lit.results.length > 0
          ? {
              tone: "ok",
              text: getString("hub-search-engine-done", {
                args: { count: lit.results.length },
              }),
            }
          : { tone: "idle", text: getString("hub-search-engine-idle") };

  // 状态条恒定在位（两 tab 对称，各显示自己那条腿的读数）——「三段稳定
  // 骨架、任何状态高度恒定零跳动」：旧的按需显示会让 web tab 在首次检索
  // 时整页跳一行；本地 tab 的索引态本就是常驻读数，symmetry 收敛为都常驻。
  // 索引生命周期（进度/模型变更/构建摘要）只在本地 tab 露面，逐项自己的
  // 出现条件门控（见状态区 JSX）。

  // ── 分 tab 结果列表（mergeResults 单腿化） ────────────────────────────────
  // 「引用最多」是全局语义：仅 OpenAlex 一家服务端支持 cited 排序，逐源扇出
  // 后合并顺序=网络到达序——此处对合并集按 citationCount 全局降序，兑现
  // 排序选项的字面承诺（2026-09-25 审计 P2-4）。首层 displaySort（相关/日期/
  // 标题）在其后生效。
  const webList = useMemo(() => {
    const articles =
      lit.sortBy === "cited"
        ? [...lit.results].sort(
            (a, b) => (b.citationCount ?? 0) - (a.citationCount ?? 0),
          )
        : lit.results;
    return sortMixedResults(mergeResults([], articles), displaySort);
  }, [lit.results, lit.sortBy, displaySort]);
  const localList = useMemo(
    () => sortMixedResults(mergeResults(sem.searchResults, []), displaySort),
    [sem.searchResults, displaySort],
  );
  const list = scope === "web" ? webList : localList;
  const visibleCount = scope === "web" ? webVisible : localVisible;
  const loadMore = () => {
    if (scope === "web") setWebVisible((v) => v + VISIBLE_STEP);
    else setLocalVisible((v) => v + VISIBLE_STEP);
  };
  const remaining = Math.max(0, list.length - visibleCount);
  // 新结果落地重置开窗——web 腿按搜索代数走（2026-09-23 渐进检索：外部腿
  // 逐源落地时 lit.results 每批都在变，按结果重置会把可视窗口每次弹回
  // 初始值；代数由 handleSearch 递增，一轮搜索内所有批次共享同一代数）。
  // 本地腿无此问题，维持按结果变化重置。
  const lastWebGenRef = useRef(-1);
  useEffect(() => {
    if (lit.searchGen !== lastWebGenRef.current) {
      lastWebGenRef.current = lit.searchGen;
      setWebVisible(VISIBLE_STEP);
    }
  }, [lit.searchGen]);
  useEffect(() => setLocalVisible(VISIBLE_STEP), [sem.searchResults]);

  // ── 筛选弹窗值（按 scope 组装/写回） ─────────────────────────────────────
  const filterValues: LiteratureFilterValues = {
    selectedSources: lit.selectedSources,
    yearRange: lit.yearRange,
    sortBy: lit.sortBy,
    // 结果数按域取用：web=外部腿上限，local=语义腿密度。
    maxResults: scope === "web" ? lit.maxResults : sem.limit,
    author: lit.authorFilter,
    journal: lit.journalFilter,
    openAccessOnly: lit.openAccessOnly,
    useFullText: sem.useFullText,
    sectionCategory: sem.sectionCategory,
  };
  const activeFilterCount = countActiveLiteratureFilters(filterValues, scope);
  const applyFilterValues = (v: LiteratureFilterValues) => {
    if (scope === "web") {
      lit.setSelectedSources(v.selectedSources);
      lit.setYearRange(v.yearRange);
      lit.setSortBy(v.sortBy);
      lit.setMaxResults(v.maxResults);
      lit.setAuthorFilter(v.author);
      lit.setJournalFilter(v.journal);
      lit.setOpenAccessOnly(v.openAccessOnly);
    } else {
      sem.setLimit(v.maxResults);
      sem.setUseFullText(v.useFullText);
      sem.setSectionCategory(v.sectionCategory);
    }
  };

  // ── 引文钻取（P0-2）：种子 + 方向即弹窗；行内导入复用 handleImport 链路 ──
  const [citationSeed, setCitationSeed] = useState<ArticleResult | null>(null);
  const [citationDirection, setCitationDirection] =
    useState<CitationDirection>("cited-by");
  const [citingTitles, setCitingTitles] = useState<Set<string>>(new Set());
  const openCitations = (article: ArticleResult, dir: CitationDirection) => {
    setCitationDirection(dir);
    setCitationSeed(article);
  };
  const importFromCitations = (article: ArticleResult) => {
    const k = getArticleKey(article, -1);
    setCitingTitles((prev) => new Set(prev).add(article.title));
    void Promise.resolve(lit.handleImport(article, k)).finally(() => {
      setCitingTitles((prev) => {
        const next = new Set(prev);
        next.delete(article.title);
        return next;
      });
    });
  };

  // ── anchor tools（仅本地 tab：作用于 Zotero 主窗口选中条目） ──────────────
  const runFindSimilar = () => {
    setResultsView("similar");
    void sem.handleFindSimilar();
  };
  const runScanDuplicates = () => {
    setResultsView("duplicates");
    void sem.handleScanDuplicates();
  };
  const backToSearch = () => setResultsView("search");

  const showToolResults =
    scope === "local" &&
    (resultsView === "similar" || resultsView === "duplicates");

  return (
    /* 水平轨道唯一归 pane 根 --page-inline-pad（R11-D5；2026-09-09 清双 pad
       回归：视图层再消费水平 padding 会与 seg 错位 40px），本层只管纵向。
       2026-09-22 节奏统一收口：上下律从原型 .pane（上 24/下 48 全页统一）。 */
    <div className="hub-lit-page flex flex-col h-full pt-[var(--space-6)] pb-[var(--space-12)] gap-[var(--space-4)] overflow-hidden">
      {/* ═══ tab 行：网络/本地（2026-09-23 双 tab 化）═══
          词汇与期刊仪表盘模式 seg 同款（ToggleGroup 白片轨道、单选、清空
          no-op 防御）；pane 级「文献/期刊」图标对钮不动——两层切换，期刊页
          同构。tab 即范围：工具行/状态条/空态/筛选分区全部随之分流。 */}
      <ToggleGroup
        multiple={false}
        className="self-start"
        value={[scope]}
        onValueChange={(v) => {
          if (!v.length) return;
          switchScope(v[0] as SearchScope);
        }}
        aria-label={getString("hub-search-tab-label")}
      >
        {SCOPE_TABS.map((t) => (
          <ToggleGroupItem key={t.id} value={t.id}>
            {getString(t.labelKey)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {/* ═══ 工具行：输入即页面（v2 §4.5 批6）═══
          搜索页 95% 的会话以输入框为起点，它是本页唯一「主动作」——查询输入
          升为一级控件（lg 档 40px，body 字号）。锚点工具（筛选/找相似/查重/
          清除）是修正性动作，降为输入框下缘的小钮行，并按 tab 分流：
          网络 tab 只留 筛选/清除；找相似/查重是纯库内操作，只在本地 tab。
          2026-09-23 节奏统一：输入行→工具行 8px→16px，与页面其他层叠同距
          （原先贴输入框下缘过挤，比工具行→状态条明显密一档）。 */}
      <div className="flex flex-col gap-[var(--space-4)]">
        <div className="flex gap-[var(--space-2)] items-center">
          <SearchInput
            size="lg"
            className="flex-1 min-w-0"
            placeholder={getString(
              scope === "web"
                ? "hub-search-placeholder-web"
                : "hub-search-placeholder-local",
            )}
            value={query}
            onChange={(e) => {
              if (scope === "web") lit.setQuery(e.target.value);
              else sem.setSearchQuery(e.target.value);
            }}
            onKeyDown={(e) => {
              // isComposing：中文输入法合成期的回车是「确认候选词」而非提交，
              // 放行会以合成中间串提前发起搜索（2026-09-09 审计 P2）。
              if (isIMEComposing(e)) return;
              if (e.key === "Enter" && !isSearching) runSearch();
            }}
          />
          {isSearching ? (
            <Button variant="ghost" onClick={cancelSearch}>
              {getString("btn-cancel")}
            </Button>
          ) : (
            <Button
              variant="default"
              disabled={!query.trim()}
              onClick={runSearch}
            >
              {getString("common-search")}
            </Button>
          )}
        </div>

        {/* 锚点工具行（2026-09-23 起：ghost 有框图标小钮 + 按 tab 分流） */}
        <div className="flex flex-wrap items-center gap-[var(--space-2)]">
          <Button
            variant="ghost"
            size="sm"
            className={`hub-graph-filter-btn${activeFilterCount > 0 ? " has-filter" : ""}`}
            aria-haspopup="dialog"
            onClick={() => setShowFilters(true)}
            icon={<FunnelIcon size={ICON.sm} />}
          >
            {getString("hub-search-filter-trigger")}
            {/* 生效维度计数：currentColor 描边，常态随文字色、黑 chip 态反白 */}
            {activeFilterCount > 0 ? (
              <span className="hub-tool-count">{activeFilterCount}</span>
            ) : null}
          </Button>
          {/* 找相似/查重均纯向量操作，仅本地 tab 露面；无索引或向量缺口态禁用
              （原因由空态 CTA 承担）。检索进行中改走 loading 旋钮：反馈
              「在跑」，不是「坏了」。 */}
          {scope === "local" && (
            <>
              <span title={getString("hub-search-anchor-scope-hint")}>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!hasIndex || hasVectorGap}
                  loading={sem.isFindingSimilar}
                  tooltip={getString("hub-search-anchor-scope-hint")}
                  onClick={runFindSimilar}
                  icon={<SparklesIcon size={ICON.sm} />}
                >
                  {getString("semantic-tab-similar")}
                </Button>
              </span>
              <span title={getString("hub-search-anchor-scope-hint")}>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!hasIndex || hasVectorGap}
                  loading={sem.isScanning}
                  tooltip={getString("hub-search-anchor-scope-hint")}
                  onClick={runScanDuplicates}
                  icon={<CopyIcon size={ICON.sm} />}
                >
                  {getString("semantic-tab-duplicates")}
                </Button>
              </span>
            </>
          )}
          {isClearable && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearAll}
              icon={<BroomIcon size={ICON.sm} />}
            >
              {getString("btn-clear")}
            </Button>
          )}
        </div>
      </div>

      {/* ═══ 状态区：当前 tab 的单腿读数（恒定）+（本地）索引生命周期 ═══ */}
      <div className="flex flex-col gap-[var(--space-2)]">
        <div className="hub-search-engine-strip flex flex-wrap items-center gap-[var(--space-2)] [font:var(--ui-font-meta)] text-[color:var(--text-secondary)]">
          <span className="hub-search-engine-status inline-flex items-center gap-[var(--space-1-5)]">
            <EngineMark
              tone={scope === "web" ? extStatus.tone : libStatus.tone}
            />
            <span className="font-[var(--font-weight-medium)]">
              {getString(
                scope === "web"
                  ? "hub-search-engine-external"
                  : "hub-search-source-library",
              )}
            </span>
            <span>·</span>
            <span>{scope === "web" ? extStatus.text : libStatus.text}</span>
          </span>
        </div>

        {/* 未产出结果的源（2026-09-23 可观测性修复）：加载标题报的是「发起
            了几路」，这里补上「实际哪几路没跑」——缺 Key 与跑失败分开说，
            前者给设置指引。缺 Key 的源本就不该发请求，事后还说「8 个来源」
            而不提它，就是静默降级。 */}
        {scope === "web" && lit.skippedNoKey.length > 0 && (
          <span className="[font:var(--ui-font-caption)] text-[color:var(--text-tertiary)]">
            {getString("hub-search-sources-nokey", {
              args: {
                count: lit.skippedNoKey.length,
                sources: sourceNames(lit.skippedNoKey),
              },
            })}
          </span>
        )}
        {scope === "web" && lit.failedSources.length > 0 && (
          <span className="[font:var(--ui-font-caption)] text-[color:var(--warning)]">
            {getString("hub-search-sources-failed", {
              args: {
                count: lit.failedSources.length,
                sources: sourceNames(lit.failedSources),
              },
            })}
          </span>
        )}

        {/* 索引生命周期（本地 tab 专属）。CTA 横幅已退役——「构建全文
              索引」的主按钮住空态（2026-09-23 用户裁决：缺乏索引时空态
              提供按钮），状态区只留纯读数与低频管理操作。 */}
        {sem.buildProgress && (
          <span className="[font:var(--ui-font-caption)] text-[color:var(--text-secondary)]">
            {getString("semantic-building", { args: sem.buildProgress })}
          </span>
        )}

        {/* Model stale warning */}
        {sem.modelInfo?.hasStaleChunks && (
          <div className="hub-status" data-tone="warn" role="status">
            <span>{getString("semantic-model-changed-warning")}</span>
            <ConfirmButton
              variant="ghost"
              size="md"
              disabled={sem.isBuilding}
              confirmMessage={getString("semantic-build-confirm")}
              confirmLabel={getString("semantic-rebuild-confirm-label")}
              cancelLabel={getString("btn-cancel")}
              onConfirm={sem.handleRebuildIndex}
            >
              {getString("semantic-rebuild")}
            </ConfirmButton>
          </div>
        )}

        {/* 上次构建摘要：折叠 meta 行替代裸 pre 块 */}
        {sem.buildResult && (
          <div>
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={showBuildResult}
              className="bg-transparent border-none text-[color:var(--text-secondary)] [font:var(--ui-font-meta)] cursor-pointer py-[var(--space-0-5)] font-[var(--font-sans)] hover:underline hover:text-[color:var(--text-primary)]"
              onClick={() => setShowBuildResult((v) => !v)}
            >
              {showBuildResult ? "▾" : "▸"} {getString("hub-lit-build-summary")}
            </Button>
            {showBuildResult && (
              <div className="rounded-[var(--radius-md)] px-[var(--space-3)] py-[var(--space-2-5)] overflow-x-auto [&_pre]:m-0 [&_pre]:[font:var(--ui-font-meta)] [&_pre]:whitespace-pre-wrap [&_pre]:break-words">
                <pre>{sem.buildResult}</pre>
              </div>
            )}
          </div>
        )}
      </div>

      {showToolResults ? (
        <ToolResultsView view={resultsView} sem={sem} onBack={backToSearch} />
      ) : (
        <>
          {isSearching && list.length === 0 ? (
            <div className="flex-1 min-h-0 flex flex-col items-center justify-center">
              {/* 2026-09-02 收编 LoadingState（§21.2 加载占位唯一来源）。 */}
              <LoadingState
                inline
                className="p-0"
                title={
                  scope === "web" ? (
                    <>
                      {getString("hub-search-searching-title", {
                        args: { count: lit.searchSourceCount },
                      })}
                      {" · "}
                      {getString("progress-duration-seconds", {
                        args: { seconds: lit.searchElapsed },
                      })}
                    </>
                  ) : (
                    getString("hub-search-engine-searching")
                  )
                }
              />
            </div>
          ) : list.length === 0 ? (
            <div className="flex-1 min-h-0 flex flex-col items-center justify-center">
              {scope === "web" ? (
                hasSearched ? (
                  <EmptyState
                    icon={<SearchIconSvg size={ICON.xl} />}
                    /* SE-3：不用 semantic-no-results（指向旧版页的「相似度阈值」
                       控件，本页无此 UI）——用本页可执行的指引 */
                    desc={getString("ux3-lit-no-results-desc")}
                  />
                ) : (
                  /* 初始态用 Sparkles 与「无结果」拉开差异（前者讲能力：
                     外部数据库 + 可导入；后者讲空无）。 */
                  <EmptyState
                    icon={<SparklesIconSvg size={ICON.xl} />}
                    desc={getString("lit-initial-hint-web")}
                  />
                )
              ) : needsIndexBuild ? (
                /* 本地 tab 无索引/向量缺口：空态即引导——主按钮住这里
                   （2026-09-23 用户裁决），状态条只留「未建索引」读数。 */
                <EmptyState
                  icon={<DatabaseIconSvg size={ICON.xl} />}
                  desc={getString(
                    hasVectorGap
                      ? "semantic-vector-gap-desc"
                      : "semantic-onboarding-desc",
                  )}
                >
                  <div className="mt-[var(--space-3)] flex flex-col items-center gap-[var(--space-2)]">
                    <Button
                      variant="default"
                      size="sm"
                      loading={sem.isBuilding}
                      onClick={() => void sem.handleBuildIndex()}
                    >
                      {getString("semantic-build-index")}
                    </Button>
                    {/* BM25 在、向量未建：关键词通道当下可用，说清楚 */}
                    {hasVectorGap && (
                      <span className="[font:var(--ui-font-caption)] text-[color:var(--text-tertiary)]">
                        {getString("hub-search-local-gap-hint")}
                      </span>
                    )}
                  </div>
                </EmptyState>
              ) : hasSearched ? (
                <EmptyState
                  icon={<SearchIconSvg size={ICON.xl} />}
                  desc={getString("ux3-lit-no-results-desc")}
                />
              ) : (
                <EmptyState
                  icon={<SparklesIconSvg size={ICON.xl} />}
                  desc={getString("lit-initial-hint-local")}
                />
              )}
            </div>
          ) : (
            <div className="relative flex flex-col flex-1 min-h-0 gap-[var(--space-2)]">
              {/* UX-M25: refresh overlay — previous results stay visible, greyed
              and inert, until the new ones land.
              2026-08-31 C3 §23.6 两级线制：刷新条=行内分隔 → 浅档 --hub-row-divider
              （深档 --hub-hairline 退役，节间规则线专用）。 */}
              {isSearching && (
                <div className="flex items-center justify-center gap-[var(--space-1-5)] py-[var(--space-1)] px-[var(--space-2)] [font:var(--ui-font-meta)] text-[color:var(--text-secondary)] bg-transparent border-t border-[var(--hub-row-divider)]">
                  <Spinner size={12} />
                  {getString("ux3-lit-refreshing")}
                </div>
              )}
              {/* Results header: display sort +（web）list actions + 右轨 tabular 计数（§23.4） */}
              <div className="flex flex-wrap justify-between items-center gap-[var(--space-2)] py-[var(--space-1)]">
                <div className="flex flex-wrap gap-[var(--space-2)] items-center">
                  <ToggleGroup
                    variant="filter"
                    multiple={false}
                    value={[displaySort]}
                    onValueChange={(v) => {
                      if (!v.length) return;
                      const found = DISPLAY_SORT_OPTIONS.find(
                        (o) => o.value === v[0],
                      );
                      if (found) setDisplaySort(found.value);
                    }}
                    aria-label={getString("semantic-sort-label")}
                    className="[font:var(--ui-font-meta)] font-[var(--font-weight-medium)]"
                  >
                    {DISPLAY_SORT_OPTIONS.map((o) => (
                      <ToggleGroupItem key={o.value} value={o.value}>
                        {getString(o.labelKey)}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                  {/* 清单/导入类动作只属于外部结果（库内行本就在库里，无
                      选择/导入概念）。 */}
                  {scope === "web" && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={lit.handleCopyList}
                      >
                        {getString("ux3-lit-copy-list")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={lit.handleExportCsv}
                      >
                        {getString("ux3-lit-export-csv")}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={lit.selectAll}>
                        {getString("lit-select-all")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={lit.clearSelection}
                      >
                        {getString("lit-clear-selection")}
                      </Button>
                      <Button
                        variant="default"
                        size="sm"
                        disabled={
                          lit.selectedCount === 0 || lit.importingIds.size > 0
                        }
                        onClick={lit.handleBatchImport}
                      >
                        {getString("lit-import-selected", {
                          args: { count: lit.selectedCount },
                        })}
                      </Button>
                    </>
                  )}
                </div>
                <span
                  className="flex items-center gap-[var(--space-2)] [font:var(--ui-font-meta)] text-[color:var(--text-secondary)] font-[var(--font-weight-medium)] [font-variant-numeric:tabular-nums] ml-auto"
                  role="status"
                  aria-live="polite"
                >
                  {/* 2026-09-23：旧的三段式计数（库内/知识库/外部）随混列表
                      退役——$knowledge 从来没有被传值。两 tab 统一走总数。 */}
                  {getString("hub-search-total-count", {
                    args: { count: list.length },
                  })}
                </span>
              </div>
              {/* Import status footer */}
              {scope === "web" && lit.importCount > 0 && (
                <div className="[font:var(--ui-font-meta)] text-[color:var(--signal-green-dark)] py-[var(--space-1)]">
                  {getString("lit-imported-count", {
                    args: { count: lit.importCount },
                  })}
                </div>
              )}
              <ScrollArea
                reserveGutter
                className={`leadero-scroll flex flex-col gap-[var(--space-2)] flex-1 ${isSearching ? " opacity-50 pointer-events-none" : ""}`}
              >
                {list.slice(0, visibleCount).map((entry) => {
                  if (entry.kind === "library") {
                    return (
                      <ResultItem
                        key={`lib-${entry.result.itemID}`}
                        result={entry.result}
                        query={query}
                        onOpenItem={sem.handleOpenItem}
                      />
                    );
                  }
                  const article = entry.article;
                  // Key must match useLiteratureSearch's own indexing
                  // (getArticleKey(article, i-in-lit.results)) — selection /
                  // import / expand maps are keyed that way.
                  const key = getArticleKey(article, entry.sourceIndex);
                  return (
                    <LiteratureResultCard
                      key={`art-${key}`}
                      article={article}
                      articleKey={key}
                      query={query}
                      isSelected={lit.selectedIds.has(key)}
                      isImporting={lit.importingIds.has(key)}
                      isImported={!!lit.importResults.get(key)?.imported}
                      importResult={lit.importResults.get(key)}
                      isExpanded={lit.expandedKeys.has(key)}
                      isTranslating={lit.translatingKeys.has(key)}
                      translation={lit.translationResults.get(key)}
                      onToggleSelect={lit.toggleSelect}
                      onToggleExpand={lit.toggleExpand}
                      onTranslate={lit.handleTranslate}
                      onImport={lit.handleImport}
                      onCitations={openCitations}
                      onFetchFulltext={lit.handleFetchFulltext}
                      isFetchingFulltext={lit.fulltextKeys.has(key)}
                      isFulltextOpen={lit.fulltextOpenKeys.has(key)}
                      fulltext={lit.fulltextResults.get(key)}
                      /* JA-7：导入成功行「打开」——itemId 即新建 Zotero 条目，
                         复用库内行同一打开通道（semantic.openItem + 失败通知） */
                      onOpen={sem.handleOpenItem}
                    />
                  );
                })}
                {/* UX-M41: windowing — reveal the next slice on demand. */}
                {remaining > 0 && (
                  /* SE-9：self-center 挂在 Button 上对 ScrollArea 根无效——
                     用 flex 容器承担居中 */
                  <div className="flex justify-center mt-[var(--space-1)]">
                    <Button variant="ghost" size="sm" onClick={loadMore}>
                      {getString("ux3-lit-load-more-remaining", {
                        args: { count: remaining },
                      })}
                    </Button>
                  </div>
                )}
                {/* 表格尾状态栏（砚法 §8.3 表格细则〔则〕）：结果型列表尾部挂
                    「共 N 条」计数，发丝线上缘分隔；与头部计数同源，
                    meta 档 + tabular-nums（§8.3 计数等宽）。 */}
                <div className="flex items-center border-t border-[var(--hub-row-divider)] py-[var(--space-1)] [font:var(--ui-font-meta)] text-[color:var(--text-secondary)] [font-variant-numeric:tabular-nums]">
                  {getString("hub-search-total-count", {
                    args: { count: list.length },
                  })}
                </div>
              </ScrollArea>
            </div>
          )}
        </>
      )}

      {/* ═══ 引文钻取弹窗（P0-2）：OpenAlex cited-by / references ═══ */}
      <CitationExplorerDialog
        seed={citationSeed}
        direction={citationDirection}
        onClose={() => setCitationSeed(null)}
        onImport={importFromCitations}
        importingTitles={citingTitles}
      />

      {/* ═══ 筛选弹窗：按 tab 分流分区（改动即时上抛、下次搜索生效） ═══ */}
      <LiteratureFilterDialog
        open={showFilters}
        scope={scope}
        values={filterValues}
        onChange={applyFilterValues}
        onClose={() => setShowFilters(false)}
      />
    </div>
  );
}

/** Results view for the anchor tools (找相似 / 查重): tool output under the
 *  statutory sub-page header (附法 §0 层级规则 2/5，§8.10 定式 4 次级页面). */
function ToolResultsView({
  view,
  sem,
  onBack,
}: {
  view: "similar" | "duplicates";
  sem: ReturnType<typeof useSemanticSearchState>;
  onBack: () => void;
}): React.ReactElement {
  const titleKey =
    view === "similar"
      ? "semantic-results-header-similar"
      : "semantic-results-header-duplicates";

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-[var(--space-2)] overflow-y-auto [scrollbar-width:thin]">
      {/* 次级页法件页头（砚法附法 §0 层级规则 2/5）：返回钮居左缘第一位 +
          面包屑 首页›搜索›找相似/查重——根节点直达由 onBack 承担。 */}
      <SubPageHeader
        parentLabel={getString("hub-tab-search")}
        currentLabel={getString(titleKey)}
        onBack={onBack}
        onNavigateHome={onBack}
      />
      {view === "similar" ? (
        sem.isFindingSimilar ? (
          <div className="flex-1 min-h-0 flex flex-col items-center justify-center">
            {/* 2026-09-02 收编：手拼 Spinner 占位 → LoadingState inline（§21.2 唯一） */}
            <LoadingState inline className="p-0" />
          </div>
        ) : sem.similarResults.length === 0 ? (
          <div className="flex-1 min-h-0 flex flex-col items-center justify-center">
            <EmptyState
              icon={<SearchIconSvg size={ICON.xl} />}
              /* JA-4：空结果按结算旗归因（查重 hasScanned 同款两分支）——
                  未跑成（主窗无选中）→「请先选择一个条目」；跑成但 0 相似
                 →「没有找到相似文献」，不再误报未选中。 */
              desc={getString(
                sem.hasSimilarScan
                  ? "semantic-no-similar"
                  : "common-no-selection",
              )}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-[var(--space-2)]">
            {sem.similarResults.map((r) => (
              <ResultItem
                key={r.itemID}
                result={r}
                onOpenItem={sem.handleOpenItem}
              />
            ))}
          </div>
        )
      ) : /* duplicates view */
      sem.isScanning && sem.scanProgress ? (
        /* v1.53：手拼 Spinner+span → LoadingState inline（UsageDashboard v1.52 同款收编） */
        <LoadingState
          inline
          title={getString("semantic-scanning", {
            args: {
              current: sem.scanProgress.current,
              total: sem.scanProgress.total,
              percent:
                sem.scanProgress.total > 0
                  ? (
                      (sem.scanProgress.current / sem.scanProgress.total) *
                      100
                    ).toFixed(0)
                  : "0",
            },
          })}
        />
      ) : sem.duplicateResults.length === 0 && !sem.hasScanned ? (
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center">
          <EmptyState desc={getString("semantic-scan-desc")} />
        </div>
      ) : sem.duplicateResults.length === 0 && sem.hasScanned ? (
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center">
          <EmptyState desc={getString("semantic-no-duplicates")} />
        </div>
      ) : (
        <div className="flex flex-col gap-[var(--space-2)]">
          <div className="[font:var(--ui-font-meta)] [font-variant-numeric:tabular-nums] text-[color:var(--text-secondary)]">
            {getString("semantic-duplicate-groups", {
              args: { count: sem.duplicateResults.length },
            })}
          </div>
          {sem.duplicateResults.map((group) => (
            <DuplicateGroupItem
              key={group.itemID}
              group={group}
              onOpenItem={sem.handleOpenItem}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default LiteratureSearchPage;
