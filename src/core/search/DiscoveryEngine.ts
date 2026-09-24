/**
 * DiscoveryEngine — AI-powered academic discovery orchestrator.
 *
 * Facade over extracted modules:
 *   - QueryExpander: AI/rule-based query expansion + Jaccard dedup
 *   - PaperEvaluator: AI batch evaluation + domain/title filtering + library dedup
 *   - DiscoveryConfig: blacklist/whitelist persistence
 */

import AIProviderRegistry from "../ai/AIProviderRegistry";
import type { IAIProvider } from "../../types/ai";
import { parseJsonFromMarkdown } from "../../utils/json";
import type {
  RelatedConcept,
  DiscoveredPaper,
  ResearchSuggestion,
  DiscoveryBlacklist,
  DiscoveryFilterConfig,
} from "./DiscoveryTypes";
import { CONCEPT_MEMORY_PREFIX } from "./DiscoveryTypes";
import {
  expandQueryWithAI as expandQueryWithAIImpl,
  ruleBasedExpand,
  deduplicateQueriesJaccard,
} from "./QueryExpander";
import {
  aiEvaluatePapers,
  filterByDomain,
  isInLibrary as isInLibraryImpl,
  deduplicate as deduplicateImpl,
} from "./PaperEvaluator";
import {
  getBlacklist,
  addToBlacklist as addToBlacklistImpl,
  removeFromBlacklist as removeFromBlacklistImpl,
  getWhitelist,
  addToWhitelist as addToWhitelistImpl,
  removeFromWhitelist as removeToWhitelistImpl,
  getFilterConfig,
} from "./DiscoveryConfig";
import { safeDebug } from "../../utils/logger";

export { deduplicateQueriesJaccard } from "./QueryExpander";
export { filterByTitleKeywords, filterByDomain } from "./PaperEvaluator";

class DiscoveryEngine {
  private constructorProvider?: IAIProvider;
  private blacklist: DiscoveryBlacklist;
  private whitelist: { domains: string[]; journals: string[] };

  constructor(provider?: IAIProvider) {
    this.constructorProvider = provider;
    this.blacklist = getBlacklist();
    this.whitelist = getWhitelist();
  }

  private getProvider(): IAIProvider | null {
    if (this.constructorProvider) return this.constructorProvider;
    return AIProviderRegistry.getProviderForFeature("chat");
  }

  isAvailable(): boolean {
    return this.getProvider() !== null;
  }

  /**
   * AI extracts related concepts and generates search queries from a paper.
   * Called passively after AutoAnalyzer finishes.
   */
  async extractConceptsWithAI(item: any): Promise<{
    concepts: RelatedConcept[];
    suggestedQueries: string[];
  }> {
    const provider = this.getProvider();
    if (!provider) return { concepts: [], suggestedQueries: [] };

    const title = item.getField("title") || "";
    const abstract = item.getField("abstractNote") || "";
    const tags = (item.getTags?.() || [])
      .map((t: any) => (typeof t === "string" ? t : t.tag || ""))
      .filter((t: string) => !t.startsWith("AI-"))
      .join(", ");

    if (!title && !abstract) return { concepts: [], suggestedQueries: [] };

    const prompt = `You are an academic research analysis expert. Extract related concepts and potential search directions from the following paper.

## Paper Information
Title: ${title}
Abstract: ${abstract.slice(0, 2000)}
Tags: ${tags || "None"}

## Task
1. Extract 5-8 core concepts (methods, datasets, frameworks, theories, techniques)
2. Determine the type and relevance for each concept
3. Based on these concepts, generate 3-5 search queries that can be used to discover related papers
4. Queries should cover: same method applied to different domains, same domain with different methods, extended/improved methods
5. Generate queries in both English and Chinese

## Output Format (pure JSON, no markdown code block)
{"concepts":[{"concept":"concept name in English","conceptZh":"concept name in Chinese","type":"method|dataset|framework|domain|technique|theory","relevance":0.9,"context":"the role of this concept in the paper"}],"suggestedQueries":["English query","Chinese query"]}`;

    try {
      const response = await provider.execute({
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        maxTokens: 800,
      });

      const json = parseJsonFromMarkdown(response.content);
      return {
        concepts: (json?.concepts || []).filter(
          (c: any) => c.concept && c.relevance >= 0.3,
        ),
        suggestedQueries: json?.suggestedQueries || [],
      };
    } catch (e) {
      safeDebug(
        "[z-search] DiscoveryEngine.extractConceptsFromItem failed: " + e,
      );
      return { concepts: [], suggestedQueries: [] };
    }
  }

  /**
   * Discover related papers using AI-generated queries + AI evaluation.
   */
  async discoverRelated(
    item: any,
    maxResults?: number,
  ): Promise<{
    papers: DiscoveredPaper[];
    queries: string[];
    concepts: RelatedConcept[];
  }> {
    const provider = this.getProvider();
    if (!provider) {
      return { papers: [], queries: [], concepts: [] };
    }

    const max = maxResults || 15;

    // Step 1: AI extracts concepts + generates queries
    const { concepts, suggestedQueries } =
      await this.extractConceptsWithAI(item);

    // Step 2: Multi-query parallel search
    const allPapers: any[] = [];
    const academicSearch = (
      await import("../tool/builtin/handlers/academic-search")
    ).default;

    for (const query of suggestedQueries.slice(0, 5)) {
      try {
        const result = await academicSearch.callSearchAPI(
          "openalex",
          query,
          undefined,
          10,
        );
        if (result.articles) {
          for (const a of result.articles) {
            a._queryOrigin = query;
          }
          allPapers.push(...result.articles);
        }
      } catch (e) {
        safeDebug(
          "[z-search] DiscoveryEngine.discoverRelated query failed: " + e,
        );
        // individual query failure is non-critical
      }
    }

    // Step 3: Deduplicate + filter domain whitelist/blacklist + filter already-in-library
    const deduped = deduplicateImpl(allPapers);
    const filtered = filterByDomain(deduped, getFilterConfig());
    const originalDoi = (item.getField("DOI") || "").trim().toLowerCase();

    const notInLibrary: any[] = [];
    for (const paper of filtered) {
      const doi = (paper.doi || "").trim().toLowerCase();
      if (doi && doi === originalDoi) continue;
      if (doi && (await isInLibraryImpl(doi))) continue;
      notInLibrary.push(paper);
    }

    // Step 4: AI batch evaluate relevance
    const papersToEvaluate = notInLibrary.slice(0, 30);
    if (papersToEvaluate.length === 0) {
      return { papers: [], queries: suggestedQueries, concepts };
    }

    // Step 4.5: Decision-model triage (opt-in, decision.mode). High-confidence
    // bands bypass the LLM evaluation; mid band + any failure fall through to
    // the legacy path below — ensemble structure, legacy behavior intact.
    const sourceTitle = item.getField("title") || "";
    const { triagePapers } = await import("../decision/screeningTriage");
    const triage = await triagePapers(papersToEvaluate, sourceTitle, concepts);

    const evaluated = await aiEvaluatePapers(
      provider,
      sourceTitle,
      concepts,
      triage.midBand,
      this.getBlacklist(),
    );

    return {
      papers: [...evaluated, ...triage.autoInclude]
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .slice(0, max),
      queries: suggestedQueries,
      concepts,
    };
  }

  /**
   * AI analyzes the entire library's concept landscape,
   * identifies knowledge gaps, and suggests new search directions.
   */
  async generateLibrarySuggestions(): Promise<ResearchSuggestion[]> {
    const provider = this.getProvider();
    if (!provider) return [];

    // Collect all discovery concepts from memory
    const { getFacts } = await import("../tool/builtin/atomic/memory-observer");
    const facts = await getFacts();
    const conceptFacts = facts.filter((f) =>
      f.key.startsWith(CONCEPT_MEMORY_PREFIX),
    );

    if (conceptFacts.length < 3) return [];

    // Frequency analysis
    const conceptFreq = new Map<string, number>();
    for (const f of conceptFacts) {
      const name = f.key.replace(CONCEPT_MEMORY_PREFIX, "");
      conceptFreq.set(name, (conceptFreq.get(name) ?? 0) + 1);
    }
    const topConcepts = [...conceptFreq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([name, freq]) => `${name}(×${freq})`)
      .join(", ");

    const prompt = `You are a research direction advisor. Based on the user's library research directions, identify knowledge gaps and recommend new exploration directions.

## User's Current Research Directions (sorted by frequency)
${topConcepts}

## Task
1. Identify 3-5 knowledge gaps (method exists but lacks application / domain exists but lacks method / missing latest advances)
2. Generate 2-3 specific search queries for each gap (in English and Chinese)
3. Evaluate priority

## Output Format (pure JSON array)
[{"gapDescription":"User has multiple papers on XX method but hasn't explored YY application","suggestedQueries":["query1","查询2"],"relatedConcepts":["c1","c2"],"priority":"high","reasoning":"XX is a core direction, YY is a natural extension"}]`;

    try {
      const response = await provider.execute({
        messages: [{ role: "user", content: prompt }],
        temperature: 0.4,
        maxTokens: 1000,
      });

      return parseJsonFromMarkdown(response.content) || [];
    } catch (e) {
      safeDebug(
        "[z-search] DiscoveryEngine.extractConceptsFromText failed: " + e,
      );
      return [];
    }
  }

  /**
   * Store extracted concepts into memory for accumulated learning.
   * Uses memory-observer.rememberFact for dedup + TTL handling.
   */
  async storeDiscovery(
    itemId: number,
    concepts: RelatedConcept[],
    queries: string[],
  ): Promise<void> {
    if (concepts.length === 0 && queries.length === 0) return;

    const { rememberFact } =
      await import("../tool/builtin/atomic/memory-observer");

    // Store each concept as a separate fact
    for (const concept of concepts.slice(0, 8)) {
      const key = `${CONCEPT_MEMORY_PREFIX}${concept.concept.toLowerCase().replace(/\s+/g, "-")}`;
      const content = `${concept.concept}|${concept.type}|${concept.context}|source:${itemId}`;
      await rememberFact(key, content, "90d", "reference").catch((e) => {
        safeDebug("[z-search] DiscoveryEngine: rememberFact failed: " + e);
      });
    }

    // Store queries for gap analysis
    for (const query of queries.slice(0, 5)) {
      const hash = query.toLowerCase().replace(/\s+/g, "-").slice(0, 60);
      const key = `discovery:query:${hash}`;
      const content = `${query}|source:${itemId}`;
      await rememberFact(key, content, "30d", "reference").catch((e) => {
        safeDebug("[z-search] DiscoveryEngine: rememberFact failed: " + e);
      });
    }
  }

  getBlacklist(): DiscoveryBlacklist {
    return this.blacklist;
  }

  addToBlacklist(type: "domains" | "journals", value: string): void {
    addToBlacklistImpl(type, value);
    this.blacklist = getBlacklist();
  }

  removeFromBlacklist(type: "domains" | "journals", value: string): void {
    removeFromBlacklistImpl(type, value);
    this.blacklist = getBlacklist();
  }

  getWhitelist(): { domains: string[]; journals: string[] } {
    return this.whitelist;
  }

  addToWhitelist(type: "domains" | "journals", value: string): void {
    addToWhitelistImpl(type, value);
    this.whitelist = getWhitelist();
  }

  removeFromWhitelist(type: "domains" | "journals", value: string): void {
    removeToWhitelistImpl(type, value);
    this.whitelist = getWhitelist();
  }

  getFilterConfig(): DiscoveryFilterConfig {
    return {
      blacklist: this.blacklist,
      whitelist: this.whitelist,
    };
  }

  /**
   * Expand a single query into 5-8 specialized subqueries.
   * query_expander.py.
   */
  async expandQueryWithAI(query: string): Promise<{
    expandedQueries: string[];
    concepts: string[];
  }> {
    const provider = this.getProvider();
    if (!provider) return ruleBasedExpand(query);
    return expandQueryWithAIImpl(provider, query);
  }

  private async isInLibrary(doi: string): Promise<boolean> {
    return isInLibraryImpl(doi);
  }

  private deduplicate(articles: any[]): any[] {
    return deduplicateImpl(articles);
  }

  /**
   * Decompose roundup (multi-event) articles into sub-events with search queries.
   * decomposer.py.
   */
  async decomposeRoundup(
    papers: Array<{ title: string; abstract: string; url?: string }>,
  ): Promise<{
    subQueries: string[];
    events: Array<{ title: string; queries: string[] }>;
  }> {
    const provider = this.getProvider();
    if (!provider || papers.length === 0) return { subQueries: [], events: [] };

    const summaries = papers.map((p) => ({
      t: (p.title || "").slice(0, 200),
      a: (p.abstract || "").slice(0, 500),
    }));

    const prompt = `You are a tech intelligence analysis expert. The following articles contain multiple independent sub-events/topics. Decompose each into independent sub-events.

## Articles to Decompose
${JSON.stringify(summaries)}

## Rules
- Each sub-event must have: an independent title, a one-sentence summary
- Generate 2-3 search queries for each sub-event (in both English and Chinese), for tracking related papers
- Only decompose articles that genuinely contain multiple independent topics

## Output Format (pure JSON, no markdown)
{"events":[{"title":"Sub-event title","queries":["EN search query","中文搜索查询"]}]}`;

    try {
      const response = await provider.execute({
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        maxTokens: 1000,
      });

      const result = parseJsonFromMarkdown(response.content);
      if (!result?.events || !Array.isArray(result.events)) {
        return { subQueries: [], events: [] };
      }

      const events = result.events
        .filter((e: any) => e.title && e.queries?.length)
        .map((e: any) => ({
          title: e.title as string,
          queries: (e.queries as string[]).filter((q) => q.length >= 5),
        }));

      // Deduplicate queries using Jaccard similarity (ported from decomposer.py)
      const allQueries = events.flatMap(
        (e: { title: string; queries: string[] }) => e.queries,
      );
      const dedupedQueries = deduplicateQueriesJaccard(allQueries);

      return { subQueries: dedupedQueries, events };
    } catch (e) {
      safeDebug("[z-search] DiscoveryEngine.decomposeRoundup failed: " + e);
      return { subQueries: [], events: [] };
    }
  }

  /**
   * Discover new search queries from high-quality results.
   * discoverer.py.
   */
  async discoverNewQueries(
    papers: Array<{
      title: string;
      abstract: string;
      source?: string;
      citationCount?: number;
      fusedScore?: number;
    }>,
  ): Promise<{
    newSearchQueries: string[];
    newDomains: string[];
    trendingTopics: string[];
    summary: string;
  }> {
    const provider = this.getProvider();
    if (!provider || papers.length === 0) {
      return {
        newSearchQueries: [],
        newDomains: [],
        trendingTopics: [],
        summary: "",
      };
    }

    const summaries = papers.slice(0, 15).map((p) => ({
      t: (p.title || "").slice(0, 150),
      a: (p.abstract || "").slice(0, 200),
      s: p.source || "",
      c: p.citationCount ?? 0,
    }));

    const prompt = `You are a technical domain resource discovery expert. Discover new research directions and resources from the following high-quality search results.

## High-Quality Search Results
${JSON.stringify(summaries)}

## Task
1. Generate 3-5 new search queries (specific method names/tool names, not generic queries)
2. Discover 1-3 high-quality new domains (sources cited in the articles)
3. Identify 2-3 trending topics
4. One-sentence summary

## Output Format (pure JSON, no markdown)
{"new_search_queries":["query1","query2"],"new_domains":["domain1.com"],"trending_topics":["topic1"],"summary":"one-sentence summary"}`;

    try {
      const response = await provider.execute({
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        maxTokens: 600,
      });

      const result = parseJsonFromMarkdown(response.content);
      return {
        newSearchQueries: (result?.new_search_queries || []).filter(
          (q: any) => typeof q === "string" && q.length >= 5,
        ),
        newDomains: (result?.new_domains || []).filter(
          (d: any) => typeof d === "string",
        ),
        trendingTopics: result?.trending_topics || [],
        summary: result?.summary || "",
      };
    } catch (e) {
      safeDebug("[z-search] DiscoveryEngine.discoverNewQueries failed: " + e);
      return {
        newSearchQueries: [],
        newDomains: [],
        trendingTopics: [],
        summary: "",
      };
    }
  }
}

const discoveryEngine = new DiscoveryEngine();
export default discoveryEngine;
export { DiscoveryEngine };
