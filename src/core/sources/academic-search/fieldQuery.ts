/**
 * fieldQuery — 高级检索的字段限定编译层（标题/摘要 → 各源原生查询语法）。
 *
 * 职责边界：把 SearchFilters 的 title/abstract/hasAbstract（加上年份/OA/
 * 综述等结构化条件）编译成单源的查询串或参数片段。有原生字段语法的源编译，
 * 没有的源由适配器降级（标题词作主查询，见 fallbackFieldQuery）。本模块
 * 只提供口径一致的纯函数，不发请求——单测直接覆盖。
 *
 * 各源方言速查（第一期接线的源）：
 * - Crossref：query.title 参数 + filter=has-abstract:true（摘要无搜索语法）。
 * - OpenAlex：filter=title.search:/abstract.search:/has_abstract:true/
 *   open_access.is_oa:true（bioRxiv/medRxiv 走同一后端）。
 * - arXiv：search_query 的 ti:""/abs:"" 前缀 + AND 连接 + submittedDate 区间
 *   （无字段时维持历史口径 all:<query>，不引号）。
 * - Europe PMC：TITLE:""/ABSTRACT:""/HAS_ABSTRACT:Y，AND 连接。
 * - PubMed：("…")[Title] / ("…")[tiab] / hasabstract[Filter]，AND 连接。
 * - GitHub：q 追加 in:title 限定符。
 * - Semantic Scholar/DOAJ/HAL/Zenodo/CORE：无字段语法——降级为标题词主查询。
 *
 * @module core/sources/academic-search/fieldQuery
 */

/** 字段输入规整：trim；空串归一为 undefined（调用方判空跳过）。 */
export function cleanFieldPhrase(
  v: string | undefined | null,
): string | undefined {
  const s = (v ?? "").trim();
  return s ? s : undefined;
}

/** 年份参数（"YYYY" 或 "YYYY-YYYY"）→ arXiv submittedDate 闭区间语法。 */
export function arxivSubmittedDateRange(year?: string): string | null {
  if (!year) return null;
  const range = year.match(/^(\d{4})\s*-\s*(\d{4})$/);
  if (range) {
    return `submittedDate:[${range[1]}01010000 TO ${range[2]}12312359]`;
  }
  const y = year.match(/^\d{4}$/);
  if (y) {
    return `submittedDate:[${y[0]}01010000 TO ${y[0]}12312359]`;
  }
  return null;
}

/**
 * arXiv search_query 组装。无字段条件时与历史口径逐字节一致（`all:<query>`
 * 不加引号，author 后缀嵌在 all: 内）——字段路径才引入 ti:/abs:/submittedDate。
 */
export function buildArxivSearchQuery(input: {
  query: string;
  author?: string;
  title?: string;
  abstract?: string;
  year?: string;
}): string {
  let base = input.query;
  if (input.author) base += ` au:${input.author}`;

  const title = cleanFieldPhrase(input.title);
  const abstract = cleanFieldPhrase(input.abstract);
  const hasFields = !!(title || abstract);
  const dateRange = arxivSubmittedDateRange(input.year);

  if (!hasFields && !dateRange) return `all:${base}`;

  const parts: string[] = [];
  if (base) parts.push(`all:${base}`);
  if (title) parts.push(`ti:"${title}"`);
  if (abstract) parts.push(`abs:"${abstract}"`);
  if (dateRange) parts.push(dateRange);
  return parts.join(" AND ");
}

/**
 * Europe PMC 查询组装：结构化条件统一 AND 到主查询上（括号包裹主查询，
 * 与历史 reviewOnly 行为同构——reviewOnly-only 时输出逐字节一致）。
 */
export function buildEuropePMCQuery(input: {
  query: string;
  title?: string;
  abstract?: string;
  hasAbstract?: boolean;
  reviewOnly?: boolean;
}): string {
  const title = cleanFieldPhrase(input.title);
  const abstract = cleanFieldPhrase(input.abstract);
  const clauses: string[] = [];
  if (input.reviewOnly) clauses.push("pub_type:Review");
  if (title) clauses.push(`TITLE:"${title}"`);
  if (abstract) clauses.push(`ABSTRACT:"${abstract}"`);
  if (input.hasAbstract) clauses.push("HAS_ABSTRACT:Y");
  if (clauses.length === 0) return input.query;
  return `(${input.query}) AND ${clauses.join(" AND ")}`;
}

/**
 * PubMed 检索词组装：标题用 [Title]、摘要用 [tiab]（title/abstract 合并
 * 字段，是 PubMed 对「摘要包含」的最近似表达）、有摘要用 hasabstract[Filter]
 * （NCBI 预设过滤器的标准写法）。历史 reviewOnly-only 输出逐字节一致。
 */
export function buildPubMedTerm(input: {
  query: string;
  title?: string;
  abstract?: string;
  hasAbstract?: boolean;
  reviewOnly?: boolean;
}): string {
  const title = cleanFieldPhrase(input.title);
  const abstract = cleanFieldPhrase(input.abstract);
  const clauses: string[] = [];
  if (input.reviewOnly) clauses.push("Review[ptyp]");
  if (title) clauses.push(`("${title}")[Title]`);
  if (abstract) clauses.push(`("${abstract}")[tiab]`);
  if (input.hasAbstract) clauses.push("hasabstract[Filter]");
  if (clauses.length === 0) return input.query;
  return `(${input.query}) AND ${clauses.join(" AND ")}`;
}

/**
 * OpenAlex filter 片段（字段限定 + 有摘要 + 服务端 OA）。返回值未经 URL
 * 编码——调用方沿用现有口径：值内空格/逗号由 encodeURIComponent 处理后
 * 再逗号连接。
 */
export function buildOpenAlexFieldFilterParts(input: {
  title?: string;
  abstract?: string;
  hasAbstract?: boolean;
  openAccessOnly?: boolean;
}): string[] {
  const title = cleanFieldPhrase(input.title);
  const abstract = cleanFieldPhrase(input.abstract);
  const parts: string[] = [];
  if (title) parts.push(`title.search:${encodeURIComponent(title)}`);
  if (abstract) parts.push(`abstract.search:${encodeURIComponent(abstract)}`);
  if (input.hasAbstract) parts.push("has_abstract:true");
  if (input.openAccessOnly) parts.push("open_access.is_oa:true");
  return parts;
}

/**
 * GitHub q 附加限定符：标题限定 → in:title。已有 created:/in: 等限定符
 * 时不做去重（用户手写语法原样透传）。
 */
export function githubQueryWithQualifiers(
  query: string,
  title?: string,
): string {
  const t = cleanFieldPhrase(title);
  return t ? `${query} in:title` : query;
}

/**
 * 无字段语法源的降级口径：标题限定退化为「标题词作主查询」——标题词是
 * 最强信号；摘要条件这类源无法表达，静默忽略（适配器注释说明）。
 */
export function fallbackFieldQuery(query: string, title?: string): string {
  const t = cleanFieldPhrase(title);
  return t ?? query;
}

/**
 * 结果内关键词过滤（纯前端，逐轮收窄）：多词 AND、大小写不敏感，
 * 匹配 标题/作者/期刊/摘要 四个字段的拼接文本。
 */
export function matchKeywordFilter(
  article: {
    title?: string;
    authors?: string;
    journal?: string;
    abstract?: string;
  },
  keyword: string,
): boolean {
  const words = keyword.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = [
    article.title,
    article.authors,
    article.journal,
    article.abstract,
  ]
    .map((v) => String(v ?? "").toLowerCase())
    .join("\n");
  return words.every((w) => hay.includes(w));
}
