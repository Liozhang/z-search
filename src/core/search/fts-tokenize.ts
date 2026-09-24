/**
 * FTS tokenizer for the BM25 full-text index — pure, testable.
 *
 * SQLite's unicode61 tokenizer treats CJK ideographs as token characters,
 * so an unsegmented Chinese sentence becomes ONE giant token and term
 * queries miss entirely (Zotero's own fulltextWord index has the same
 * limitation — see FulltextSearch's CJK→SQL LIKE fallback). We therefore
 * pre-tokenize before indexing:
 *
 *   - CJK runs → overlapping bigrams ("对比学习方法" → "对比 比学 学习 方法")
 *     2-char words match exactly; longer phrases match via OR of bigrams
 *     with BM25 ranking. Single isolated CJK char is kept as a unigram.
 *   - Latin/digit runs → lowercase words.
 *   - everything else (punctuation/whitespace) → token boundary.
 *
 * @module core/search/fts-tokenize
 */

const CJK_CHAR = /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/;
const WORD_CHAR = /[A-Za-z0-9]/;

/** Upper bound on tokens emitted for one query — caps MATCH expression size. */
export const MAX_QUERY_TOKENS = 64;

/** Tokenize arbitrary text into the space-joined form stored in FTS5. */
export function tokenizeForFts(text: string): string {
  const out: string[] = [];
  let buf = "";
  let bufIsCjk = false;

  const flush = () => {
    if (!buf) return;
    if (bufIsCjk) {
      if (buf.length === 1) {
        out.push(buf);
      } else {
        for (let i = 0; i < buf.length - 1; i++) out.push(buf.slice(i, i + 2));
      }
    } else {
      out.push(buf.toLowerCase());
    }
    buf = "";
  };

  for (const ch of text) {
    if (CJK_CHAR.test(ch)) {
      if (buf && !bufIsCjk) flush();
      buf += ch;
      bufIsCjk = true;
    } else if (WORD_CHAR.test(ch)) {
      if (buf && bufIsCjk) flush();
      buf += ch;
      bufIsCjk = false;
    } else {
      flush();
    }
  }
  flush();

  return out.join(" ");
}

/**
 * Build an FTS5 MATCH expression from a user query: OR-joined quoted
 * tokens (OR for recall — BM25 ranking supplies precision). Returns null
 * when the query yields no usable token (callers should return []).
 */
export function buildMatchQuery(query: string): string | null {
  const tokens = tokenizeForFts(query).split(" ").filter(Boolean);
  if (tokens.length === 0) return null;
  return tokens
    .slice(0, MAX_QUERY_TOKENS)
    .map((t) => `"${t}"`)
    .join(" OR ");
}
