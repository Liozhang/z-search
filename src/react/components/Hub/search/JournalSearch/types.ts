/**
 * Shared types + helpers for the Journal Search dashboard.
 *
 * Re-exports the bridge types from src/types/journalSearch (shared between
 * React iframe and Zotero main-script bridge). Adds UI-only helpers.
 *
 * @module react/components/Hub/search/JournalSearch/types
 */

export type {
  JournalDataSource,
  JournalMinorCategory,
  JournalMetric,
  JournalListItem,
  JournalSearchMode,
  JournalSortBy,
  JournalSearchPayload,
  JournalSearchResult,
} from "../../../../../types/journalSearch";

import type {
  JournalSearchMode,
  JournalSortBy,
} from "../../../../../types/journalSearch";

// E3（拍板 #11，2026-09-04）：library 模式迁 统计>文献计量>期刊列表，
// 期刊页 3→2。JournalSearchMode 联合保留（后端 journal.search 仍支持，
// 统计页 JournalLibraryView 经同一 RPC 消费）。
// 2026-10-09 用户裁决：两种模式按匹配策略命名——模糊搜索（服务侧 id 仍为
// 'discover'，返回候选列表）与精确搜索（服务侧 id 仍为 'metric'，直达单刊
// 指标卡）；按领域/按刊名的旧叫法退役。
export const MODE_OPTIONS: { id: JournalSearchMode; labelKey: string }[] = [
  { id: "discover", labelKey: "journal-mode-fuzzy" },
  { id: "metric", labelKey: "journal-mode-exact" },
];

export const DISCOVER_SORT_OPTIONS: {
  value: JournalSortBy;
  labelKey: string;
}[] = [
  { value: "relevance", labelKey: "journal-sort-relevance" },
  { value: "jif", labelKey: "journal-sort-jif" },
  { value: "works", labelKey: "journal-sort-works" },
  // OpenAlex 已下线 h5_index，排序键改走 summary_stats.h_index。
  { value: "hindex", labelKey: "journal-sort-hindex" },
];

export const LIBRARY_SORT_OPTIONS: {
  value: JournalSortBy;
  labelKey: string;
}[] = [
  { value: "library", labelKey: "journal-sort-library" },
  { value: "jif", labelKey: "journal-sort-jif" },
];

/**
 * Normalize a quartile value to a numeric 1-4 (or undefined).
 * Accepts numeric CASS quartile (1-4) or JCR quartile string ("Q1".."Q4").
 */
export function normalizeQuartile(
  quartile: number | string | undefined | null,
): number | undefined {
  if (quartile == null || quartile === "") return undefined;
  const q =
    typeof quartile === "number"
      ? quartile
      : parseInt(String(quartile).replace(/[^0-9]/g, ""), 10);
  return q >= 1 && q <= 4 ? q : undefined;
}

/**
 * Quartile badge color. Accepts a numeric CASS quartile (1-4) or a JCR
 * quartile string ("Q1".."Q4"). Token usage mirrors getSimilarityColor.
 *
 * @deprecated Use `data-quartile` attr on the element + CSS `[data-quartile="N"]`
 *   rules instead of inline color. Retained for any non-CSS consumers.
 */
export function getQuartileColor(
  quartile: number | string | undefined | null,
): string {
  const q = normalizeQuartile(quartile);
  if (q === 1) return "var(--signal-green)";
  if (q === 2) return "var(--signal-teal)";
  if (q === 3) return "var(--signal-yellow)";
  if (q === 4) return "var(--signal-orange)";
  return "var(--text-secondary)";
}

/** Format a quartile value for display: numeric 1 → "Q1", "Q1" → "Q1". */
export function formatQuartile(
  quartile: number | string | undefined | null,
): string {
  if (quartile == null || quartile === "") return "";
  if (typeof quartile === "string") return quartile.toUpperCase();
  return `Q${quartile}`;
}
