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
 *   - date / citations order: client-side sort across the whole merged list
 *   - title order: 完整词组命中优先（标题含查询短语者排前），梯队内字典序
 *   - DOI comparison is case-insensitive with a https://doi.org/ prefix
 *     strip — sources disagree on DOI casing more often than one would hope
 *
 * @module react/components/Hub/search/mergeResults
 */

import type { SearchResult } from "./Semantic/types";
import type { ArticleResult } from "./LiteratureSearch/types";
import { articleSourcesOf } from "../../../../core/metadata/importExtras";

/** One entry of the merged result list. `sourceIndex` (articles only) is the
 *  item's index in the original literature response — callers must derive
 *  per-article state keys with it (getArticleKey(article, sourceIndex)) so
 *  selection / import maps stay consistent with useLiteratureSearch. */
export type MixedResult =
  | { kind: "library"; result: SearchResult }
  | { kind: "article"; article: ArticleResult; sourceIndex: number };

/** Display sort modes for the merged list. `citations` is client-side only
 *  (no source supports it uniformly server-side; 0 counts sort last). */
export type MixedSortBy = "relevance" | "date" | "title" | "citations";

/** Typed option list for the display-sort control（消费点免 cast，§5.4 单选）。
 *  标签键复用 semantic-sort-*（相关/日期/标题）与 lit-sort-cited（引用最多）。 */
export const DISPLAY_SORT_OPTIONS: ReadonlyArray<{
  value: MixedSortBy;
  labelKey: string;
}> = [
  { value: "relevance", labelKey: "semantic-sort-relevance" },
  { value: "date", labelKey: "semantic-sort-date" },
  { value: "title", labelKey: "semantic-sort-title" },
  { value: "citations", labelKey: "lit-sort-cited" },
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
 * Stable identity key for an external article（渐进检索的身份键）：
 * **只认 DOI**（归一化：剥 URL/doi: 前缀 + 小写）。无 DOI 返回 null——
 * 该条不参与跨条目合并、直接保留（2026-10-12 用户裁决：标题撞车的误判
 * 代价高于漏合并——同名不同文、预印本与正式版标题微差都会误并；标题只
 * 作勾选状态键，不作身份判定。与后端 deduplicateArticles 同口径）。
 */
export function externalArticleKey(a: { doi?: string | null }): string | null {
  const doi = normalizeDoi(a.doi);
  return doi ? `doi:${doi}` : null;
}

/** 字段级合并（2026-09-25 审计 P1-2）：同一作品跨源命中时后到源不再整条
 *  丢弃——被引取大、标识（issn/pmid/pmcid/oaUrl/pdfUrl）/摘要/期刊指标
 *  补空，首个到达者保住位置索引（selection/import key 稳定）。 */
function mergeEntry<T>(base: T, inc: T): T {
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  const incRec = inc as Record<string, unknown>;
  for (const k of Object.keys(incRec)) {
    if (k === "citationCount") {
      out[k] = Math.max(Number(out[k]) || 0, Number(incRec[k]) || 0);
      continue;
    }
    const b = (base as Record<string, unknown>)[k];
    const i = incRec[k];
    const empty = (v: unknown) => v === undefined || v === null || v === "";
    if (empty(b)) out[k] = i;
    // 非空保留首到值（title/authors/journal/source 等身份字段不随后到源漂移）
  }
  // 多源归属取并集（按源筛选的判定口径），保持首到顺序去重。无条件从两侧
  // 的 sources/source 重新聚合——逐源 RPC 下后端 sources 恒缺省，要合并的
  // 正是 source 单值；只认入参的 sources 键会漏掉全部跨源合并。
  const mergedSources = articleSourcesOf(base as never).slice();
  for (const s of articleSourcesOf(inc as never)) {
    if (!mergedSources.includes(s)) mergedSources.push(s);
  }
  if (mergedSources.length) out.sources = mergedSources;
  return out as T;
}

// 多源归属口径迁至 core/metadata/importExtras（导入写 Extra 共用同一判定），
// 原地转出保持既有 import 路径不变。
export { articleSourcesOf };

/**
 * Merge `incoming` external articles into `base`, merging fields of entries
 * already present（渐进检索的合并原语：每源 RPC 落地时调用一次，base=已上屏
 * 列表，incoming=该源新到的结果。追加式——不移除既有项；同 key 命中做字段
 * 合并（见 mergeEntry），selection/import 状态按 `getArticleKey(article,
 * index)` 的位置索引保持稳定）。
 */
export function mergeExternalArticles<
  T extends { doi?: string | null; title?: string | null },
>(base: T[], incoming: T[]): T[] {
  const indexOf = new Map<string, number>();
  const out = base.slice();
  out.forEach((a, idx) => {
    const k = externalArticleKey(a);
    if (k && !indexOf.has(k)) indexOf.set(k, idx);
  });
  for (const a of incoming) {
    const k = externalArticleKey(a);
    if (k) {
      const idx = indexOf.get(k);
      if (idx !== undefined) {
        out[idx] = mergeEntry(out[idx], a);
        continue;
      }
      indexOf.set(k, out.length);
    }
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
 *  external articles a plain year string. String() 防 TypeError：多数适配器
 *  的 year 是 number（crossref/openalex/arxiv/s2），Number 无 localeCompare
 *  （2026-09-25 审计 P0-4——「日期」排序曾让结果区整体崩溃）。 */
function resultYear(entry: MixedResult): string {
  if (entry.kind === "article") return String(entry.article.year ?? "");
  const m = (entry.result.dateAdded ?? "").match(/\d{4}/);
  return m ? m[0] : "";
}

function resultTitle(entry: MixedResult): string {
  return (
    (entry.kind === "article" ? entry.article.title : entry.result.title) ?? ""
  );
}

function resultCitations(entry: MixedResult): number {
  if (entry.kind !== "article") return 0;
  return Number(entry.article.citationCount) || 0;
}

/** 短语归一化：小写、非字母数字（标点/连字符/空白等）折叠为单个空格、
 *  去首尾空白。用于「完整词组命中」判定——查询 "HLA-HD" 归一为 "hla hd"，
 *  标题 "HLA-HD: a pipeline" 归一为 "hla hd a pipeline" 即命中；分隔符写法
 *  差异（连字符/空格/破折号）不影响判定，中日韩等非拉丁字母同样保留。 */
function normalizePhrase(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** 梯队号：标题含完整查询短语 → 0（第一梯队），否则 1。phrase 需已归一化；
 *  空短语（无 query 或查询纯符号）时全部返回 1，等价于不设优先级。 */
function phraseTier(entry: MixedResult, phrase: string): number {
  if (!phrase) return 1;
  return normalizePhrase(resultTitle(entry)).includes(phrase) ? 0 : 1;
}

/** Sort the merged list for display. `relevance` (default) keeps the merge
 *  order: library hits (similarity desc, as returned by the backend) first,
 *  then external articles in response order. `date` / `title` / `citations`
 *  sort the whole list client-side (date desc / title asc / citations desc,
 *  ties keep the previous order — Array.sort is stable per spec).
 *
 *  `title` 带可选 query 时先按完整词组命中分梯队（2026-10-22 用户报障修复）：
 *  标题含查询短语（分隔符不敏感）的条目排最前，其余随后，梯队内保持既有
 *  的大小写与本地化感知字典序。不传 query 时行为与历史实现逐字节一致。 */
export function sortMixedResults(
  merged: MixedResult[],
  sortBy: MixedSortBy,
  query?: string,
): MixedResult[] {
  if (sortBy === "relevance") return merged;
  const arr = [...merged];
  if (sortBy === "date") {
    arr.sort((a, b) => resultYear(b).localeCompare(resultYear(a)));
  } else if (sortBy === "citations") {
    arr.sort((a, b) => resultCitations(b) - resultCitations(a));
  } else {
    // 纯字典序会把 "-" 等标点开头的标题顶到最前（连字符的排序权重低于
    // 所有字母），完整词组命中（如 "HLA-HD: ..."）反而沉底——先分梯队
    // 再梯队内字典序，兑现「完整词组先、分词命中后」的展示语义。
    const phrase = normalizePhrase(query ?? "");
    arr.sort((a, b) => {
      const ta = phraseTier(a, phrase);
      const tb = phraseTier(b, phrase);
      if (ta !== tb) return ta - tb;
      return resultTitle(a).localeCompare(resultTitle(b));
    });
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
