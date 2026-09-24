/**
 * translateParagraphs — Stage B of layout-preserving translation.
 *
 * Translates each assembled paragraph text, preserving `{vn}` formula
 * placeholders so Stage C can stitch formulas back in.
 *
 * Two key behaviors from converter.py:
 *   - Pure-formula paragraphs (`{v3}` only, no surrounding text) are skipped —
 *     never sent to the translator (converter.py `re.match(r"^\{v\d+\}$", s)`).
 *   - The translator MUST return `{vn}` tokens verbatim. converter.py relies on
 *     this; the C stage re-parses them with a tolerant regex (converter.py
 *     `\{\s*v([\d\s]+)\}`). We reinforce this in the system prompt.
 *
 * @module core/pdf/translation/translateParagraphs
 */

import { Semaphore } from "../../../utils/Semaphore";
import { safeDebug } from "../../../utils/logger";
import { getString } from "../../../utils/locale";

/** Result of translating a single paragraph. */
export interface ParagraphTranslation {
  translated: string;
  /** True if this paragraph was a pure-formula placeholder and left untranslated. */
  skippedFormula: boolean;
  /** True if translation failed and the original text was kept as fallback. */
  failed: boolean;
}

/**
 * A translator function — injected rather than imported, so the pipeline stays
 * decoupled from the bridge wiring order and is testable with a stub.
 *
 * Implementations typically wrap LeaderoAPI.translate.translateText
 * (src/bridge/LeaderoAPI.ts:684-731), which already resolves the configured model
 * and includes a system prompt. The Phase 1 orchestrator passes a thin wrapper.
 */
export type ParagraphTranslator = (
  text: string,
  targetLanguage: string,
  sourceLanguage?: string,
) => Promise<string>;

/**
 * Translate a list of paragraph texts, preserving `{vn}` formula placeholders.
 *
 * @param texts Paragraph texts (possibly containing `{vn}`).
 * @param translate Injected translator.
 * @param targetLanguage e.g. "zh-CN".
 * @param sourceLanguage Optional source language hint.
 * @param concurrency Max parallel translation requests (converter.py uses a
 *   ThreadPoolExecutor). Defaults to 4.
 * @returns Translated texts aligned 1:1 with input; plus per-paragraph status.
 */
export async function translateParagraphs(
  texts: string[],
  translate: ParagraphTranslator,
  targetLanguage: string,
  sourceLanguage?: string,
  concurrency = 4,
): Promise<{ results: string[]; status: ParagraphTranslation[] }> {
  const results: string[] = new Array(texts.length).fill("");
  const status: ParagraphTranslation[] = new Array(texts.length);

  // Identify which paragraphs need translation (skip pure-formula + empty).
  const pureFormulaRe = /^\{v\d+\}$/;
  const tasks: Array<{ index: number; text: string }> = [];
  for (let i = 0; i < texts.length; i++) {
    const t = texts[i];
    if (!t || t.length === 0 || pureFormulaRe.test(t)) {
      results[i] = t; // passthrough
      status[i] = {
        translated: t,
        skippedFormula: pureFormulaRe.test(t),
        failed: false,
      };
    } else {
      tasks.push({ index: i, text: t });
    }
  }

  // Bounded-concurrency translation pool (converter.py: ThreadPoolExecutor.map)
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < tasks.length) {
      const current = cursor++;
      const { index, text } = tasks[current];
      // One retry with a short backoff before falling back to the original
      // text. This absorbs transient network/rate-limit errors (the audit
      // showed a real "9/9 paragraphs failed" case caused by an API blip)
      // without the complexity of a full exponential-backoff retry policy.
      let out: string | null = null;
      for (let attempt = 0; attempt < 2 && out === null; attempt++) {
        try {
          out = await translate(text, targetLanguage, sourceLanguage);
        } catch (e) {
          safeDebug("[z-search] translateParagraphs: " + e);
          if (attempt === 0) {
            await new Promise((r) => setTimeout(r, 500));
          }
        }
      }
      if (out !== null) {
        results[index] = out;
        status[index] = {
          translated: out,
          skippedFormula: false,
          failed: false,
        };
      } else {
        // Fallback: keep original on failure (better than dropping the paragraph).
        results[index] = text;
        status[index] = {
          translated: text,
          skippedFormula: false,
          failed: true,
        };
      }
    }
  }

  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(concurrency, tasks.length); i++)
    workers.push(worker());
  await Promise.all(workers);

  return { results, status };
}

/**
 * Build a system prompt that instructs the model to preserve `{vn}` formula
 * placeholders verbatim. converter.py's default translator doesn't add this
 * (it just says "preserve formulas"), but the placeholder syntax is more fragile
 * than prose formulas — models sometimes expand/rewrite `{v3}` as `{v 3}` or
 * translate the "v". The C stage tolerates spaces but NOT a translated "v",
 * so we make the constraint explicit.
 *
 * Use this when constructing the ParagraphTranslator wrapper.
 */
export function formulaPreservingPrompt(
  targetLangDesc: string,
  sourceLangDesc: string,
): string {
  return (
    `You are a professional translator. Translate the following text from ${sourceLangDesc} to ${targetLangDesc}.\n` +
    `Output ONLY the translated text, no explanations.\n` +
    `CRITICAL: The text contains tokens like {v0}, {v1}, {v2} that mark the position of mathematical formulas. ` +
    `You MUST preserve every such token EXACTLY as-is — same braces, same letter 'v', same number, in the correct ` +
    `position relative to the surrounding translated text. Do not translate, rename, expand, or renumber these tokens. ` +
    `For example, input "The result is {v0} where {v1} denotes..." must keep {v0} and {v1} intact.`
  );
}

/**
 * Result of a single batch translation call.
 */
export interface BatchTranslateResult {
  /** Translated texts, aligned 1:1 with the input. Always === input.length. */
  translations: string[];
  /** Indices that failed and kept original text (empty if all succeeded). */
  failedIndices: number[];
}

/**
 * A batch translator — translates multiple paragraphs in one LLM call.
 *
 * Implementations pack the input into one prompt, call the model, and split
 * the response back into exactly `texts.length` strings. MUST always return
 * exactly `texts.length` translations (never throw — fall back to per-paragraph
 * or original text internally). This guarantee is what lets the orchestrator
 * scatter results back positionally without a length assertion.
 */
export type BatchTranslator = (
  texts: string[],
  signal?: AbortSignal,
) => Promise<BatchTranslateResult>;

/** Per-page text arrays to translate. */
export interface BatchTranslationOptions {
  targetLanguage: string;
  /** Max input chars per chunk (derived from the model's context window). */
  inputBudgetChars: number;
  /** Max estimated output chars per chunk (derived from maxOutputTokens). */
  outputBudgetChars: number;
  /** Chunk-level concurrency (default 4). */
  concurrency?: number;
  /** Cooperative cancel signal — checked before each chunk dispatch. */
  signal?: AbortSignal;
  onProgress?: (msg: string) => void;
}

export interface BatchTranslationResult {
  /** Per-page translated arrays, aligned 1:1 with the input pageTexts. */
  translatedSets: string[][];
  /** Total paragraphs that failed and kept original text. */
  failedCount: number;
}

/**
 * Conservative expansion factor (output chars / input chars) per target
 * language. Used only for chunk-size estimation — the actual output length is
 * whatever the model produces, bounded by maxOutputTokens. CJK targets are
 * shorter than English source; Latin targets expand. Defaults to 1.5
 * (conservative) for unlisted languages.
 */
/** 语言（BCP-47 主子标签）→ 保守膨胀因子（输出字符 / 输入字符）。 */
const EXPANSION_FACTORS: Readonly<Record<string, number>> = {
  zh: 0.8,
  ja: 0.8,
  ko: 0.8,
  en: 1.6,
  de: 1.3,
  fr: 1.2,
  es: 1.2,
  it: 1.2,
  pt: 1.2,
  ar: 1.4,
  ru: 1.3,
  uk: 1.3,
};

export function expansionFactorForTarget(targetLanguage: string): number {
  const lang = (targetLanguage || "").split("-")[0].toLowerCase();
  return EXPANSION_FACTORS[lang] ?? 1.5;
}

/** A flattened translatable paragraph with its position in the page grid. */
interface FlatTask {
  pageIdx: number;
  paraIdx: number;
  text: string;
}

/**
 * Greedy, ORDER-PRESERVING bin-packer. Groups paragraphs into chunks whose
 * combined estimated output (and input) stays within the dual token budget.
 *
 * Unlike PaperAnalyzer.splitIntoChunks (which sorts by priority), this MUST
 * preserve document order — translation quality depends on contextual
 * continuity, and the scatter-back relies on positional alignment.
 *
 * A single paragraph whose estimated output exceeds `outputBudgetChars` gets
 * its own chunk (it can't be skipped — every paragraph must be translated or
 * preserved). Such oversized paragraphs may get truncated by maxTokens, which
 * is the best achievable outcome.
 */
export function planTranslationChunks(
  tasks: FlatTask[],
  inputBudgetChars: number,
  outputBudgetChars: number,
  expansionFactor: number,
): FlatTask[][] {
  const chunks: FlatTask[][] = [];
  let current: FlatTask[] = [];
  let curInput = 0;
  let curOutput = 0;

  const flush = (): void => {
    if (current.length > 0) {
      chunks.push(current);
      current = [];
      curInput = 0;
      curOutput = 0;
    }
  };

  for (const task of tasks) {
    const inChars = task.text.length;
    // Per-item JSON overhead: 2 quotes + comma + escaping margin in the
    // {"translations":["...","..."]} envelope. Without this, many short
    // paragraphs pack too densely and the real JSON output exceeds
    // maxOutputTokens → truncation → count mismatch → retry storm.
    const estOutChars = Math.ceil(inChars * expansionFactor) + 6;

    // Single paragraph exceeds output budget → its own chunk (can't skip it).
    if (estOutChars > outputBudgetChars) {
      flush();
      chunks.push([task]);
      continue;
    }

    // Adding would overflow either budget → start a new chunk.
    if (
      curOutput + estOutChars > outputBudgetChars ||
      curInput + inChars > inputBudgetChars
    ) {
      flush();
    }

    current.push(task);
    curInput += inChars;
    curOutput += estOutChars;
  }
  flush();
  return chunks;
}

/**
 * Translate ALL pages' paragraphs in cross-page, token-budgeted batches.
 *
 * This is the LLM-native replacement for the per-page per-paragraph loop.
 * It flattens every page into one global task list (breaking the page-boundary
 * isolation that hurt cross-paragraph coherence), chunks by token budget, and
 * dispatches each chunk as a single LLM call via the injected `batchTranslate`.
 *
 * Empty and pure-formula (`{vn}`) paragraphs are passed through untranslated
 * — they never enter a batch. Results are scattered back to per-page arrays
 * positionally, preserving the `translatedSets[i][j] ⟷ pageTexts[i][j]`
 * contract the renderer depends on.
 */
export async function translateAllPagesBatched(
  pageTexts: string[][],
  batchTranslate: BatchTranslator,
  options: BatchTranslationOptions,
): Promise<BatchTranslationResult> {
  const onProgress = options.onProgress ?? (() => {});
  const concurrency = options.concurrency ?? 4;
  const expansionFactor = expansionFactorForTarget(options.targetLanguage);

  const pureFormulaRe = /^\{v\d+\}$/;
  const tasks: FlatTask[] = [];
  for (let p = 0; p < pageTexts.length; p++) {
    for (let j = 0; j < pageTexts[p].length; j++) {
      const trimmed = (pageTexts[p][j] || "").trim();
      if (!trimmed || pureFormulaRe.test(trimmed)) continue;
      tasks.push({ pageIdx: p, paraIdx: j, text: pageTexts[p][j] });
    }
  }

  // All paragraphs were passthrough — return originals unchanged.
  if (tasks.length === 0) {
    return {
      translatedSets: pageTexts.map((page) => page.slice()),
      failedCount: 0,
    };
  }

  const chunks = planTranslationChunks(
    tasks,
    options.inputBudgetChars,
    options.outputBudgetChars,
    expansionFactor,
  );

  onProgress(
    getString("pdf-translate-batch-start", {
      args: {
        paragraphs: String(tasks.length),
        chunks: String(chunks.length),
      },
    }),
  );

  const translated = new Map<string, string>(); // `${pageIdx}:${paraIdx}` → text
  const failedKeys = new Set<string>();
  let completed = 0;

  const signal = options.signal;
  const sem = new Semaphore(Math.min(concurrency, chunks.length));
  await Promise.all(
    chunks.map(async (chunk) => {
      // Cooperative cancel: skip chunks not yet started.
      if (signal?.aborted) return;

      const release = await sem.acquire();
      // Re-check after waiting for the semaphore — may have queued a while.
      if (signal?.aborted) {
        release();
        return;
      }
      try {
        const inputTexts = chunk.map((t) => t.text);
        const result = await batchTranslate(inputTexts, signal);
        for (let i = 0; i < chunk.length; i++) {
          const key = `${chunk[i].pageIdx}:${chunk[i].paraIdx}`;
          translated.set(key, result.translations[i]);
          if (result.failedIndices.includes(i)) failedKeys.add(key);
        }
      } catch (e) {
        safeDebug("[z-search] translateParagraphs: " + e);
        // Defensive: batchTranslate contract says "never throws" (except on
        // cancel), but if a bug escapes, preserve original text rather than
        // rejecting Promise.all and orphaning other in-flight chunks.
        // Cancelled chunks keep original text without being counted as failed.
        const cancelled = signal?.aborted;
        for (const t of chunk) {
          const key = `${t.pageIdx}:${t.paraIdx}`;
          translated.set(key, t.text);
          if (!cancelled) failedKeys.add(key);
        }
      } finally {
        release();
        completed++;
        onProgress(
          getString("pdf-translate-batch-progress", {
            args: {
              done: String(completed),
              total: String(chunks.length),
            },
          }),
        );
      }
    }),
  );

  const translatedSets: string[][] = pageTexts.map((page, p) =>
    page.map((origText, j) => {
      const key = `${p}:${j}`;
      // `||` (not `??`) so an empty-string translation from the model doesn't
      // overwrite a non-empty original — data-loss guard flagged by review.
      return translated.get(key) || origText;
    }),
  );

  return { translatedSets, failedCount: failedKeys.size };
}
