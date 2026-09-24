/**
 * Shared types for Literature Search — imported by both:
 *   - React iframe side (src/react/components/Hub/search/LiteratureSearch/types.ts)
 *   - Zotero main-script bridge (src/ui/literature-search/LiteratureSearchWindowBridge.ts)
 *
 * Lives under src/types/ so it is reachable from both tsconfig scopes.
 *
 * @module types/literatureSearch
 */

export interface ArticleResult {
  title: string;
  authors: string;
  journal: string;
  year: string;
  doi: string;
  issn?: string;
  citationCount?: number;
  pdfUrl?: string;
  isOpenAccess: boolean;
  abstract?: string;
  source: string;
  /** PubMed/Europe PMC 源的 PMID——全文解析的 PMID→PMCID 反查入口。 */
  pmid?: string;
  /** PMC 编号（开放获取文章才有）——efetch db=pmc 直取，省 ID Converter 往返。 */
  pmcid?: string;
  /** 开放获取全文页（PMC 文章页等，服务端渲染含正文）——HTML 兜底候选。 */
  oaUrl?: string;
  // 期刊指标（来自内置 JCR/CASS/Warning DB，匹配失败则全 undefined，UI 静默不显示）
  jif?: number; // 影响因子
  jcrQuartile?: string; // JCR Q1-Q4
  cassQuartile?: number; // 中科院大类 1-4
  cassCategory?: string; // 中科院大类名
  cassIsTop?: boolean; // 顶刊
  warningLevel?: string; // 命中预警时的等级；前端仅作 truthy 信号，文案走 lit-warning
  /** 命中 Beall's 掠夺性期刊名单。仅期刊表精确名匹配才置位——模糊层（缩写/
   *  关键词重叠）与出版社级命中不足以对单条检索结果作断言。前端仅作 truthy
   *  信号，文案走 journal-predatory-label，tooltip 披露名单截止时间。 */
  beallsHit?: { category: "standalone" | "hijacked" };
}

/** literature.fetchFulltext 的逐篇回执。 */
export interface FulltextResult {
  status: "loading" | "success" | "error";
  text?: string;
  source?: string;
  wordCount?: number;
  truncated?: boolean;
  error?: string;
}

export interface ImportResult {
  success: boolean;
  itemId?: number;
  title: string;
  error?: string;
  imported: boolean;
}
