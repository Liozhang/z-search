/**
 * Shared types, helpers, and constants for the Semantic search UI.
 *
 * Used by UnifiedSearchPanel and its presentational children (ResultItem,
 * DuplicateGroupItem). The former 3-tab `TabId` / `TAB_OPTIONS` were removed
 * when the three tabs merged into UnifiedSearchPanel's mode switcher.
 *
 * @module react/components/Hub/search/Semantic/types
 */

export interface SearchResult {
  itemID: number;
  /** Cosine similarity — absent for BM25-only hits (retrieval='bm25' /
   *  'hybrid' without a vector score); consumers must guard (ResultItem
   *  hides the score badge in that case). */
  similarity?: number;
  title?: string;
  type?: string;
  /** Zotero item dateAdded (ISO-ish string), for date sorting. */
  dateAdded?: string;
  /** Item DOI — used by the Hub merged search to dedup external hits
   *  against library hits (backend enrichment, see SemanticSearch). */
  doi?: string;
  /** Full-text preview: first ~200 chars of the highest-scoring chunk.
   *  Only present for full-text (useFullText=true) searches. */
  snippet?: string;
  /** Section name (e.g. "Methods") of the highest-scoring chunk.
   *  Only present for full-text searches. */
  sectionName?: string;
  /** Section category key (e.g. "method", "intro"). Used for filtering
   *  and badge display. Only present for full-text searches. */
  sectionCategory?: string;
  /** F-26/R4-04：hybrid 检索的向量腿不可用时命中实为 BM25-only。RPC 原始
   *  JSON 早带此标记（09-11 修复），但 UI 层零渲染——本字段是让最后一跳
   *  可用的类型入口。省略 = 双腿齐全的正常混合结果。 */
  degraded?: "vector-leg-unavailable";
  /** R4-21：rerank 已开启但排序未生效——结果仍是原序。 */
  rerankUnavailable?: boolean;
}

export interface DuplicateGroup {
  itemID: number;
  duplicateIDs: number[];
  title: string;
  confidence: number;
}

export interface ModelInfo {
  name: string;
  dimension: number;
  hasStaleChunks: boolean;
  /** "local" | "api"——本地模式才有模型下载通道（downloaded/endpoint）。 */
  mode: string;
  /** 本地模型必需文件是否齐全；api 模式为 null（无下载通道）。 */
  downloaded: boolean | null;
  /** 同步求值的当前模型源（用户镜像覆盖 > 区域默认）；自动检测实况以
   *  semantic.detectEndpoint 的返回为准。 */
  endpoint: string;
  /** 用户是否显式配置了镜像覆盖（true 时下载失败不自动换源）。 */
  mirrorOverride: boolean;
}

/** semantic.detectEndpoint 的返回：端点自动检测实况（两端点里可达且最快的
 *  一个；全部不可达为 null）。 */
export interface EndpointProbeInfo {
  endpoint: string;
  latencyMs: number | null;
  status?: number;
  error?: string;
}

export const SECTION_OPTIONS: {
  value: string | undefined;
  labelKey: string;
}[] = [
  { value: undefined, labelKey: "semantic-section-any" },
  { value: "introduction", labelKey: "semantic-section-intro" },
  { value: "method", labelKey: "semantic-section-method" },
  { value: "results", labelKey: "common-results" },
  { value: "discussion", labelKey: "semantic-section-discussion" },
  { value: "conclusion", labelKey: "semantic-section-conclusion" },
];
