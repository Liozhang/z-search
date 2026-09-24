/**
 * SearchLearning — Cross-session search effectiveness learning system.
 *
 * Records search results, persists them via MemoryStore, and provides
 * queries for effective/ineffective patterns. Includes LLM-driven
 * discovery of new search terms from high-quality papers.
 */

import type { FusionPaper } from "./searchTypes";
import MemoryStore from "../memory/MemoryStore";
import AIProviderRegistry from "../ai/AIProviderRegistry";
import { parseJsonFromMarkdown } from "../../utils/json";
import { safeDebug } from "../../utils/logger";

export interface SearchLearningEntry {
  query: string;
  resultCount: number;
  avgScore: number;
  topDomains: string[];
  timestamp: number;
}

interface DiscoverResult {
  newQueries: string[];
  newDomains: string[];
}

const SOUL_ID = "search-learning";
const TIER = "facts";
const KEY_PREFIX = "query:";
const MAX_ENTRIES = 200;
const EFFECTIVE_AVG_THRESHOLD = 60;
const EFFECTIVE_COUNT_THRESHOLD = 3;
const INEFFECTIVE_AVG_THRESHOLD = 30;
const HIGH_QUALITY_SCORE_THRESHOLD = 70;

// parseJsonFromMarkdown now imported from ../../utils/json (shared with
// SearchPipeline and DiscoveryEngine).

export class SearchLearning {
  private entries: SearchLearningEntry[] = [];
  private dirty = false;

  // ---------- Core Recording ----------

  /**
   * Record a search result in memory. Call persist() later to save.
   */
  recordSearchResult(query: string, results: FusionPaper[]): void {
    const normalizedQuery = query.toLowerCase().trim();
    if (!normalizedQuery || results.length === 0) return;

    const scores = results.map((r) => r.fusedScore);
    const avgScore = scores.reduce((sum, s) => sum + s, 0) / scores.length;

    const domainMap = new Map<string, number>();
    for (const paper of results) {
      const domain = this.extractDomain(paper.url);
      if (domain) {
        domainMap.set(domain, (domainMap.get(domain) ?? 0) + 1);
      }
    }
    const topDomains = Array.from(domainMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([d]) => d);

    const entry: SearchLearningEntry = {
      query: normalizedQuery,
      resultCount: results.length,
      avgScore,
      topDomains,
      timestamp: Date.now(),
    };

    const existingIdx = this.entries.findIndex(
      (e) => e.query === normalizedQuery,
    );
    if (existingIdx >= 0) {
      const existing = this.entries[existingIdx];
      // Keep the entry with better avgScore, or refresh timestamp on equal
      // score so stale low-quality entries can eventually age out.
      if (entry.avgScore > existing.avgScore) {
        this.entries[existingIdx] = entry;
      } else if (entry.avgScore === existing.avgScore) {
        existing.timestamp = entry.timestamp;
        existing.resultCount = Math.max(
          existing.resultCount,
          entry.resultCount,
        );
      }
      // If entry.avgScore < existing.avgScore, keep the existing entry
      // but still allow the timestamp to drift so it can eventually
      // be superseded by newer queries with similar scores.
    } else {
      this.entries.push(entry);
    }

    this.dirty = true;
  }

  // ---------- Query Retrieval ----------

  /**
   * Get historically effective queries (avgScore >= 60, resultCount >= 3).
   * Sorted by avgScore descending.
   */
  getEffectiveQueries(limit: number = 20): SearchLearningEntry[] {
    return this.entries
      .filter(
        (e) =>
          e.avgScore >= EFFECTIVE_AVG_THRESHOLD &&
          e.resultCount >= EFFECTIVE_COUNT_THRESHOLD,
      )
      .sort((a, b) => b.avgScore - a.avgScore)
      .slice(0, limit);
  }

  /**
   * Get historically ineffective queries (avgScore < 30).
   * Sorted by avgScore ascending (worst first).
   */
  getIneffectiveQueries(limit: number = 20): string[] {
    return this.entries
      .filter((e) => e.avgScore < INEFFECTIVE_AVG_THRESHOLD)
      .sort((a, b) => a.avgScore - b.avgScore)
      .slice(0, limit)
      .map((e) => e.query);
  }

  /**
   * Get domains associated with high-scoring results.
   * Returns Map<domain, frequency> sorted by frequency descending.
   * Only includes domains from entries with avgScore >= 60.
   */
  getHighQualityDomains(): Map<string, number> {
    const domainScores = new Map<string, { total: number; count: number }>();

    for (const entry of this.entries) {
      if (entry.avgScore < EFFECTIVE_AVG_THRESHOLD) continue;
      for (const domain of entry.topDomains) {
        const existing = domainScores.get(domain) || { total: 0, count: 0 };
        existing.total += entry.avgScore;
        existing.count += 1;
        domainScores.set(domain, existing);
      }
    }

    const result = new Map<string, number>();
    for (const [domain, stats] of domainScores) {
      const domainAvgScore = stats.total / stats.count;
      if (domainAvgScore >= EFFECTIVE_AVG_THRESHOLD) {
        result.set(domain, stats.count);
      }
    }

    const sorted = Array.from(result.entries()).sort((a, b) => b[1] - a[1]);
    const sortedMap = new Map<string, number>();
    for (const [domain, count] of sorted) {
      sortedMap.set(domain, count);
    }
    return sortedMap;
  }

  // ---------- LLM-Driven Discovery ----------

  /**
   * Discover new search queries and domains from high-quality papers.
   * Filters papers with fusedScore >= 70, summarizes up to 10 papers,
   * and calls LLM to extract new search directions.
   *
   * Returns empty arrays if LLM is unavailable or fails.
   */
  async discoverFromHighQuality(
    papers: FusionPaper[],
    query: string,
  ): Promise<DiscoverResult> {
    const empty: DiscoverResult = { newQueries: [], newDomains: [] };

    const highQuality = papers.filter(
      (p) => p.fusedScore >= HIGH_QUALITY_SCORE_THRESHOLD,
    );
    if (highQuality.length === 0) return empty;

    const summaries = highQuality.slice(0, 10).map((p, i) => {
      const tags = (p.tags || []).join(", ");
      const abstract = (p.abstract || "").slice(0, 200);
      return `${i + 1}. [${p.title}] ${abstract}${tags ? ` | tags: ${tags}` : ""}`;
    });

    const prompt = `You are an academic search strategy expert. Based on the following high-quality papers, discover new search directions.

## Original Query
${query}

## High-Quality Papers (score >= 70)
${summaries.join("\n")}

## Known Effective Queries
${this.getEffectiveQueries(10)
  .map((e) => `- "${e.query}" (score: ${e.avgScore.toFixed(0)})`)
  .join("\n")}

## High-Quality Domains
${Array.from(this.getHighQualityDomains().entries())
  .slice(0, 10)
  .map(([d, c]) => `- ${d} (${c} occurrences)`)
  .join("\n")}

## Task
1. Analyze common themes and technical directions across these high-quality papers
2. Extract new search terms not covered by the original query (new_search_queries)
3. Identify new academic domains worth whitelisting (new_domains_for_whitelist)

## Output Format (pure JSON, no markdown code block)
{"new_search_queries":["query1","query2","query3"],"new_domains_for_whitelist":["domain1","domain2"]}`;

    const provider = AIProviderRegistry.getProviderForFeature("chat");
    if (!provider) return empty;

    try {
      const response = await provider.execute({
        messages: [{ role: "user", content: prompt }],
        temperature: 0.4,
        maxTokens: 600,
        feature: "search-learning",
      });

      const parsed = parseJsonFromMarkdown(response.content);
      if (!parsed) return empty;

      return {
        newQueries: Array.isArray(parsed.new_search_queries)
          ? parsed.new_search_queries.filter(
              (q: any) => typeof q === "string" && q.trim().length > 0,
            )
          : [],
        newDomains: Array.isArray(parsed.new_domains_for_whitelist)
          ? parsed.new_domains_for_whitelist.filter(
              (d: any) => typeof d === "string" && d.trim().length > 0,
            )
          : [],
      };
    } catch (e) {
      safeDebug("[z-search] SearchLearning.parseLLMResponse failed: " + e);
      return empty;
    }
  }

  // ---------- Persistence ----------

  /**
   * Persist all entries to MemoryStore.
   * Each query is stored as a separate entry with key = "query:<normalizedQuery>".
   */
  async persist(): Promise<void> {
    if (!this.dirty) return;

    try {
      await MemoryStore.initialize();

      // Prune: keep only top MAX_ENTRIES by avgScore
      const toKeep = [...this.entries]
        .sort((a, b) => b.avgScore - a.avgScore)
        .slice(0, MAX_ENTRIES);

      for (const entry of toKeep) {
        const key = `${KEY_PREFIX}${entry.query}`;
        const id = `${SOUL_ID}:${key}`;
        const _now = Date.now();

        const existing = await MemoryStore.getByKey(SOUL_ID, key, TIER);
        if (existing) {
          const existingData: SearchLearningEntry = JSON.parse(
            existing.content,
          );
          if (entry.avgScore > existingData.avgScore) {
            await MemoryStore.update(existing.id, {
              content: JSON.stringify(entry),
            });
          }
        } else {
          await MemoryStore.create({
            id,
            soulId: SOUL_ID,
            tier: TIER,
            key,
            content: JSON.stringify(entry),
            timestamp: entry.timestamp,
          });
        }
      }

      this.entries = toKeep;
      this.dirty = false;
    } catch (e) {
      safeDebug("[z-search] SearchLearning.persist failed: " + e);
      // Persistence failure should not crash the caller
    }
  }

  /**
   * Restore entries from MemoryStore into memory.
   */
  async hydrate(): Promise<void> {
    try {
      await MemoryStore.initialize();

      const stored = await MemoryStore.getFacts(SOUL_ID);
      this.entries = stored
        .filter((e) => e.key?.startsWith(KEY_PREFIX))
        .map((e) => {
          try {
            return JSON.parse(e.content) as SearchLearningEntry;
          } catch (e) {
            safeDebug(
              "[z-search] SearchLearning.hydrate: entry JSON parse failed: " +
                e,
            );
            return null;
          }
        })
        .filter((e): e is SearchLearningEntry => e !== null);

      this.dirty = false;
    } catch (e) {
      safeDebug("[z-search] SearchLearning.hydrate failed: " + e);
      this.entries = [];
    }
  }

  // ---------- Utilities ----------

  private extractDomain(url: string): string | null {
    try {
      const parsed = new URL(url);
      return parsed.hostname.replace(/^www\./, "");
    } catch (e) {
      safeDebug(
        "[z-search] SearchLearning.extractDomain(" + url + ") failed: " + e,
      );
      return null;
    }
  }
}
