/**
 * importExtras — 导入时写入 Zotero 条目 Extra 字段的多源聚合信息。
 *
 * 搜索结果是多源聚合卡（被引取最大、命中源并集、本地期刊富集），而导入
 * 按 DOI 重新取证、条目字段以翻译器为准——聚合信息此前只活在搜索结果里。
 * 本模块把它带进条目的 Extra 字段：Zotero 对 Extra 中「Key: Value」行有
 * 官方解析机制（Utilities.extractExtraFields），自定义键原样展示、不污染
 * 标准字段。宿主与前端共用（两侧 bundle 都从 src/ 构建）。
 *
 * 合并语义（mergeExtraLines）：读条目现有 Extra，移除本模块同键旧行、
 * 追加新行——重复导入不堆积重复行，用户手写的其他 Extra 内容原样保留。
 *
 * @module core/metadata/importExtras
 */

/** 条目上的来源归属口径（多源命中并集，缺省退化到 source 单值）。 */
export function articleSourcesOf(a: {
  sources?: string[];
  source?: string | null;
}): string[] {
  if (Array.isArray(a.sources) && a.sources.length) {
    return a.sources.filter(Boolean);
  }
  return a.source ? [a.source] : [];
}

/** Extra 行的稳定英文键（Zotero Extra 惯例：Key: Value）。 */
export const EXTRA_KEYS = {
  citations: "Citations",
  sources: "Sources",
  jif: "JIF",
  jcrQuartile: "JCR Quartile",
  cassQuartile: "CAS Quartile",
  warning: "Warning",
  stars: "Stars",
} as const;

/** 聚合字段的最小形状（ArticleResult 的相关子集）。 */
export interface ExtraSourceArticle {
  citationCount?: number;
  sources?: string[];
  source?: string;
  jif?: number;
  jcrQuartile?: string;
  cassQuartile?: number;
  cassIsTop?: boolean;
  warningLevel?: string;
  stars?: number;
}

/**
 * 从合并卡组装 Extra 字段表（前端导入入口用）。只产出有值的键——
 * 聚合缺省（如 GitHub 条目无被引）不写占位行。
 */
export function buildExtraFields(
  article: ExtraSourceArticle,
): Record<string, string> {
  const fields: Record<string, string> = {};
  const cites = Number(article.citationCount) || 0;
  if (cites > 0) fields[EXTRA_KEYS.citations] = String(cites);
  const sources = articleSourcesOf(article);
  if (sources.length) fields[EXTRA_KEYS.sources] = sources.join(", ");
  if (article.jif) fields[EXTRA_KEYS.jif] = String(article.jif);
  if (article.jcrQuartile) {
    fields[EXTRA_KEYS.jcrQuartile] = article.jcrQuartile;
  }
  if (article.cassQuartile) {
    const top = article.cassIsTop ? " (Top)" : "";
    fields[EXTRA_KEYS.cassQuartile] = `Q${article.cassQuartile}${top}`;
  }
  if (article.warningLevel) {
    fields[EXTRA_KEYS.warning] = String(article.warningLevel);
  }
  if (article.stars) fields[EXTRA_KEYS.stars] = String(article.stars);
  return fields;
}

/**
 * 把字段表合并进条目现有 Extra 文本（宿主写入前用）：同键旧行整体替换、
 * 其余行（含用户手写内容）原样保留；fields 为空时原样返回。
 */
export function mergeExtraLines(
  existing: string | undefined | null,
  fields: Record<string, string>,
): string {
  const keys = new Set(Object.keys(fields));
  const kept = (existing ?? "").split("\n").filter((line) => {
    const t = line.trim();
    if (!t) return true;
    const colon = t.indexOf(":");
    if (colon <= 0) return true;
    return !keys.has(t.slice(0, colon).trim());
  });

  const newLines = Object.entries(fields).map(([k, v]) => `${k}: ${v}`);
  return [...kept, ...newLines].join("\n").replace(/^\n+|\n+$/g, "");
}
