/**
 * identifierQuery — 标识符形态查询的识别与精确反查。
 *
 * 立法背景（2026-11-13 用户实测 + 线上接口验证）：DOI 整串进入关键词
 * 检索链路后，上游按分词相关度匹配——Crossref 的 query= 检索对
 * 10.1038/s41586-021-03819-2 实测返回 666 万条，前列是编号含 03819
 * 碎片即命中的书名章节；OpenAlex 的 search= 是标题/摘要/全文的分词
 * 或匹配，实测 14896 篇。标识符不是关键词，必须分流到各源的精确反查
 * 端点（Crossref /works/{doi}、arXiv id_list、PubMed UID）。
 *
 * 匹配口径：整串（去首尾空白与句末标点后）完整构成一个标识符才分流。
 * "10.1038/xxx deep learning" 这类混合串仍走普通关键词检索。
 *
 * PMID 只认显式形态（pmid: 前缀或 pubmed 网址）：裸数字串（如 "2024"）
 * 在检索框里是年份或普通查询，不是文献标识符。
 *
 * @module core/search/identifierQuery
 */

import { ZSEARCH_HTTP_HEADERS } from "../../utils/httpHeaders";
import { httpJsonGet } from "../../utils/http";
import { safeDebug } from "../../utils/logger";
import { classifySourceError } from "../sources/academic-search/utils";
import { mapCrossRefWork } from "../sources/academic-search/crossref";
import {
  mapOpenAlexWork,
  openalexRequest,
  searchOpenAlexByDoi,
} from "../sources/academic-search/openalex";
import { searchPubMed } from "../sources/academic-search/pubmed";
import { withOpenalexAuth } from "../../utils/openalexAuth";

/** 标识符种类（与 importArticle 的 IdentifierType 对齐的子集）。 */
export type IdentifierKind = "doi" | "arxiv" | "pmid";

export interface IdentifierQuery {
  kind: IdentifierKind;
  /** 归一化标识符：DOI 小写剥前缀；arXiv 剥网址留编号；PMID 纯数字。 */
  value: string;
}

export interface IdentifierLookupResult {
  /** 命中的文章（适配器统一题录字段）；未命中为 null。 */
  article: any | null;
  /** 命中文章来自哪个源；未命中为 null。 */
  source: string | null;
  /** 实际发起过请求的源（失败归因用）。 */
  attempted: string[];
  /**
   * 所有端点都没能给出结论时的原因码（timeout/network/rate-limited/http）。
   * 端点明确回答"无此文献"时为 undefined——这是真实的未命中，不是故障，
   * 界面不得把它谎报成检索失败。
   */
  error?: string;
}

/**
 * 去首尾空白与句末标点。复制粘贴常带上句号/逗号/分号/斜杠，DOI 后缀
 * 不含这四个字符，剥掉是安全的。
 */
function stripEdgeNoise(s: string): string {
  return s.trim().replace(/[.,;/]+$/, "");
}

const DOI_URL_RE = /^https?:\/\/(?:dx\.)?doi\.org\/(\S+)$/i;
const DOI_SCHEME_RE = /^doi:\s*(\S+)$/i;
const DOI_BODY_RE = /^10\.\d{4,9}\/\S+$/;
const ARXIV_URL_RE = /^https?:\/\/arxiv\.org\/abs\/(\S+)$/i;
const ARXIV_ID_RE = /^\d{4}\.\d{4,5}(?:v\d+)?$/;
const PMID_URL_RE = /^https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/(\d{1,9})\/?$/i;
const PMID_SCHEME_RE = /^pmid:\s*(\d{1,9})$/i;

/**
 * 识别"整串就是一个标识符"的查询；不是则返回 null（走普通关键词检索）。
 *
 * DOI 支持裸编号、doi.org 链接（含 dx. 子域）、doi: 前缀三种写法；
 * arXiv 支持新式编号（YYMM.NNNNN，可带 vN）与 arxiv.org/abs/ 链接；
 * PMID 支持 pmid: 前缀与 pubmed 网址。
 */
export function detectIdentifierQuery(
  query: string | null | undefined,
): IdentifierQuery | null {
  const raw = stripEdgeNoise(String(query ?? ""));
  if (!raw) return null;

  const doiBody =
    DOI_URL_RE.exec(raw)?.[1] ?? DOI_SCHEME_RE.exec(raw)?.[1] ?? raw;
  if (DOI_BODY_RE.test(doiBody)) {
    return { kind: "doi", value: doiBody.toLowerCase() };
  }

  const arxivUrlMatch = ARXIV_URL_RE.exec(raw);
  const arxivBody = arxivUrlMatch ? arxivUrlMatch[1] : raw;
  if (ARXIV_ID_RE.test(arxivBody)) {
    return { kind: "arxiv", value: arxivBody };
  }

  const pmid = PMID_URL_RE.exec(raw)?.[1] ?? PMID_SCHEME_RE.exec(raw)?.[1];
  if (pmid) return { kind: "pmid", value: pmid };

  return null;
}

/** XML 实体最小集反转义（题名/摘要里 & < > " ' 与数字字符引用最常见）。 */
function decodeXmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) =>
      String.fromCodePoint(parseInt(h, 16)),
    )
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * 解析 arXiv Atom 响应里的单条 entry → 统一题录字段。
 *
 * 用正则而非 DOMParser：调用方含 node 环境单测（无 DOMParser），且此处
 * 只解析 id_list= 单条查询的固定 Atom 结构。解析不出题名时返回 null，
 * 由调用方走 OpenAlex 兜底。
 */
export function parseArxivAtomEntry(xml: string): any | null {
  const entryMatch = /<entry>([\s\S]*?)<\/entry>/.exec(xml);
  if (!entryMatch) return null;
  const entry = entryMatch[1];

  const text = (tag: string): string => {
    const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(
      entry,
    );
    return m ? decodeXmlEntities(m[1].replace(/\s+/g, " ").trim()) : "";
  };

  const title = text("title");
  if (!title) return null;

  const authors = [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g)]
    .map((m) => decodeXmlEntities(m[1].trim()))
    .filter(Boolean)
    .join(", ");

  // link 标签属性顺序不固定（href 常在 title 之前），先取标签再提 href
  const pdfLink = [...entry.matchAll(/<link\b[^>]*\/?>/g)]
    .map((m) => m[0])
    .find((tag) => /title="pdf"/.test(tag));
  const pdfHref = pdfLink ? /href="([^"]+)"/.exec(pdfLink)?.[1] : undefined;
  const published = text("published");

  return {
    title,
    authors,
    abstract: text("summary"),
    year: published ? new Date(published).getFullYear() : "",
    doi: text("arxiv:doi"),
    url: text("id"),
    pdfUrl: pdfHref ? decodeXmlEntities(pdfHref) : "",
    citationCount: 0,
    source: "arxiv" as const,
    publicationType: "preprint",
  };
}

/** 按标识符种类分流到精确反查链路。 */
export async function lookupArticleByIdentifier(
  id: IdentifierQuery,
): Promise<IdentifierLookupResult> {
  switch (id.kind) {
    case "doi":
      return lookupDoi(id.value);
    case "arxiv":
      return lookupArxiv(id.value);
    case "pmid":
      return lookupPmid(id.value);
  }
}

/**
 * DOI 精确反查：Crossref /works/{doi} 主，OpenAlex /works/doi: 兜底。
 *
 * 两条都明确回答"没有"才算未命中（Crossref 对未注册 DOI 返回 404，
 * OpenAlex 对未收录 DOI 返回 404）；网络/限流故障记 error，界面据此
 * 提示重试而不是谎报"未找到"。
 */
async function lookupDoi(doi: string): Promise<IdentifierLookupResult> {
  const attempted: string[] = [];
  let lastError: string | undefined;

  attempted.push("crossref");
  try {
    const r = await httpJsonGet(
      `https://api.crossref.org/works/${encodeURIComponent(doi)}`,
      undefined,
      15000,
    );
    if (r.ok) {
      const message = JSON.parse(r.body)?.message;
      if (message?.DOI) {
        return {
          article: mapCrossRefWork(message),
          source: "crossref",
          attempted,
        };
      }
      // 200 但无 message：继续 OpenAlex 兜底，不当未命中结论
    } else if (r.status !== 404) {
      lastError = classifySourceError(r.error);
    }
  } catch (e) {
    lastError = classifySourceError(String(e));
    safeDebug("[z-search] identifierQuery: crossref lookup failed: " + e);
  }

  attempted.push("openalex");
  try {
    const article = await searchOpenAlexByDoi({ doi });
    if (article) {
      return { article, source: "openalex", attempted };
    }
  } catch (e) {
    lastError = classifySourceError(String(e));
    safeDebug("[z-search] identifierQuery: openalex lookup failed: " + e);
  }

  return { article: null, source: null, attempted, error: lastError };
}

/**
 * arXiv 编号精确反查：arXiv Atom id_list 主，OpenAlex works/arxiv: 兜底
 * （后者常能命中预印本的正式出版版）。
 */
async function lookupArxiv(arxivId: string): Promise<IdentifierLookupResult> {
  const attempted: string[] = ["arxiv"];
  let lastError: string | undefined;

  try {
    const resp = await Zotero.HTTP.request(
      "GET",
      `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}&max_results=1`,
      {
        headers: { Accept: "application/atom+xml", ...ZSEARCH_HTTP_HEADERS },
        responseType: "text",
        timeout: 30000,
        errorDelayMax: 0,
      } as any,
    );
    const article = parseArxivAtomEntry(resp.responseText || "");
    if (article) {
      return { article, source: "arxiv", attempted };
    }
  } catch (e) {
    lastError = classifySourceError(String(e));
    safeDebug("[z-search] identifierQuery: arxiv lookup failed: " + e);
  }

  attempted.push("openalex");
  try {
    const url = withOpenalexAuth(
      `https://api.openalex.org/works/arxiv:${encodeURIComponent(arxivId)}` +
        `?select=id,doi,title,authorships,publication_year,abstract_inverted_index,primary_location,cited_by_count,open_access,biblio,type`,
    );
    const r = await openalexRequest(url);
    if (r.ok) {
      const work = JSON.parse(r.body);
      if (work?.id) {
        return {
          article: mapOpenAlexWork(work),
          source: "openalex",
          attempted,
        };
      }
    } else if (r.status !== 404) {
      lastError = classifySourceError(r.error);
    }
  } catch (e) {
    lastError = classifySourceError(String(e));
    safeDebug("[z-search] identifierQuery: openalex arxiv lookup failed: " + e);
  }

  return { article: null, source: null, attempted, error: lastError };
}

/**
 * PMID 精确反查：PubMed 把裸整数检索词解析为 UID 查找，直接复用
 * searchPubMed 的映射（摘要/期刊/PMCID 字段与关键词检索路径一致）。
 */
async function lookupPmid(pmid: string): Promise<IdentifierLookupResult> {
  const attempted = ["pubmed"];
  const res = await searchPubMed({ query: pmid, maxResults: 1 });
  if (res?.success === false) {
    return {
      article: null,
      source: null,
      attempted,
      error: classifySourceError(res.error),
    };
  }
  if (res?.articles?.length) {
    return { article: res.articles[0], source: "pubmed", attempted };
  }
  // 检索成功但零命中：PubMed 明确回答无此 UID
  return { article: null, source: null, attempted };
}
