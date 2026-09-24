/**
 * QueryExpander — query expansion + dedup helpers extracted from DiscoveryEngine.
 */

import type { IAIProvider } from "../../types/ai";
import { parseJsonFromMarkdown } from "../../utils/json";
import { SearchLearning } from "./SearchLearning";
import { QUERY_EXPANSION_STOP_WORDS } from "./DiscoveryTypes";
import { safeDebug } from "../../utils/logger";

/**
 * Expand a single query into 5-8 specialized subqueries.
 * query_expander.py.
 */
export async function expandQueryWithAI(
  provider: IAIProvider,
  query: string,
): Promise<{ expandedQueries: string[]; concepts: string[] }> {
  // Inject historical effective queries as reference
  const searchLearning = new SearchLearning();
  await searchLearning.hydrate();
  const effectiveHistory = searchLearning.getEffectiveQueries(5);
  const historySection =
    effectiveHistory.length > 0
      ? `\n## Historical Effective Queries (for reference, not mandatory)\n${effectiveHistory.map((e) => `- "${e.query}" (avgScore: ${e.avgScore})`).join("\n")}`
      : "";

  const prompt = `You are a scientific literature search expert. Split the following research query into 5-8 specialized sub-queries covering different angles.

## Original Query
${query}
${historySection}
## Splitting Rules
- Split by sub-direction: methodology, tools/databases, surveys/reviews, application scenarios, latest advances
- Generate queries in both English and Chinese
- Each query must be specific and executable
- Do not repeat the original query itself

## Output Format (pure JSON, no markdown)
{"expanded_queries":["EN query about method","中文查询关于应用","EN survey query","中文工具查询"],"concepts":["concept1","concept2"]}`;

  try {
    const response = await provider.execute({
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      maxTokens: 600,
    });

    const result = parseJsonFromMarkdown(response.content);
    if (!result) return ruleBasedExpand(query);

    const queries = (result.expanded_queries || []).filter(
      (q: string) => typeof q === "string" && q.length >= 10,
    );
    // Always include original query
    if (!queries.includes(query)) queries.unshift(query);

    return {
      expandedQueries: queries.slice(0, 8),
      concepts: (result.concepts || []).slice(0, 6),
    };
  } catch (e) {
    safeDebug("[z-search] QueryExpander.llmExpand failed: " + e);
    return ruleBasedExpand(query);
  }
}

/**
 * Rule-based fallback for query expansion when LLM fails.
 * Generates variants using keyword extraction and templates.
 */
export function ruleBasedExpand(query: string): {
  expandedQueries: string[];
  concepts: string[];
} {
  const expanded: string[] = [query];
  const concepts: string[] = [];

  const enKeywords = (query.match(/[a-zA-Z][a-zA-Z0-9-]{3,}/g) || []).filter(
    (w) => !QUERY_EXPANSION_STOP_WORDS.has(w.toLowerCase()),
  );

  const zhChars = query.match(/[\u4e00-\u9fff]+/g) || [];
  const zhBigrams: string[] = [];
  for (const segment of zhChars) {
    if (segment.length >= 2) {
      for (let i = 0; i < segment.length - 1; i++) {
        zhBigrams.push(segment.slice(i, i + 2));
      }
    }
  }

  const allTerms = [...enKeywords, ...zhBigrams];
  concepts.push(...allTerms.slice(0, 6));

  // Generate variants from top terms
  const topTerms = allTerms.slice(0, 3);
  const templates: ((t: string) => string)[] = [
    (t: string) => `${t} systematic review`,
    (t: string) => `${t} latest advances`,
    (t: string) => `${t} methodology comparison`,
  ];
  const seen = new Set([query.toLowerCase().trim()]);
  for (const t of topTerms) {
    for (const tmpl of templates) {
      const variant = tmpl(t);
      if (!seen.has(variant.toLowerCase().trim()) && variant.length >= 10) {
        expanded.push(variant);
        seen.add(variant.toLowerCase().trim());
      }
    }
  }

  return {
    expandedQueries: expanded.slice(0, 8),
    concepts: concepts.slice(0, 6),
  };
}

/**
 * Deduplicate queries using Jaccard similarity clustering.
 * decomposer.py `_deduplicate_queries`.
 *
 * 1. Tokenize: English words ≥3 chars, Chinese 2-grams, numbers
 * 2. Exact dedup (case-insensitive)
 * 3. Jaccard similarity > 0.5 clustering via Union-Find
 * 4. Per-cluster: prefer query ≥10 chars with ≥2 words, otherwise shortest
 */
export function deduplicateQueriesJaccard(queries: string[]): string[] {
  if (queries.length <= 1) return queries;

  // Tokenize: English words ≥3 chars + Chinese 2-grams + numbers
  function tokenize(text: string): Set<string> {
    const tokens = new Set<string>();
    // Chinese 2-grams
    const chineseChars = text.match(/[\u4e00-\u9fff]/g) || [];
    for (let i = 0; i < chineseChars.length - 1; i++) {
      tokens.add(chineseChars[i] + chineseChars[i + 1]);
    }
    // English words ≥3 chars and numbers
    const words = text.match(/[a-zA-Z]{3,}|\d+/g) || [];
    for (const w of words) tokens.add(w.toLowerCase());
    return tokens;
  }

  // Exact dedup (case-insensitive, trimmed)
  const seen = new Map<string, number>();
  const unique: string[] = [];
  for (const q of queries) {
    const key = q.trim().toLowerCase();
    if (!key) continue;
    if (!seen.has(key)) {
      seen.set(key, unique.length);
      unique.push(q.trim());
    }
  }
  if (unique.length <= 1) return unique;

  const tokenSets = unique.map(tokenize);

  // Union-Find
  const parent = unique.map((_, i) => i);
  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }
  function union(a: number, b: number): void {
    const ra = find(a),
      rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  // Cluster by Jaccard > 0.5
  for (let i = 0; i < unique.length; i++) {
    if (tokenSets[i].size === 0) continue;
    for (let j = i + 1; j < unique.length; j++) {
      if (tokenSets[j].size === 0) continue;
      let intersection = 0;
      for (const t of tokenSets[i]) {
        if (tokenSets[j].has(t)) intersection++;
      }
      const unionSize = tokenSets[i].size + tokenSets[j].size - intersection;
      if (unionSize > 0 && intersection / unionSize > 0.5) {
        union(i, j);
      }
    }
  }

  // Group by cluster root
  const clusters = new Map<number, number[]>();
  for (let i = 0; i < unique.length; i++) {
    const root = find(i);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root)!.push(i);
  }

  // Per-cluster: prefer query ≥10 chars with ≥2 words, else shortest
  const result: string[] = [];
  for (const indices of clusters.values()) {
    const best = indices.reduce((prev, idx) => {
      const q = unique[idx];
      const wordCount =
        (q.match(/[a-zA-Z]+/g) || []).length +
        (q.match(/[\u4e00-\u9fff]/g) || []).length;
      const prevQ = unique[prev];
      const prevWordCount =
        (prevQ.match(/[a-zA-Z]+/g) || []).length +
        (prevQ.match(/[\u4e00-\u9fff]/g) || []).length;

      // Prefer ≥10 chars with ≥2 words
      const prevGood = prevQ.length >= 10 && prevWordCount >= 2;
      const currGood = q.length >= 10 && wordCount >= 2;
      if (currGood && !prevGood) return idx;
      if (!currGood && prevGood) return prev;
      // Both good or both bad: prefer longer
      return q.length >= prevQ.length ? idx : prev;
    });
    result.push(unique[best]);
  }

  return result;
}
