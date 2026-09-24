/**
 * DOI 归一（P1-B 从 ScholarlyGraphBuilder 提升为中立 util，语义逐字保留）。
 *
 * evidence 引擎（ensureWorkNodes）与 citation 层（ScholarlyGraphBuilder）
 * 都要按同一规则对齐 DOI 作 work 合并键——引擎不得反向依赖 citation 层，
 * 故落在两侧都能安全 import 的 utils。
 *
 * @module core/utils/doi
 */

/**
 * 归一 DOI：去 url 前缀/`doi:` 前缀/大小写/空白 —— 引擎与条目两侧的合并键。
 * 空串返回 null；不校验 "10." 前缀（宽松语义与原实现一致，严格门由
 * enrichment 入口自行加）。
 */
export function normalizeDoi(doi: unknown): string | null {
  const raw = String(doi ?? "").trim();
  if (!raw) return null;
  const stripped = raw
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .toLowerCase();
  return stripped || null;
}
