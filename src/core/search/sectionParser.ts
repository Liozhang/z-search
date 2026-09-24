/**
 * sectionParser — Split PDF full text into chunks aligned with paper sections.
 *
 * Strategy:
 * 1. Identify section headings (English + Chinese, tolerant of numbering)
 * 2. Bucket text into named sections, each tagged with a category
 * 3. If ≤1 section recognized (non-standard layout), fall back to
 *    fixed-size character chunking with overlap — chunks are tagged
 *    parse_method='fallback' so callers can distinguish.
 * 4. Long sections (> MAX_SECTION_CHARS) are sub-chunked to keep embedding
 *    input within model comfort range.
 *
 * Pure functions, no I/O — easy to unit-test.
 *
 * @module core/search/sectionParser
 */

export type SectionCategory =
  | "abstract"
  | "intro"
  | "method"
  | "results"
  | "discussion"
  | "conclusion"
  | "references"
  | "header"
  | "other";

export type ParseMethod = "section" | "fallback" | "structured";

export interface ParsedChunk {
  sectionCategory: SectionCategory;
  sectionName: string;
  chunkText: string;
  charCount: number;
  /**
   * E1 片段定位：chunk 在 fullText 坐标系下的 [start, end)。
   * 节路径精确（行偏移记账）；fallback/超长节子块路径为清洗文本上的
   * 线性插值（页级精度足够，char 级不可信）。null = 坐标不可得。
   */
  startOffset: number | null;
  endOffset: number | null;
}

export interface ParseResult {
  method: ParseMethod;
  chunks: ParsedChunk[];
}

// Tuning knobs
const CHUNK_SIZE = 1500;
const CHUNK_OVERLAP = 200;
const MAX_SECTION_CHARS = 2000;
const HEADING_MAX_LEN = 60;

interface SectionPattern {
  category: SectionCategory;
  regex: RegExp;
}

// Order matters: more specific first (e.g. "Materials and Methods"
// before generic "Methods").
const SECTION_PATTERNS: SectionPattern[] = [
  // Abstract
  { category: "abstract", regex: /^abstract\b/i },
  { category: "abstract", regex: /^(摘\s*要|内容提要)/ },

  // Introduction (includes related work + background)
  {
    category: "intro",
    regex:
      /^(introduction(\s+and\s+background)?|background(\s+and\s+introduction)?|related\s+works?|prior\s+works?|literature\s+review|related\s+research)\b/i,
  },
  {
    category: "intro",
    regex: /^(引言|前言|背景|研究背景|相关工作|文献综述|研究现状)/,
  },

  // Method
  {
    category: "method",
    regex:
      /^(materials\s+and\s+methods|methods|methodology|experimental\s+(setup|methods?|section|design)|experiment(s|al\s+setup)?|model|approach|proposed\s+(method|approach|framework|model)|our\s+(method|approach|model|framework)|method\s+overview|algorithm|implementation\s+details?|architecture|design\s+(and\s+)?implementation|setup)\b/i,
  },
  {
    category: "method",
    regex:
      /^(方法|方法论|材料与方法|实验方法|实验设置|实验设计|模型|算法|实现细节|本文方法|提出的方法|架构|设计与实现)/,
  },

  // Results
  {
    category: "results",
    regex:
      /^(results?(\s+and\s+(discussion|analysis))?|experiments?|evaluation|experimental\s+(results?|evaluation)|findings?)\b/i,
  },
  { category: "results", regex: /^(结果|实验结果|结果与分析|评估|发现)/ },

  // Discussion
  {
    category: "discussion",
    regex:
      /^(discussions?|analysis|discussions?\s+and\s+(implications|limitations))\b/i,
  },
  { category: "discussion", regex: /^(讨论|分析|讨论与局限)/ },

  // Conclusion
  {
    category: "conclusion",
    regex:
      /^(conclusions?|concluding\s+remarks?|final\s+remarks?|summary|future\s+work|future\s+directions?)\b/i,
  },
  { category: "conclusion", regex: /^(结论|总结|结束语|展望|未来工作)/ },

  // References
  {
    category: "references",
    regex: /^(references?|bibliography|works?\s+cited|cited\s+references?)\b/i,
  },
  { category: "references", regex: /^(参考文献|引用文献)/ },
];

interface IdentifiedSection {
  category: SectionCategory;
  name: string;
  text: string;
  /** E1: 节正文在 fullText 中的 [start, end)（首/末内容行的行偏移，精确）。 */
  startOffset: number;
  endOffset: number;
}

/**
 * Strip common numbering prefixes from a heading line so the section-name
 * regexes can match the bare title.
 *
 * Handles: "1.", "1.1", "1.1.1", "1、", "1)", "一、", "I.", "A."
 */
function stripNumbering(line: string): string {
  return line
    .replace(/^(\d+\.)+\d*\.?\s*/, "") // 1. / 1.1. / 1.1.1
    .replace(/^\d+[、)]\s*/, "") // 1、 / 1)
    .replace(/^[一二三四五六七八九十百]+、\s*/, "") // 一、
    .replace(/^[IVXLCM]{2,}\.?\s+/, "") // II. / IV. (≥2 chars, uppercase only — avoids eating "In…" or "M. Smith")
    .replace(/^[A-Z]\.\s+/, "") // A. (require trailing space to avoid eating words)
    .trim();
}

/**
 * Heading line → { category, name }（词表单一真源）。
 * P1-D 起导出供 TeiSectionParser 复用：TEI head / JATS title 的文本
 * 经同一词表归类，保证 chunk 的 sectionCategory 值域跨解析器一致。
 */
export function matchSectionTitle(
  line: string,
): { category: SectionCategory; name: string } | null {
  const normalized = stripNumbering(line);
  if (!normalized || normalized.length > HEADING_MAX_LEN) return null;

  for (const { category, regex } of SECTION_PATTERNS) {
    if (regex.test(normalized)) {
      return { category, name: normalized };
    }
  }
  return null;
}

/**
 * Walk the text line-by-line, bucketing content under the most recently
 * identified section heading. Text before any recognized heading is
 * tagged 'header' (title block, authors, affiliations).
 */
function identifySections(fullText: string): IdentifiedSection[] {
  const lines = fullText.split("\n");
  const sections: IdentifiedSection[] = [];
  let current: IdentifiedSection = {
    category: "header",
    name: "header",
    text: "",
    startOffset: 0,
    endOffset: 0,
  };
  let offset = 0;

  for (const line of lines) {
    const lineStart = offset;
    offset += line.length + 1; // +1 = split 吃掉的 '\n'（末行多记 1，仅作偏移近似无消费方依赖）
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      if (current.text.length > 0) current.text += "\n";
      continue;
    }

    const matched =
      trimmed.length <= HEADING_MAX_LEN ? matchSectionTitle(trimmed) : null;
    if (matched) {
      if (current.text.trim()) sections.push(current);
      current = {
        category: matched.category,
        name: matched.name,
        text: "",
        startOffset: lineStart,
        endOffset: lineStart + line.length,
      };
      continue;
    }
    if (current.text.length === 0) current.startOffset = lineStart;
    current.text += line + "\n";
    current.endOffset = lineStart + line.length;
  }
  if (current.text.trim()) sections.push(current);
  return sections;
}

/**
 * Find a paragraph/sentence boundary near the target size to avoid
 * slicing mid-sentence. Returns an index suitable for slice(0, idx).
 *
 * Period handling avoids common abbreviation false positives (Fig., et al.,
 * e.g., i.e.) by requiring the period to be followed by whitespace + an
 * uppercase letter (a new sentence) or end-of-text.
 */
function findBoundary(text: string, minFraction = 0.5): number {
  const minPos = Math.floor(text.length * minFraction);
  for (let i = text.length - 1; i >= minPos; i--) {
    const ch = text[i];
    // Hard boundaries: newlines + CJK terminators (always safe)
    if (ch === "\n" || ch === "。" || ch === "；" || ch === ";") {
      return i + 1;
    }
    // Exclamation / question marks (ASCII + full-width) — usually sentence end
    if (ch === "!" || ch === "?" || ch === "！" || ch === "？") {
      return i + 1;
    }
    // Period: only counts as boundary if followed by a new sentence
    // (whitespace + uppercase) or end-of-text. Skips "Fig. 1", "et al.",
    // "e.g.", decimal numbers like "3.14".
    if (ch === ".") {
      const rest = text.slice(i + 1);
      if (rest.length === 0) return i + 1;
      if (/^\s+[A-Z()]/.test(rest)) return i + 1;
    }
  }
  return text.length;
}

/**
 * Fixed-size chunking with overlap, aligned to sentence boundaries.
 * Used as the fallback and for over-long sections.
 *
 * E1: 传入 span（该文本在 fullText 坐标系下的区间）时，chunk 偏移按清洗
 * 坐标线性插值到 span 内 — 页级定位精度足够；未传 span 则偏移为 null。
 */
function chunkByCharSize(
  text: string,
  defaultCategory: SectionCategory,
  span?: { start: number; end: number },
): ParsedChunk[] {
  const clean = text
    .replace(/\s+\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
  if (clean.length === 0) return [];

  const totalClean = Math.max(1, clean.length);
  const toOriginal = (cleanPos: number): number | null =>
    span
      ? Math.round(
          span.start +
            (Math.min(cleanPos, clean.length) / totalClean) *
              (span.end - span.start),
        )
      : null;

  const chunks: ParsedChunk[] = [];
  let pos = 0;
  while (pos < clean.length) {
    const end = Math.min(pos + CHUNK_SIZE, clean.length);
    let slice = clean.slice(pos, end);

    if (end < clean.length) {
      const boundary = findBoundary(slice);
      if (boundary >= CHUNK_SIZE * 0.5) {
        slice = slice.slice(0, boundary);
      }
    }

    chunks.push({
      sectionCategory: defaultCategory,
      sectionName: defaultCategory,
      chunkText: slice.trim(),
      charCount: slice.trim().length,
      startOffset: toOriginal(pos),
      endOffset: toOriginal(pos + slice.length),
    });

    const advance = Math.max(1, slice.length - CHUNK_OVERLAP);
    pos += advance;
    if (pos >= clean.length) break;
    // Safety: if the slice was shorter than 2x overlap (can happen near the
    // tail), the next iteration would advance only 1 char and produce many
    // near-duplicate chunks before reaching clean.length. Stop here — the
    // leftover is by definition < CHUNK_SIZE so a final chunk isn't worth it.
    if (slice.length < CHUNK_OVERLAP * 2) break;
  }
  return chunks;
}

/**
 * Main entry point. Always returns at least the original text as one chunk
 * if the input is non-empty.
 */
export function parseSections(fullText: string): ParseResult {
  if (!fullText || fullText.trim().length === 0) {
    return { method: "fallback", chunks: [] };
  }

  const sections = identifySections(fullText);

  // Fallback only if we failed to recognize ANY non-header section.
  // (A lone Abstract with empty header still counts as a successful parse.)
  const hasRecognizedSection = sections.some((s) => s.category !== "header");
  if (!hasRecognizedSection) {
    return {
      method: "fallback",
      chunks: chunkByCharSize(fullText, "other", {
        start: 0,
        end: fullText.length,
      }),
    };
  }

  const chunks: ParsedChunk[] = [];
  for (const sec of sections) {
    if (!sec.text.trim()) continue;

    if (sec.text.length > MAX_SECTION_CHARS) {
      // Over-long section: sub-chunk but keep the section category/name
      const subChunks = chunkByCharSize(sec.text, sec.category, {
        start: sec.startOffset,
        end: sec.endOffset,
      });
      for (const sc of subChunks) {
        chunks.push({ ...sc, sectionName: sec.name });
      }
    } else {
      chunks.push({
        sectionCategory: sec.category,
        sectionName: sec.name,
        chunkText: sec.text.trim(),
        charCount: sec.text.trim().length,
        startOffset: sec.startOffset,
        endOffset: sec.endOffset,
      });
    }
  }

  if (chunks.length === 0) {
    return {
      method: "fallback",
      chunks: chunkByCharSize(fullText, "other", {
        start: 0,
        end: fullText.length,
      }),
    };
  }

  return { method: "section", chunks };
}

/** E1: 页界 span（PdfTextProvider.pageSpans，filteredText 字符坐标系）。 */
export interface PageSpan {
  pageNumber: number;
  start: number;
  end: number;
}

/**
 * chunk 起始偏移 → 页码。spans 按页序升序时二分；跨页 chunk 取起始页。
 * 偏移越界（尾部哨兵外）回落到最后一个命中的页；offset null 或 spans 空
 * 返回 null —— 页界不可得时不猜测。
 */
export function locatePageNumber(
  pageSpans: PageSpan[],
  offset: number | null,
): number | null {
  if (offset === null || pageSpans.length === 0) return null;
  let lo = 0;
  let hi = pageSpans.length - 1;
  let best: number | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = pageSpans[mid];
    if (offset < s.start) {
      hi = mid - 1;
    } else if (offset >= s.end) {
      best = s.pageNumber;
      lo = mid + 1;
    } else {
      return s.pageNumber;
    }
  }
  return best;
}
