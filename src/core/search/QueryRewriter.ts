/**
 * Query Rewriter for Retrieval
 *
 * Rewrites vague user questions into search-optimized keywords
 * using a lightweight LLM call before retrieval operations.
 */

import AIProviderRegistry from "../ai/AIProviderRegistry";
import { getPrefDynamic } from "../../utils/prefs";
import { safeDebug } from "../../utils/logger";

const REWRITE_PROMPT = `Rewrite the following question into a search query optimized for finding relevant passages in academic papers.
Output ONLY the rewritten query — no explanation, no quotes.
Expand vague terms into specific academic keywords and synonyms.
Include likely section names (abstract, results, methods, discussion, conclusion) if relevant.`;

// Session-level cache to avoid re-rewriting the same query
const sessionCache = new Map<string, string>();
const MAX_CACHE = 100;

/** LLM 改写超时（ms）：改写是检索增强不是硬依赖，超时回落原查询。无上限时
 *  慢端点会把 searchByQuery 一路挂到客户端桥超时（2026-09-16 审计 A1：
 *  semantic.search 30s 超时的候选挂点之一）。 */
const REWRITE_TIMEOUT_MS = 8_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("query-rewrite timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function isSpecificQuery(query: string): boolean {
  const trimmed = query.trim();
  // DOI
  if (/^10\.\d{4,}/.test(trimmed)) return true;
  // Quoted exact title
  if (/^".+"$/.test(trimmed)) return true;
  // URL
  if (/^https?:\/\//.test(trimmed)) return true;
  // Too short
  if (trimmed.length < 5) return true;
  return false;
}

export async function rewriteQuery(query: string): Promise<string> {
  if (isSpecificQuery(query)) return query;

  // Respect user preference
  const enabled = getPrefDynamic("search.queryRewrite") as boolean;
  if (enabled === false) return query;

  const key = query.toLowerCase().trim();
  if (sessionCache.has(key)) return sessionCache.get(key)!;

  try {
    const provider = AIProviderRegistry.getProviderForFeature("chat");
    if (!provider) return query;

    const result = await withTimeout(
      provider.execute({
        messages: [
          { role: "user", content: `${REWRITE_PROMPT}\n\nQuestion: ${query}` },
        ],
        temperature: 0,
        maxTokens: 100,
      }),
      REWRITE_TIMEOUT_MS,
    );

    const rewritten = (result.content || "").trim();
    if (!rewritten || rewritten.length < 2) return query;

    // Evict if cache full
    if (sessionCache.size >= MAX_CACHE) {
      const oldest = sessionCache.keys().next().value;
      if (oldest !== undefined) sessionCache.delete(oldest);
    }
    sessionCache.set(key, rewritten);

    return rewritten;
  } catch (e) {
    safeDebug("[z-search] QueryRewriter.rewriteQuery failed: " + e);
    return query;
  }
}

export function clearQueryCache(): void {
  sessionCache.clear();
}
