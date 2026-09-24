/**
 * TeiSectionParser — 结构化全文 XML（GROBID TEI / PMC JATS）→ 章节切分。
 *
 * P1-D：PDF 文本的章节识别靠标题行正则猜测（sectionParser），对排版
 * 不规范的 PDF 常失败。出版商/PMC/GROBID 的 XML 自带精确章节边界
 * （TEI `<div><head>`、JATS `<sec sec-type>`），本解析器把 XML 切成与
 * sectionParser.parseSections **同型** 的 ParseResult，供 PdfChunkIndexer
 * 作为前置优先源消费。
 *
 * 实现：栈式标签扫描器（非 DOM）—— GROBID/PMC 输出是机器生成的规整
 * XML，按标签 token 走栈即可精确处理嵌套 `<sec>`/`<div>`，且零依赖
 * （Zotero 主窗口与 vitest node 环境都不需要 DOMParser）。
 *
 * 坐标立法：XML 坐标 ≠ PDF filteredText 坐标，chunk 的 startOffset/endOffset
 * 一律 null（E1 契约：页界不可得时 page 为 null，chunk 仍按条目级入索引）。
 *
 * @module core/search/TeiSectionParser
 */

import {
  matchSectionTitle,
  type ParseResult,
  type ParsedChunk,
  type SectionCategory,
} from "./sectionParser";

/** 包装节（无类型无标题小 div）正文字数下限——低于此上交父层。 */
const WRAPPER_MIN_CHARS = 80;
/** 已归类章（type/head 词表命中）正文字数下限——短小的 Methods 段与单条参考文献也是锚点。 */
const CATEGORIZED_MIN_CHARS = 20;
/** 超长章子块目标长度（与 sectionParser 的 MAX_SECTION_CHARS 对齐）。 */
const MAX_SUBCHUNK_CHARS = 2000;

interface TagToken {
  name: string;
  attrs: Record<string, string>;
  closing: boolean;
  selfClosing: boolean;
}

/** JATS sec-type → category（PMC 受控词汇的常见值；未列出走标题词表）。 */
const JATS_SEC_TYPE: Record<string, SectionCategory> = {
  intro: "intro",
  introduction: "intro",
  background: "intro",
  methods: "method",
  method: "method",
  materials: "method",
  "material-methods": "method",
  experimental: "method",
  results: "results",
  discussion: "discussion",
  conclusions: "conclusion",
  conclusion: "conclusion",
  "conclusions-statements": "conclusion",
  abstract: "abstract",
  statistical: "method",
  "statistical-analysis": "method",
  stats: "method",
};

/** TEI div type → category（GROBID 常见值）。 */
const TEI_DIV_TYPE: Record<string, SectionCategory> = {
  abstract: "abstract",
  introduction: "intro",
  materials: "method",
  methods: "method",
  technique: "method",
  apparatus: "method",
  results: "results",
  discussion: "discussion",
  conclusion: "conclusion",
  conclusions: "conclusion",
  references: "references",
  bibliography: "references",
};

/** ── 标签流扫描 ──────────────────────────────────────────────────────── */

const TAG_RE =
  /<\/?([A-Za-z][A-Za-z0-9:_-]*)((?:\s+[\w:-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))*)\s*(\/?)>/g;
const ATTR_RE = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  let m: RegExpExecArray | null;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(raw))) {
    attrs[m[1].toLowerCase()] = (m[2] ?? m[3] ?? m[4] ?? "").trim();
  }
  return attrs;
}

function* tokenize(xml: string): Generator<TagToken | { text: string }> {
  let pos = 0;
  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(xml))) {
    if (m.index > pos) {
      yield { text: xml.slice(pos, m.index) };
    }
    pos = m.index + m[0].length;
    yield {
      name: m[1].toLowerCase(),
      attrs: parseAttrs(m[2] ?? ""),
      closing: m[0][1] === "/",
      selfClosing: m[3] === "/",
    };
  }
  if (pos < xml.length) yield { text: xml.slice(pos) };
}

/** 最小实体解码（机器 XML 常见四种；数字实体交给 String.fromCodePoint）。 */
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function safeCodePoint(cp: number): string {
  return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff
    ? String.fromCodePoint(cp)
    : "";
}

function cleanText(s: string): string {
  return decodeEntities(s.replace(/\s+/g, " ")).trim();
}

/** ── 类别判定 ────────────────────────────────────────────────────────── */

function categoryFromType(
  tag: string,
  typeAttr: string | undefined,
): SectionCategory | null {
  // 容器 tag 自带语义（abstract/ref-list 常无 type 属性）——先于 typeAttr 判定
  if (tag === "abstract") return "abstract";
  if (tag === "ref-list") return "references";
  if (!typeAttr) return null;
  const t = typeAttr.toLowerCase();
  if (tag === "sec") return JATS_SEC_TYPE[t] ?? null;
  if (tag === "div") return TEI_DIV_TYPE[t] ?? null;
  return null;
}

/** ── 主扫描器 ────────────────────────────────────────────────────────── */

interface Frame {
  tag: string;
  typeCategory: SectionCategory | null;
  title: string;
  /** 当前捕获模式：null=忽略，title=head/title 文本，body=p 等正文文本。 */
  mode: "ignore" | "title" | "body";
  body: string[];
}

/**
 * GROBID TEI / PMC JATS XML → ParseResult。
 * 无法识别文档类型、或切不出任何有效章节时返回 null（调用方回落
 * sectionParser 文本路径）。
 */
export function parseTeiOrJats(xml: string): ParseResult | null {
  if (!xml || xml.length < 200) return null;
  const isTei = /<TEI[\s>]/i.test(xml);
  const isJats = /<(article|pmc-articleset)[\s>]/i.test(xml);
  if (!isTei && !isJats) return null;

  const sections: Array<{
    category: SectionCategory;
    name: string;
    text: string;
  }> = [];
  const stack: Frame[] = [];

  const pushFrame = (tag: string, attrs: Record<string, string>) => {
    stack.push({
      tag,
      typeCategory: categoryFromType(tag, attrs["sec-type"] ?? attrs["type"]),
      title: "",
      mode: "ignore",
      body: [],
    });
  };

  /** 出栈：解析类别，内容有效则落章；正文向父 frame 归还（嵌套 sec 语义）。 */
  const popFrame = () => {
    const frame = stack.pop();
    if (!frame) return;
    const text = frame.body.join("\n").trim();
    const category =
      frame.typeCategory ??
      (frame.title
        ? (matchSectionTitle(frame.title)?.category ?? null)
        : null) ??
      (frame.tag === "div" || frame.tag === "sec" ? "other" : null);
    const isWrapper = category === "other" || category === null;
    const floor = isWrapper ? WRAPPER_MIN_CHARS : CATEGORIZED_MIN_CHARS;
    if (text.length >= floor && category) {
      sections.push({
        category,
        name: frame.title || frame.typeCategory || category,
        text,
      });
    } else if (text && stack.length > 0) {
      // 包装节/过短：正文上交父层，不落章
      stack[stack.length - 1].body.push(text);
    }
  };

  for (const tok of tokenize(xml)) {
    if ("text" in tok) {
      if (stack.length === 0) continue;
      const frame = stack[stack.length - 1];
      if (frame.mode === "ignore") continue;
      const text = cleanText(tok.text);
      if (!text) continue;
      if (frame.mode === "title")
        frame.title = (frame.title + " " + text).trim();
      else frame.body.push(text);
      continue;
    }
    if (tok.closing) {
      const top = stack[stack.length - 1];
      if (top && top.tag === tok.name) {
        if (top.mode === "title") top.mode = "ignore";
        else if (top.mode === "body") top.mode = "ignore";
        // 容器闭合在下方统一处理
      }
      // 容器出栈：sec / div / abstract / ref-list
      if (
        tok.name === "sec" ||
        tok.name === "div" ||
        tok.name === "abstract" ||
        tok.name === "ref-list"
      ) {
        // 逐层弹到匹配的容器（容错未闭合内层容器）
        while (stack.length > 0) {
          const top = stack[stack.length - 1];
          popFrame();
          if (top.tag === tok.name) break;
        }
      }
      continue;
    }
    // 开标签
    if (
      tok.name === "sec" ||
      tok.name === "div" ||
      tok.name === "abstract" ||
      tok.name === "ref-list"
    ) {
      if (!tok.selfClosing) pushFrame(tok.name, tok.attrs);
      continue;
    }
    if (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (tok.name === "head" || tok.name === "title") {
        frame.mode = "title";
      } else if (
        tok.name === "p" ||
        tok.name === "mix-citation" ||
        tok.name === "mixed-citation"
      ) {
        frame.mode = "body";
      } else if (!tok.selfClosing) {
        // 内联标签（italic/xref/b等）：不切模式，文本继续进当前模式
      }
    }
  }

  // 尾部残留（未闭合容器容错）
  while (stack.length > 0) popFrame();

  if (sections.length === 0) return null;

  // 分类有效性：必须切出至少一个 method 或 results 章（否则该 XML 的
  // 边界信息不比文本猜测强，调用方应回落）——call 侧再复合校验，这里不卡。
  const chunks: ParsedChunk[] = [];
  for (const sec of sections) {
    if (sec.text.length > MAX_SUBCHUNK_CHARS) {
      for (const piece of splitAtParagraphBoundaries(sec.text)) {
        chunks.push({
          sectionCategory: sec.category,
          sectionName: sec.name,
          chunkText: piece,
          charCount: piece.length,
          startOffset: null,
          endOffset: null,
        });
      }
    } else {
      chunks.push({
        sectionCategory: sec.category,
        sectionName: sec.name,
        chunkText: sec.text,
        charCount: sec.text.length,
        startOffset: null,
        endOffset: null,
      });
    }
  }
  if (chunks.length === 0) return null;
  return { method: "structured", chunks };
}

/** 段落边界子切（长章 → ≤2000 字符块；结构化文本段间以 \n 连接）。 */
function splitAtParagraphBoundaries(text: string): string[] {
  const paras = text.split("\n").filter((p) => p.trim().length > 0);
  const out: string[] = [];
  let current = "";
  for (const p of paras) {
    if (current && current.length + p.length + 1 > MAX_SUBCHUNK_CHARS) {
      out.push(current);
      current = p;
    } else {
      current = current ? `${current}\n${p}` : p;
    }
  }
  if (current.trim()) out.push(current);
  return out;
}

/**
 * 章节有效性复合校验（PdfChunkIndexer 接线门）：
 * 至少 3 个已识别章节且包含 method 章 —— method 章是 P0 定向投喂的
 * 目标；没有它，结构化路径相对文本猜测没有增益。
 */
export function isMethodBearingParse(result: ParseResult): boolean {
  if (result.method !== "structured") return false;
  if (result.chunks.length < 3) return false;
  const cats = new Set(result.chunks.map((c) => c.sectionCategory));
  return cats.has("method");
}
