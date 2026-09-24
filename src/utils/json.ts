/**
 * Safe JSON parse with fallback. Never throws.
 *
 * Returns `fallback` for null/undefined/empty input or unparseable JSON.
 * Centralizes the per-module definitions previously duplicated across stores,
 * version stores, prefs utils, and chat types.
 */
import { safeDebug } from "./logger";

export function safeJsonParse<T>(
  value: string | null | undefined,
  fallback: T,
): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch (e) {
    safeDebug("[z-search] " + e);
    return fallback;
  }
}

/**
 * Parse JSON from LLM response content. Never throws.
 *
 * Three-step fallback: markdown code block → direct JSON.parse → regex extract
 * of the first {...} object or [...] array. Returns null if all fail.
 *
 * Shared by SearchLearning / SearchPipeline / DiscoveryEngine. AcademicQueryAdapter
 * intentionally keeps a separate implementation that only matches objects
 * (Record<string,string>), not arrays.
 */
export function parseJsonFromMarkdown(content: string): any {
  if (!content) return null;
  const codeBlockMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch (e) {
      safeDebug("[z-search] " + e);
      // fall through
    }
  }
  try {
    return JSON.parse(content.trim());
  } catch (e) {
    safeDebug("[z-search] " + e);
    const jsonMatch = content.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1]);
      } catch (e) {
        safeDebug("[z-search] " + e);
        return null;
      }
    }
  }
  return null;
}

/**
 * Extract the first JSON object from free-form LLM output. Two candidates in
 * order — the fenced block (```json ... ```) then the raw text — and each one
 * is brace-sliced (first `{` … last `}`) before JSON.parse, which is the shape
 * facilitator/router output actually arrives in. Arrays parse through the same
 * path when they carry braces.
 *
 * Never throws and never logs (unlike parseJsonFromMarkdown): callers on the
 * router's free-text path treat null as "no JSON here" without extra noise.
 */
export function extractFirstJsonObject(text: string): unknown | null {
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = fence ? [fence[1], text] : [text];
  for (const candidate of candidates) {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end <= start) continue;
    try {
      const obj = JSON.parse(candidate.slice(start, end + 1));
      if (obj && typeof obj === "object") return obj;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/**
 * Shrink-to-valid JSON parse: when the object is truncated or trailed by prose,
 * walk backwards to every `}` and try the prefix, returning the first value that
 * parses plus how many candidates were tried (callers log that count on failure).
 *
 * Never throws and never logs — the per-attempt logging this replaced produced
 * one debug line per shrink step, while the attempt count already tells the same
 * story from the caller's single failure log.
 */
export function shrinkToValidJson(text: string): {
  value: unknown;
  attempts: number;
} {
  let attempts = 0;
  for (let end = text.length; end > 0; end--) {
    if (text[end - 1] !== "}") continue;
    attempts++;
    try {
      return { value: JSON.parse(text.slice(0, end)), attempts };
    } catch {
      // shorten and retry
    }
  }
  return { value: null, attempts };
}
