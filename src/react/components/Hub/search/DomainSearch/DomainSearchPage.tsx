/**
 * DomainSearchPage — 学术子域搜索页（专利/数据集）。
 *
 * 输入框 + 搜索按钮 + 结果列表。结果卡显示域特定字段：
 *  - 专利：专利号、申请人、IPC/CPC、法律状态
 *  - 数据集：许可证、任务标签、下载量
 *
 * 复用 SearchInput（ui/SearchInput）与现有卡片样式。
 *
 * @module react/components/Hub/search/DomainSearch/DomainSearchPage
 */

import React, { useMemo } from "react";
import { getString } from "../../../../utils/locale";
import { useDomainSearch } from "./useDomainSearch";
import { SearchInput } from "@/components/ui/SearchInput";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { ErrorState } from "@/components/ui/ErrorState";
import { toast } from "@/components/ui/toast";
import { button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { DomainId, DomainResult, DATASET_DISCIPLINES } from "./types";

export function DomainSearchPage({
  domainId,
  isActive = true,
}: {
  domainId: DomainId;
  isActive?: boolean;
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
    () =>
      DATASET_DISCIPLINES.find((d) => d.id === filters.discipline) ?? null,
    [filters.discipline],
  );

  return (
    <div className="domain-search-page flex flex-col h-full">
      {/* 搜索输入行 */}
      <div className="shrink-0 flex gap-2 p-4">
        <SearchInput
          value={query}
          onChange={setQuery}
          onSearch={() => handleSearch()}
          onClear={handleClear}
          placeholder={getString(placeholderKey)}
          isSearching={isSearching}
          className="flex-1"
        />
      </div>

      {/* 数据集域：学科选择器（先选学科，再在该学科的源中检索） */}
      {domainId === "dataset" && (
        <div className="shrink-0 px-4 pb-2">
          <div className="flex flex-wrap gap-1 items-center">
            <span className="text-xs text-muted-foreground">
              {getString("domain-discipline-label")}
            </span>
            <ToggleGroup
              multiple={false}
              className="flex-wrap"
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
            >
              <ToggleGroupItem value="all" className="text-xs px-2 py-1">
                {getString("domain-discipline-all")}
              </ToggleGroupItem>
              {DATASET_DISCIPLINES.map((d) => (
                <ToggleGroupItem
                  key={d.id}
                  value={d.id}
                  className="text-xs px-2 py-1"
                >
                  {getString(d.labelKey)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          {/* 高级查询字段（根据当前学科的能力渲染） */}
          {activeDiscipline && activeDiscipline.filters.length > 0 && (
            <div className="flex flex-wrap gap-2 border-t" style={{ marginTop: "0.5rem", paddingTop: "0.5rem" }}>
              {activeDiscipline.filters.map((f) => (
                <div key={f.key} className="flex items-center gap-1">
                  <label className="text-xs text-muted-foreground">
                    {getString(f.labelKey)}
                  </label>
                  {f.type === "year-range" ? (
                    <input
                      type="text"
                      className="text-xs border rounded px-1 py-0.5"
                      style={{ width: "6rem" }}
                      placeholder="2020-2024"
                      value={filters.year ?? ""}
                      onChange={(e) =>
                        setFilters({ ...filters, year: e.target.value || undefined })
                      }
                    />
                  ) : f.type === "select" ? (
                    <select
                      className="text-xs border rounded px-1 py-0.5"
                      value={filters[f.key] ?? ""}
                      onChange={(e) =>
                        setFilters({
                          ...filters,
                          [f.key]: e.target.value || undefined,
                        })
                      }
                    >
                      <option value="">—</option>
                      {(f.options ?? []).map((o) => (
                        <option key={o.value} value={o.value}>
                          {getString(o.labelKey)}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 失败源提示 */}
      {metadata && metadata.failedSources.length > 0 && (
        <div className="shrink-0 px-4 pb-2 text-sm text-muted-foreground">
          {getString("domain-sources-failed", {
            args: { count: metadata.failedSources.length },
          })}
          : {metadata.failedSources.join(", ")}
        </div>
      )}

      {/* 结果区 */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {isSearching && <LoadingState />}

        {searchError && !isSearching && (
          <ErrorState message={searchError} onRetry={() => handleSearch()} />
        )}

        {!isSearching && !searchError && searchPerformed && results.length === 0 && (
          <EmptyState
            title={getString("domain-no-results")}
            description={getString("domain-no-results-hint")}
          />
        )}

        {!isSearching && !searchError && results.length > 0 && (
          <>
            {/* 批量操作栏 */}
            <div className="flex items-center gap-2 py-2 border-b mb-2">
              <span className="text-sm text-muted-foreground">
                {getString("domain-result-count", {
                  args: { count: results.length },
                })}
              </span>
              {selectedIds.size > 0 && (
                <>
                  <button
                    className={button("sm", "primary")}
                    onClick={handleBatchImport}
                    disabled={importingIds.size > 0}
                  >
                    {getString("domain-import-selected", {
                      args: { count: selectedIds.size },
                    })}
                  </button>
                  <button
                    className={button("sm", "ghost")}
                    onClick={() => selectAll()}
                  >
                    {getString("domain-select-all")}
                  </button>
                </>
              )}
            </div>

            {/* 结果列表 */}
            <div className="space-y-2">
              {results.map((r) => (
                <DomainResultCard
                  key={r.dedupKey}
                  result={r}
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

/** 域结果卡片。 */
function DomainResultCard({
  result,
  domainId,
  selected,
  importing,
  importResult,
  onToggleSelect,
  onImport,
}: {
  result: DomainResult;
  domainId: DomainId;
  selected: boolean;
  importing: boolean;
  importResult: any;
  onToggleSelect: () => void;
  onImport: () => void;
}): React.ReactElement {
  const imported = importResult?.imported === true;

  return (
    <div className="domain-result-card border rounded-lg p-3 hover:bg-muted/50 transition-colors">
      <div className="flex items-start gap-3">
        {/* 复选框 */}
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          disabled={result.inLibrary || imported}
          className="mt-1"
        />

        {/* 内容 */}
        <div className="flex-1 min-w-0">
          <a
            href={result.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-sm hover:underline line-clamp-2"
          >
            {result.title}
          </a>

          {/* 元数据行 */}
          <div className="flex flex-wrap gap-2 mt-1 text-xs text-muted-foreground">
            {result.year && <span>{result.year}</span>}
            <span className="px-1.5 py-0.5 bg-muted rounded text-xs">
              {result.source}
            </span>
            {result.inLibrary && (
              <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-xs">
                {getString("domain-in-library")}
              </span>
            )}
            {imported && (
              <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-xs">
                {getString("domain-imported")}
              </span>
            )}
          </div>

          {/* 域特定字段 */}
          {domainId === "patent" && result.patentNumber && (
            <div className="mt-1 text-xs text-muted-foreground">
              <span className="font-mono">{result.patentNumber}</span>
              {Array.isArray(result.extra?.ipcClasses) &&
                result.extra.ipcClasses.length > 0 && (
                  <span className="ml-2">
                    IPC: {result.extra.ipcClasses.slice(0, 3).join(", ")}
                  </span>
                )}
            </div>
          )}
          {domainId === "dataset" && result.extra?.license && (
            <div className="mt-1 text-xs text-muted-foreground">
              License: {result.extra.license}
              {Array.isArray(result.extra?.taskTags) &&
                result.extra.taskTags.length > 0 && (
                  <span className="ml-2">
                    {result.extra.taskTags.join(", ")}
                  </span>
                )}
            </div>
          )}
          {domainId === "researcher" && (
            <div className="mt-1 text-xs text-muted-foreground">
              {result.metrics?.hIndex != null && (
                <span>h-index: {result.metrics.hIndex}</span>
              )}
              {result.metrics?.citations != null && (
                <span className="ml-2">
                  {result.metrics.citations} citations
                </span>
              )}
              {result.metrics?.works != null && (
                <span className="ml-2">{result.metrics.works} works</span>
              )}
              {Array.isArray(result.extra?.institutions) &&
                result.extra.institutions.length > 0 && (
                  <span className="ml-2">
                    {result.extra.institutions[0]}
                  </span>
                )}
            </div>
          )}
          {domainId === "grant" && (
            <div className="mt-1 text-xs text-muted-foreground">
              {result.extra?.fundingAgency && (
                <span>{result.extra.fundingAgency}</span>
              )}
              {result.extra?.amountFormatted && (
                <span className="ml-2">{result.extra.amountFormatted}</span>
              )}
              {result.extra?.period && (
                <span className="ml-2">{result.extra.period}</span>
              )}
              {result.extra?.statusNormalized && (
                <span className="ml-2">({result.extra.statusNormalized})</span>
              )}
              {result.extra?.pi && (
                <span className="ml-2">PI: {result.extra.pi}</span>
              )}
            </div>
          )}

          {/* 摘要 */}
          {result.snippet && (
            <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
              {result.snippet}
            </p>
          )}
        </div>

        {/* 导入按钮 */}
        <button
          className={button("sm", "outline")}
          onClick={onImport}
          disabled={importing || imported || result.inLibrary}
        >
          {importing
            ? getString("domain-importing")
            : imported
              ? getString("domain-imported")
              : getString("domain-import-btn")}
        </button>
      </div>
    </div>
  );
}
