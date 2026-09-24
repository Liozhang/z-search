/**
 * FullTextResolver — 搜索结果的全文解析（PMC 开放获取优先，网页兜底）。
 *
 * 搜索源（PubMed/OpenAlex/Europe PMC 等）的原始返回只到题录级：PubMed 的
 * `url` 是 SPA 摘要页（静态抓取抓到的是 JS 空壳）、Europe PMC 的 `oaUrl`
 * 是 PDF 直链（HTTP 抓不得），导致 SearchPipeline 的 fullText 长期为空。
 * 本模块按策略补齐：
 *
 *   structured — 结构化全文 XML（优先级最高，文本最干净）：
 *       PMC 开放获取文章的 JATS XML（NCBI E-utilities `db=pmc`，
 *       DOI→PMCID/PMID→PMCID 反查由 StructuredFullTextClient 承担，
 *       带 AICache 正/负缓存）；
 *       OpenAlex GROBID TEI 兜底（api_key 门控，未配置自动跳过）。
 *       解析走 TeiSectionParser（与库内索引同一解析器，章节边界精确）。
 *
 *   html — 开放获取网页正文（web-content-fetcher 静态抓取 + 文本密度
 *       提取）。PMC 文章页是服务端渲染，含完整正文；PDF 直链与 PubMed
 *       摘要页过滤掉，免无用请求。
 *
 * 两种调用场景：
 *   - 单篇按需（Hub「全文」按钮 / agent `fetch-paper-fulltext` 工具）：
 *     默认 structured-first——拿到的是无导航噪声的章节化正文。
 *   - 流水线批量（SearchPipeline）：html-first——已有 OA 网页可用的文章
 *     维持原有单次请求开销，只剩无 HTML 可用的才付 XML 往返成本。
 *
 * @module core/search/FullTextResolver
 */

import { fetchStructuredXmlForArticle } from "../pdf/StructuredFullTextClient";
import { parseTeiOrJats } from "./TeiSectionParser";
import { fetchFullText } from "./scoring/web-content-fetcher";
import { safeDebug } from "../../utils/logger";

/** 全文来源：PMC JATS / OpenAlex GROBID / 开放获取网页。 */
export type FullTextSource = "pmc-jats" | "openalex-grobid" | "html";

/** 解析策略：结构化 XML 优先 / 网页正文优先。 */
export type FullTextStrategy = "structured-first" | "html-first";

export interface ResolvedFullText {
  /** 全文文本（结构化路径带 `## 章节名` 分节标记）。 */
  text: string;
  source: FullTextSource;
  wordCount: number;
  /** 原文超过 maxChars 被截断。 */
  truncated: boolean;
}

/** 解析所需的文章标识（搜索源返回字段的超集）。 */
export interface FullTextArticleRef {
  doi?: string;
  pmid?: string;
  pmcid?: string;
  /** 出版商/仓库落地页（HTML 兜底候选）。 */
  url?: string;
  /** 开放获取全文页（HTML 兜底候选，优先于 url）。 */
  oaUrl?: string;
}

export interface ResolveOptions {
  /** 默认 structured-first；流水线批量传 html-first（见模块头）。 */
  strategy?: FullTextStrategy;
  /** 截断上限，默认 60_000（与 web-content-fetcher 的历史上限同档）。 */
  maxChars?: number;
}

const DEFAULT_MAX_CHARS = 60_000;

/**
 * HTML 兜底候选过滤：非 http、PDF 直链、PubMed 摘要页（SPA，抓到也是
 * 空壳）一律跳过。
 */
export function htmlCandidate(url?: string | null): string | null {
  if (!url || typeof url !== "string") return null;
  if (!/^https?:\/\//i.test(url)) return null;
  if (/\.pdf(?:$|[?#])/i.test(url)) return null;
  if (/^https?:\/\/(?:www\.)?pubmed\.ncbi\.nlm\.nih\.gov\//i.test(url)) {
    return null;
  }
  return url;
}

/** JATS/TEI XML → 章节化纯文本。节名去重后作为 `## 节名` 头。 */
export function xmlToText(xml: string): string | null {
  // 质量门：出版商禁止 XML 分发的文章，PMC 只回 front-matter + 摘要（无
  // <body>/<sec>）。此时若把摘要当全文返回，既误导用户又阻断 html 兜底
  // （PMC 文章页仍可静态抓到全文）——判 null 交给下一策略。
  if (/does not allow downloading/i.test(xml)) return null;
  if (!/<body[\s>]/i.test(xml)) return null;
  if (!/<(?:sec|div)[\s>]/i.test(xml)) return null;

  const parsed = parseTeiOrJats(xml);
  if (!parsed || parsed.chunks.length === 0) return null;

  const parts: string[] = [];
  let currentName: string | null = null;
  for (const chunk of parsed.chunks) {
    const name = (chunk.sectionName || "").trim();
    if (name !== currentName) {
      if (name) parts.push(`## ${name}`);
      currentName = name;
    }
    const text = (chunk.chunkText || "").trim();
    if (text) parts.push(text);
  }

  const joined = parts.join("\n\n").trim();
  return joined.length >= 100 ? joined : null;
}

function finalize(
  text: string,
  source: FullTextSource,
  maxChars: number,
): ResolvedFullText {
  const truncated = text.length > maxChars;
  const finalText = truncated ? text.slice(0, maxChars) : text;
  return {
    text: finalText,
    source,
    wordCount: finalText.split(/\s+/).filter(Boolean).length,
    truncated,
  };
}

async function resolveStructured(
  article: FullTextArticleRef,
  maxChars: number,
): Promise<ResolvedFullText | null> {
  try {
    const result = await fetchStructuredXmlForArticle(article);
    if (!result) return null;
    const text = xmlToText(result.xml);
    if (!text) return null;
    return finalize(text, result.source, maxChars);
  } catch (e) {
    safeDebug("[z-search] FullTextResolver: structured path failed: " + e);
    return null;
  }
}

async function resolveHtml(
  article: FullTextArticleRef,
  maxChars: number,
): Promise<ResolvedFullText | null> {
  const candidates = [htmlCandidate(article.oaUrl), htmlCandidate(article.url)];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const text = await fetchFullText(candidate);
      if (text && text.length >= 100) {
        return finalize(text, "html", maxChars);
      }
    } catch (e) {
      safeDebug(
        "[z-search] FullTextResolver: html path failed for " +
          candidate +
          ": " +
          e,
      );
    }
  }
  return null;
}

/**
 * 解析单篇文章的全文。任一策略拿到 ≥100 字符的正文即返回，全部失败返回 null
 * （不抛——调用方（UI/agent/流水线）各自有失败呈现）。
 */
export async function resolveArticleFullText(
  article: FullTextArticleRef,
  opts: ResolveOptions = {},
): Promise<ResolvedFullText | null> {
  const strategy = opts.strategy ?? "structured-first";
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;

  const structured = () => resolveStructured(article, maxChars);
  const html = () => resolveHtml(article, maxChars);

  return strategy === "structured-first"
    ? ((await structured()) ?? (await html()))
    : ((await html()) ?? (await structured()));
}
