/**
 * mergeResults — pure merge / dedup / sort logic shared by the Hub search
 * page's two tabs (2026-09-23 双 tab 化后按腿单传入：网络 tab 传空库内腿、
 * 本地 tab 传空外部腿，同一套排序/开窗/计数工具服务两个 tab).
 *
 * Kept free of React so it is unit-testable and reusable by the page. Rules:
 *
 *   - dedup: an external article whose DOI matches a library hit's DOI is
 *     dropped (the library card represents the work; cross-source dedup
 *     within the external set is already done by the backend)
 *   - relevance order (default): library hits (similarity desc) →
 *     external articles in backend response order
 *   - date / title order: client-side sort across the whole merged list
 *   - DOI comparison is case-insensitive with a https://doi.org/ prefix
 *     strip — sources disagree on DOI casing more often than one would hope
 *
 * @module react/components/Hub/search/mergeResults
 */

import type { SearchResult } from "./Semantic/types";
import type { ArticleResult } from "./LiteratureSearch/types";

/** One entry of the merged result list. `sourceIndex` (articles only) is the
 *  item's index in the original literature response — callers must derive
 *  per-article state keys with it (getArticleKey(article, sourceIndex)) so
 *  selection / import maps stay consistent with useLiteratureSearch. */
export type MixedResult =
  | { kind: "library"; result: SearchResult }
  | { kind: "article"; article: ArticleResult; sourceIndex: number };

/** Display sort modes for the merged list. */
export type MixedSortBy = "relevance" | "date" | "title";

/** Typed option list for the display-sort control（消费点免 cast，§5.4 单选）。
 *  标签键复用 semantic-sort-*：相关度/日期/标题。 */
export const DISPLAY_SORT_OPTIONS: ReadonlyArray<{
  value: MixedSortBy;
  labelKey: string;
}> = [
  { value: "relevance", labelKey: "semantic-sort-relevance" },
  { value: "date", labelKey: "semantic-sort-date" },
  { value: "title", labelKey: "semantic-sort-title" },
];

/** Normalize a DOI string for comparison: trim, lowercase, strip doi.org URL
 *  forms（含 `http(s)://` 裸/带 `dx.` 子域，以及裸 `doi.org/`）与 `doi:` 前缀
 *  （前缀后的空白一并剥）。Returns undefined for empty / URL-but-no-suffix
 *  input. */
export function normalizeDoi(doi?: string | null): string | undefined {
  if (!doi) return undefined;
  const s = doi
    .trim()
    .replace(/^(https?:\/\/)?(dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .toLowerCase();
  return s || undefined;
}

/**
 * Stable identity key for an external article（2026-09-23 渐进检索）：
 * DOI 归一优先，无 DOI 退化为标题（非字母数字剥除，≥10 字符才可用——
 * 与后端 deduplicateArticles 同口径）。Returns null when neither is usable
 * （该条不参与去重，直接保留）。
 */
export function externalArticleKey(a: {
  doi?: string | null;
  title?: string | null;
}): string | null {
  const doi = normalizeDoi(a.doi);
  if (doi) return `doi:${doi}`;
  const t = (a.title ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return t.length >= 10 ? `title:${t}` : null;
}

/**
 * Merge `incoming` external articles into `base`, dropping entries already
 * present（渐进检索的合并原语：每源 RPC 落地时调用一次，base=已上屏列表，
 * incoming=该源新到的结果。追加式——不移除、不重排既有项，selection/import
 * 状态按 `getArticleKey(article, index)` 的位置索引保持稳定）。Only-appends:
 * same-key items in `incoming` collapse to the first occurrence.
 */
export function mergeExternalArticles<
  T extends { doi?: string | null; title?: string | null },
>(base: T[], incoming: T[]): T[] {
  const seen = new Set<string>();
  for (const a of base) {
    const k = externalArticleKey(a);
    if (k) seen.add(k);
  }
  const out = base.slice();
  for (const a of incoming) {
    const k = externalArticleKey(a);
    if (k && seen.has(k)) continue;
    if (k) seen.add(k);
    out.push(a);
  }
  return out;
}

/** Merge library hits and external articles into one list, dropping external
 *  entries already represented by a library hit (DOI match). */
export function mergeResults(
  library: SearchResult[],
  articles: ArticleResult[],
): MixedResult[] {
  const libraryDois = new Set<string>();
  for (const r of library) {
    const doi = normalizeDoi(r.doi);
    if (doi) libraryDois.add(doi);
  }

  const merged: MixedResult[] = library.map((result) => ({
    kind: "library" as const,
    result,
  }));

  articles.forEach((article, sourceIndex) => {
    const doi = normalizeDoi(article.doi);
    if (doi && libraryDois.has(doi)) return; // already in library — drop
    merged.push({ kind: "article", article, sourceIndex });
  });

  return merged;
}

/** Year-of-record for sorting: library items expose dateAdded (ISO-ish),
 *  external articles a plain year string. */
function resultYear(entry: MixedResult): string {
  if (entry.kind === "article") return entry.article.year ?? "";
  const m = (entry.result.dateAdded ?? "").match(/\d{4}/);
  return m ? m[0] : "";
}

function resultTitle(entry: MixedResult): string {
  return (
    (entry.kind === "article" ? entry.article.title : entry.result.title) ?? ""
  );
}

/** Sort the merged list for display. `relevance` (default) keeps the merge
 *  order: library hits (similarity desc, as returned by the backend) first,
 *  then external articles in response order. `date` / `title` sort the whole
 *  list client-side (date desc / title asc). */
export function sortMixedResults(
  merged: MixedResult[],
  sortBy: MixedSortBy,
): MixedResult[] {
  if (sortBy === "relevance") return merged;
  const arr = [...merged];
  if (sortBy === "date") {
    arr.sort((a, b) => resultYear(b).localeCompare(resultYear(a)));
  } else {
    arr.sort((a, b) => resultTitle(a).localeCompare(resultTitle(b)));
  }
  return arr;
}

/** Convenience: count of each kind in the merged list (drives the count row). */
export function countMixed(merged: MixedResult[]): {
  library: number;
  article: number;
} {
  let library = 0;
  for (const e of merged) {
    if (e.kind === "library") library++;
  }
  return { library, article: merged.length - library };
}
