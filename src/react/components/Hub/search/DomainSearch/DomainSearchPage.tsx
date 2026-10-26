/**
 * DomainSearchPage — 学术子域搜索页（专利/数据集/研究者/基金）。
 *
 * 输入框 + 搜索按钮 + 结果列表。结果卡显示域特定字段：
 *  - 专利：专利号、申请人、IPC/CPC、法律状态
 *  - 数据集：按来源渲染特色字段（见 DatasetMetaFields）
 *  - 研究者：h-index、引用数、works、机构
 *  - 基金：资助机构、金额、执行期、状态、PI
 *
 * 数据集 Tab 内置学科选择器（先选学科再检索）与各学科高级查询字段。
 *
 * 设计制式（2026-10-23 统一批）：本页与文献页/期刊页同基准——hub-redesign
 * 令牌体系（space / text / ui-font-meta 各族）、SearchInput lg 主输入、
 * 状态条结算（失败/缺 key 两路）、ToggleGroup filter chip、共用状态占位
 * 三件套与 Badge/Checkbox。此前本页自带一套 px-4 页面边距、裸 HTML 控件
 * 与硬编码色板（bg-blue-100 等），是三个搜索页里唯一的例外；水平边距归
 * pane 根（R11-D5 单轨），本层只管纵向节奏（与文献页同款 space-2/3/6）。
 *
 * @module react/components/Hub/search/DomainSearch/DomainSearchPage
 */

import React, { useMemo } from "react";
import { getString } from "../../../../utils/locale";
import { SearchIconSvg, BroomIcon } from "../../../../utils/icons";
import { isIMEComposing } from "../../../../../utils/ime";
import { highlightSegments } from "../../../../utils/highlight";
import { externalAnchorClick } from "../../../../utils/openExternal";
import { useDomainSearch } from "./useDomainSearch";
import { SearchInput } from "@/components/ui/SearchInput";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import EmptyState from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/Badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DatasetMetaFields } from "./DatasetMetaFields";
import { DATASET_DISCIPLINES } from "./types";
import type { DomainId, DomainResult } from "./types";
import { ICON } from "../../../../utils/iconSizes";

export function DomainSearchPage({
  domainId,
}: {
  domainId: DomainId;
}): React.ReactElement {
  const {
    query,
    setQuery,
    isSearching,
    searchError,
    searchPerformed,
    metadata,
    results,
    filters,
    setFilters,
    selectedIds,
    importingIds,
    importResults,
    handleSearch,
    handleClear,
    handleImport,
    handleBatchImport,
    toggleSelect,
    selectAll,
  } = useDomainSearch(domainId);

  const placeholderKey =
    domainId === "patent"
      ? "hub-domain-patent-placeholder"
      : domainId === "dataset"
        ? "hub-domain-dataset-placeholder"
        : domainId === "researcher"
          ? "hub-domain-researcher-placeholder"
          : "hub-domain-grant-placeholder";

  // 数据集域：当前选中的学科分组（决定可用源与高级查询字段）
  const activeDiscipline = useMemo(
    () => DATASET_DISCIPLINES.find((d) => d.id === filters.discipline) ?? null,
    [filters.discipline],
  );

  // 源失败/缺 key/不支持当前筛选三路明细（与文献页引擎状态条同口径）：
  // 失败走警示色，缺 key 与能力跳过是预期内的跳过、走次墨色——三者都不
  // 谎报为空结果。
  const failedSources = metadata?.failedSources ?? [];
  const skippedNoKey = metadata?.skippedNoKey ?? [];
  const skippedNoFilter = metadata?.skippedNoFilter ?? [];
  const showStatusLine =
    failedSources.length > 0 ||
    skippedNoKey.length > 0 ||
    skippedNoFilter.length > 0;

  return (
    /* 骨架与文献页同款：水平轨归 pane 根 --page-content-padding（R11-D5），
       本层只管纵向——顶 space-2 / 段 space-3 / 底 space-6（2026-10-12 文献页
       压缩固定区同款裁决），结果区 flex-1 自滚动。 */
    <div className="flex flex-col h-full pt-[var(--space-2)] pb-[var(--space-6)] gap-[var(--space-3)] overflow-hidden">
      {/* ═══ 工具行：输入即页面（文献页同构）═══
          主输入升 lg 档（§21.2 独立搜索页主输入），主动作只有一个：搜索。
          清除是次要动作， ghost 图标小钮收在行尾。 */}
      <div className="flex flex-col gap-[var(--space-2)]">
        <div className="flex flex-wrap gap-[var(--space-2)] items-center">
          <SearchInput
            size="lg"
            className="flex-1 min-w-[200px]"
            placeholder={getString(placeholderKey)}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // IME 合成期回车 = 确认候选词，不是提交（文献页/期刊页同款守卫）
              if (isIMEComposing(e)) return;
              if (e.key === "Enter" && !isSearching) handleSearch();
            }}
          />
          <Button
            variant="default"
            disabled={!query.trim()}
            loading={isSearching}
            loadingText={getString("common-searching")}
            onClick={() => handleSearch()}
          >
            {getString("common-search")}
          </Button>
          {(query || results.length > 0) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClear}
              icon={<BroomIcon size={ICON.sm} />}
            >
              {getString("btn-clear")}
            </Button>
          )}
        </div>

        {/* 数据集域：学科选择器（先选学科，再在该学科的源中检索）。
            chip 形态与文献页来源筛选片同制（filter 变体，§5.4 法定筛选形态），
            此前的默认 seg 变体 + text-xs 手写覆盖退役。 */}
        {domainId === "dataset" && (
          <div className="flex flex-col gap-[var(--space-2)]">
            <ToggleGroup
              variant="filter"
              multiple={false}
              className="flex-wrap [font:var(--ui-font-meta)]"
              value={[filters.discipline ?? "all"]}
              onValueChange={(v) => {
                if (!v.length) return;
                const disc = v[0];
                if (disc === "all") {
                  setFilters({});
                } else {
                  const d = DATASET_DISCIPLINES.find((x) => x.id === disc);
                  setFilters({
                    discipline: disc,
                    sources: d?.sources,
                  });
                }
              }}
              aria-label={getString("domain-discipline-label")}
            >
              <ToggleGroupItem value="all">
                {getString("domain-discipline-all")}
              </ToggleGroupItem>
              {DATASET_DISCIPLINES.map((d) => (
                <ToggleGroupItem key={d.id} value={d.id}>
                  {getString(d.labelKey)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>

            {/* 高级查询字段（根据当前学科的能力渲染）：控件走共用输入件，
                标签走 meta 字体阶梯——与裸 input/select + 手写 border 旧态告别。 */}
            {activeDiscipline && activeDiscipline.filters.length > 0 && (
              <div className="flex flex-wrap items-center gap-[var(--space-3)]">
                {activeDiscipline.filters.map((f) => (
                  <div
                    key={f.key}
                    className="flex items-center gap-[var(--space-1-5)]"
                  >
                    <label
                      className="[font:var(--ui-font-meta)] text-[color:var(--text-tertiary)]"
                      htmlFor={`domain-filter-${f.key}`}
                    >
                      {getString(f.labelKey)}
                    </label>
                    {f.type === "year-range" ? (
                      <Input
                        id={`domain-filter-${f.key}`}
                        className="w-28"
                        value={filters.year ?? ""}
                        onChange={(e) =>
                          setFilters({
                            ...filters,
                            year: e.target.value || undefined,
                          })
                        }
                        placeholder="2020-2024"
                      />
                    ) : f.type === "select" ? (
                      <Select
                        options={(f.options ?? []).map((o) => ({
                          value: o.value,
                          label: getString(o.labelKey),
                        }))}
                        value={(filters as Record<string, any>)[f.key] ?? ""}
                        onChange={(v) =>
                          setFilters({
                            ...filters,
                            [f.key]: v || undefined,
                          })
                        }
                        placeholder="—"
                        /* Select 触发器不带 id，可见 label 关联不上——
                           显式补无障碍名（ Select API 的 aria-label 位）。 */
                        ariaLabel={getString(f.labelKey)}
                      />
                    ) : f.type === "multi-select" ? (
                      /* 任务标签多选：并集口径（任一命中即保留），与文献页
                         来源筛选片同制式（filter chip，§5.4）。 */
                      <ToggleGroup
                        variant="filter"
                        multiple
                        className="[font:var(--ui-font-meta)]"
                        value={(filters as Record<string, any>)[f.key] ?? []}
                        onValueChange={(v) =>
                          setFilters({
                            ...filters,
                            [f.key]: v.length ? v : undefined,
                          })
                        }
                        aria-label={getString(f.labelKey)}
                      >
                        {(f.options ?? []).map((o) => (
                          <ToggleGroupItem key={o.value} value={o.value}>
                            {getString(o.labelKey)}
                          </ToggleGroupItem>
                        ))}
                      </ToggleGroup>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 状态条：失败/缺 key 两路明细并入一行（文献页引擎状态条同制式），
            窄宽自然折行。失败不谎报为空结果。 */}
        {showStatusLine && (
          <div className="hub-search-engine-strip flex flex-wrap items-center gap-x-[var(--space-2)] gap-y-[var(--space-0-5)] [font:var(--ui-font-meta)] text-[color:var(--text-secondary)]">
            {failedSources.length > 0 && (
              <span className="inline-flex items-center gap-[var(--space-1-5)] [font:var(--ui-font-caption)] text-[color:var(--warning)]">
                {getString("domain-sources-failed", {
                  args: { count: failedSources.length },
                })}
                : {failedSources.join(", ")}
              </span>
            )}
            {skippedNoKey.length > 0 && (
              <span className="inline-flex items-center gap-[var(--space-1-5)] [font:var(--ui-font-caption)] text-[color:var(--text-tertiary)]">
                <span aria-hidden="true">·</span>
                {getString("domain-sources-nokey", {
                  args: {
                    count: skippedNoKey.length,
                    sources: skippedNoKey.join(", "),
                  },
                })}
              </span>
            )}
            {skippedNoFilter.length > 0 && (
              <span className="inline-flex items-center gap-[var(--space-1-5)] [font:var(--ui-font-caption)] text-[color:var(--text-tertiary)]">
                <span aria-hidden="true">·</span>
                {getString("domain-sources-nofilter", {
                  args: {
                    count: skippedNoFilter.length,
                    sources: skippedNoFilter.join(", "),
                  },
                })}
              </span>
            )}
          </div>
        )}
      </div>

      {/* ═══ 结果区：唯一滚动容器 ═══ */}
      <div className="flex-1 min-h-0 overflow-y-auto [scrollbar-width:thin]">
        {isSearching && <LoadingState title={getString("common-searching")} />}

        {!isSearching && searchError && (
          /* 失败常驻行（期刊页 CX-5 同制式）：检索失败不与「无结果」混淆，
             重试钮就地可用。 */
          <div className="hub-empty-slim" role="alert">
            <span className="hub-empty-slim-title">{searchError}</span>
            <Button variant="outline" size="sm" onClick={() => handleSearch()}>
              {getString("btn-retry")}
            </Button>
          </div>
        )}

        {!isSearching && !searchError && !searchPerformed && (
          <EmptyState
            icon={<SearchIconSvg size={ICON.xl} />}
            desc={getString("domain-empty-hint")}
          />
        )}

        {!isSearching &&
          !searchError &&
          searchPerformed &&
          results.length === 0 && (
            <EmptyState
              icon={<SearchIconSvg size={ICON.xl} />}
              title={getString("domain-no-results")}
              desc={getString("domain-no-results-hint")}
            />
          )}

        {!isSearching && !searchError && results.length > 0 && (
          <>
            {/* 结果头：左缘计数 + 批量动作（文献页结果行 B 同制式） */}
            <div className="flex flex-wrap items-center gap-[var(--space-1-5)] py-[var(--space-0-5)]">
              <span className="[font:var(--ui-font-meta)] text-[color:var(--text-secondary)]">
                {getString("domain-result-count", {
                  args: { count: results.length },
                })}
              </span>
              {selectedIds.size > 0 && (
                <>
                  <Button
                    variant="default"
                    size="sm"
                    loading={importingIds.size > 0}
                    onClick={handleBatchImport}
                  >
                    {getString("domain-import-selected", {
                      args: { count: selectedIds.size },
                    })}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => selectAll()}>
                    {getString("domain-select-all")}
                  </Button>
                </>
              )}
            </div>

            {/* 结果列表：文献卡同款分隔行 + 悬停灯罩 + 选中左指示条 */}
            <div className="flex flex-col">
              {results.map((r) => (
                <DomainResultCard
                  key={r.dedupKey}
                  result={r}
                  query={query}
                  domainId={domainId}
                  selected={selectedIds.has(r.dedupKey)}
                  importing={importingIds.has(r.dedupKey)}
                  importResult={importResults.get(r.dedupKey)}
                  onToggleSelect={() => toggleSelect(r.dedupKey)}
                  onImport={() => handleImport(r)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** 域结果卡片（文献卡制式：分隔行、令牌排版、徽章化元信息）。 */
function DomainResultCard({
  result,
  query,
  domainId,
  selected,
  importing,
  importResult,
  onToggleSelect,
  onImport,
}: {
  result: DomainResult;
  query: string;
  domainId: DomainId;
  selected: boolean;
  importing: boolean;
  importResult: any;
  onToggleSelect: () => void;
  onImport: () => void;
}): React.ReactElement {
  const imported = importResult?.imported === true;

  return (
    /* 文献卡同款 Recipe：无卡片盒、行间分隔线、悬停 --hub-bg-hover 灯罩、
       选中态左缘 2px 交互蓝指示条（--hub-indicator-color 单源）。 */
    <div
      className={`box-border bg-transparent border-0 border-b border-b-[var(--hub-row-divider)] border-l-[var(--stroke-edge)] border-l-transparent rounded-none px-0 py-[var(--space-3)] transition-colors duration-[var(--transition-fast)] hover:bg-[var(--hub-bg-hover)]${selected ? " !border-l-[var(--hub-indicator-color)]" : ""}`}
    >
      <div className="flex items-start gap-[var(--space-3)]">
        <Checkbox
          className="mt-[var(--space-1)] w-[var(--icon-md)] h-[var(--icon-md)] flex-shrink-0 cursor-pointer"
          checked={selected}
          onChange={onToggleSelect}
          disabled={result.inLibrary || imported}
          aria-label={getString("aria-select-result", {
            args: { title: result.title || "" },
          })}
        />

        <div className="flex-1 min-w-0">
          {/* 标题：显示字体 + 检索词命中品牌红高亮（文献卡同款）。
              点击 = 系统浏览器打开来源页（跳转批 2026-10-26）：chrome://
              iframe 里 <a target="_blank"> 是死点击，统一拦截走桥上行；
              源未给 url 时降级为纯标题（不可点形态，不留死链）。 */}
          {result.url ? (
            <a
              href={result.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={externalAnchorClick(result.url)}
              className="block text-[length:var(--text-base)] font-[var(--font-weight-semibold)] font-[family-name:var(--ui-family-display)] text-[color:var(--text-primary)] leading-[var(--leading-tight)] break-words hover:underline [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] overflow-hidden"
            >
              {highlightSegments(result.title, query).map((seg, i) =>
                seg.hit ? (
                  <span key={i} className="text-[color:var(--accent)]">
                    {seg.text}
                  </span>
                ) : (
                  <React.Fragment key={i}>{seg.text}</React.Fragment>
                ),
              )}
            </a>
          ) : (
            <div className="text-[length:var(--text-base)] font-[var(--font-weight-semibold)] font-[family-name:var(--ui-family-display)] text-[color:var(--text-primary)] leading-[var(--leading-tight)] break-words [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] overflow-hidden">
              {highlightSegments(result.title, query).map((seg, i) =>
                seg.hit ? (
                  <span key={i} className="text-[color:var(--accent)]">
                    {seg.text}
                  </span>
                ) : (
                  <React.Fragment key={i}>{seg.text}</React.Fragment>
                ),
              )}
            </div>
          )}

          {/* 元信息行：年份 + 来源徽章 + 库内/已导入状态徽章（徽章化，
              取代旧裸文字与硬编码色板） */}
          <div className="flex flex-wrap items-center gap-[var(--space-1-5)] mt-[var(--space-1)]">
            {result.year && (
              <span className="[font:var(--ui-font-meta)] text-[color:var(--text-secondary)]">
                {result.year}
              </span>
            )}
            <Badge tone="neutral">{result.source}</Badge>
            {result.inLibrary && (
              <Badge tone="info" title={getString("domain-in-library")}>
                {getString("domain-in-library")}
              </Badge>
            )}
            {imported && (
              <Badge tone="success">{getString("domain-imported")}</Badge>
            )}
          </div>

          {/* 数据集域：按来源渲染特色字段 */}
          {domainId === "dataset" && <DatasetMetaFields result={result} />}
          {/* 学科专用数据集源（bio/chemistry/geoscience/social-science） */}
          {(domainId as string) !== "dataset" &&
            ["geo", "pubchem", "pangaea", "icpsr", "gbif"].includes(
              result.source,
            ) && <DatasetMetaFields result={result} />}

          {/* 专利域：专利号 + IPC 分类 */}
          {domainId === "patent" && result.patentNumber && (
            <DomainMetaRow>
              <span className="font-[var(--font-mono)]">
                {result.patentNumber}
              </span>
              {Array.isArray(result.extra?.ipcClasses) &&
                result.extra.ipcClasses.length > 0 && (
                  <span>
                    IPC: {result.extra.ipcClasses.slice(0, 3).join(", ")}
                  </span>
                )}
            </DomainMetaRow>
          )}

          {/* 研究者域：h-index / 引用数 / works / 机构 */}
          {domainId === "researcher" && (
            <DomainMetaRow>
              {result.metrics?.hIndex != null && (
                <span>h-index: {result.metrics.hIndex}</span>
              )}
              {result.metrics?.citations != null && (
                <span>{result.metrics.citations} citations</span>
              )}
              {result.metrics?.works != null && (
                <span>{result.metrics.works} works</span>
              )}
              {Array.isArray(result.extra?.institutions) &&
                result.extra.institutions.length > 0 && (
                  <span>{result.extra.institutions[0]}</span>
                )}
            </DomainMetaRow>
          )}

          {/* 基金域：资助机构 / 金额 / 执行期 / 状态 / PI */}
          {domainId === "grant" && (
            <DomainMetaRow>
              {result.extra?.fundingAgency && (
                <span>{result.extra.fundingAgency}</span>
              )}
              {result.extra?.amountFormatted && (
                <span>{result.extra.amountFormatted}</span>
              )}
              {result.extra?.period && <span>{result.extra.period}</span>}
              {result.extra?.statusNormalized && (
                <span>({result.extra.statusNormalized})</span>
              )}
              {result.extra?.pi && <span>PI: {result.extra.pi}</span>}
            </DomainMetaRow>
          )}

          {/* 摘要 */}
          {result.snippet && (
            <p className="mt-[var(--space-1)] text-[length:var(--text-xs)] text-[color:var(--text-secondary)] line-clamp-2">
              {result.snippet}
            </p>
          )}
        </div>

        {/* 导入按钮：导入中 = Spinner + 「导入中…」，成功后禁用并显示「已导入」 */}
        <Button
          variant="outline"
          size="sm"
          loading={importing}
          loadingText={getString("domain-importing")}
          onClick={onImport}
          disabled={imported || result.inLibrary}
        >
          {imported
            ? getString("domain-imported")
            : getString("domain-import-btn")}
        </Button>
      </div>
    </div>
  );
}

/** 域卡元信息行（meta 字体 + 次级墨色 + 统一间距，文献卡 meta 行同制式）。 */
function DomainMetaRow({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="mt-[var(--space-1)] flex flex-wrap items-center gap-x-[var(--space-2)] gap-y-[var(--space-0-5)] [font:var(--ui-font-meta)] text-[color:var(--text-secondary)]">
      {children}
    </div>
  );
}
