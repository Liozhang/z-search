/**
 * Highlight utility — wraps search query matches in <mark> tags.
 * Used by MarkdownRenderer and plain-text rendering for in-conversation search.
 */

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Highlight all occurrences of `query` in `text` by wrapping them in <mark> tags.
 * Returns the original text unchanged if query is empty.
 *
 * This function operates on plain text, not HTML. It is designed to be used
 * BEFORE markdown rendering (on the raw content) or on plain text nodes.
 */
export function highlightText(text: string, query: string): string {
  if (!query || !text) return text;
  const escaped = escapeRegex(query);
  return text.replace(
    new RegExp(`(${escaped})`, "gi"),
    '<mark class="leadero-search-highlight">$1</mark>',
  );
}

/**
 * Count the number of matches of `query` in `text` (case-insensitive).
 */
export function countMatches(text: string, query: string): number {
  if (!query || !text) return 0;
  const escaped = escapeRegex(query);
  const matches = text.match(new RegExp(escaped, "gi"));
  return matches ? matches.length : 0;
}

export interface HighlightSegment {
  text: string;
  /** true = 该段命中查询词（调用方负责套高亮样式） */
  hit: boolean;
}

/**
 * Split `text` into plain segments around `query` matches — the React-node
 * counterpart of highlightText (which returns an HTML string). Use when the
 * consumer renders children (no dangerouslySetInnerHTML), e.g. result titles
 * with brand-colored hit words.
 */
export function highlightSegments(
  text: string,
  query: string,
): HighlightSegment[] {
  if (!query || !text) return [{ text, hit: false }];
  // 2026-09-16 审计：原实现把整条查询串当单条正则——多词查询要求标题逐字
  // 包含全串（"Methyl cfDNA marker"），几乎永不命中，标题高亮形同虚设。
  // 改为按空白切词 OR 匹配（子串级，不加 \b 词界：JS 正则把 CJK 视为非词
  // 字符，\b 会让纯中文词在中文上下文里零命中）。
  const tokens = Array.from(new Set(query.split(/\s+/)))
    .map((t) => escapeRegex(t.trim()))
    .filter(Boolean);
  if (tokens.length === 0) return [{ text, hit: false }];
  // String.split 带捕获组：偶数下标 = 未命中文本，奇数下标 = 命中片段。
  // 空串跳过但保留原始下标判定奇偶（查询词命中开头/结尾时会产生空段）；
  // 不要用 g 正则的 test() 判定 —— lastIndex 状态会串段。
  const segs: HighlightSegment[] = [];
  text.split(new RegExp(`(${tokens.join("|")})`, "gi")).forEach((p, i) => {
    if (p !== "") segs.push({ text: p, hit: i % 2 === 1 });
  });
  return segs;
}
