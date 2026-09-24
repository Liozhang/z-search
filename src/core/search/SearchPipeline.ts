/**
 * SearchPipeline — Multi-round iterative deep search engine.
 *
 * Ported from CrawlerScheduler (src/scheduler.py),
 * adapted to Leadero's TypeScript / Zotero plugin environment.
 *
 * Architecture: Agent calls `deep-search` once → Pipeline runs N rounds internally.
 * Each round: search → filter → full-text fetch → heuristic scoring → AI evaluation
 *             → score fusion → event decomposition → query discovery → next round.
 */

import discoveryEngine from "./DiscoveryEngine";
import qualityMemory from "./SearchQualityFilter";
import academicSearchHandlers from "../tool/builtin/handlers/academic-search";
import { resolveArticleFullText } from "./FullTextResolver";
import { heuristicScoreSearchResult } from "./scoring/search-result-scorer";
import { fuseScores } from "./scoring/score-fusion";
import { DEFAULT_AI_WEIGHT } from "../../utils/constants";
import {
  deduplicateQueriesJaccard,
  filterByTitleKeywords,
  filterByDomain,
} from "./DiscoveryEngine";
import AIProviderRegistry from "../ai/AIProviderRegistry";
import {
  AcademicQueryAdapter,
  type AdaptedQueries,
} from "./AcademicQueryAdapter";
import {
  scoreAcademicArticle,
  prefetchMetrics,
} from "./scoring/academic-scorer";
import { SearchLearning } from "./SearchLearning";
import type { FusionPaper } from "./searchTypes";
import { SAFE_BATCH_SIZE } from "../../utils/constants";
import { parseJsonFromMarkdown } from "../../utils/json";
import { safeDebug } from "../../utils/logger";
import { toErrorMessage } from "../../utils/error";
import { isSourceAvailable } from "../sources/academic-search/utils";

export interface SearchPipelineConfig {
  query: string;
  maxRounds: number; // default: 3, max: 5
  maxResultsPerRound: number; // default: 20
  maxTotalResults: number; // default: 50
  sources?: string[]; // academic API list
  includeReviewSearch?: boolean; // Phase A: comprehensive review/survey search
  scoreThreshold: number; // default: 50
  aiWeight: number; // default: DEFAULT_AI_WEIGHT
  /**
   * 全文抓取开关（2026-09-23 立法：默认检索只到 summary 水平——题录+摘要。
   * 开启后每篇幸存文章多付 PMC 解析 / OA 网页抓取的网络成本，换来
   * 全文维度的启发式加分与证据库全文 note；默认关闭时评分退化为
   * 摘要维度，totalFullTextFetched 恒 0。需要全文请用
   * `resolveArticleFullText` 按需单篇拉取。 */
  fetchFullText?: boolean; // default: false
  abortSignal?: AbortSignal; // for cancellation support
}

export { FusionPaper } from "./searchTypes";

export interface PipelineResult {
  papers: FusionPaper[];
  metadata: {
    rounds: number;
    totalSearched: number;
    totalEvaluated: number;
    totalFullTextFetched: number;
    queriesByRound: string[][];
    discoveredQueries: string[];
    decomposedEvents: Array<{ title: string; queries: string[] }>;
    scoreDistribution: { high: number; medium: number; low: number };
    /** Number of papers where AI evaluation failed (fusedScore capped at heuristicScore*0.6, max 50) */
    aiFallbackCount: number;
    /** Queries enriched from review papers (Phase A → Phase B bridge) */
    enrichedQueriesFromReviews?: string[];
    /** Number of review/survey papers found in Phase A (for landscape highlighting) */
    reviewPaperCount?: number;
    /** F-31（回退审计 2026-09-11，P1）：本轮完全失败的数据源名单——聚合结果
     *  曾把失败源静默丢弃，用户以为覆盖完整。UI 可提示"X 个来源失败"。 */
    failedSources?: string[];
    /** F-37：库内 DOI 去重因 DB 故障被跳过——结果可能含已入库条目。 */
    libraryDedupSkipped?: boolean;
  };
}

const DEFAULT_SOURCES = [
  "openalex",
  "semantic-scholar",
  "crossref",
  "arxiv",
  "europe-pmc",
  "pubmed",
];
const QUERIES_PER_ROUND = 5;

class SearchPipeline {
  private config: SearchPipelineConfig;
  /** F-31：单次 run 内完全失败的数据源（跨轮去重收集）。 */
  private failedSources = new Set<string>();
  /** F-37：库内 DOI 去重因 DB 故障被跳过（结果可能含已入库条目）。 */
  private libraryDedupSkipped = false;

  constructor(config: SearchPipelineConfig) {
    this.config = {
      maxRounds: Math.min(config.maxRounds || 3, 5),
      maxResultsPerRound: config.maxResultsPerRound ?? 20,
      maxTotalResults: config.maxTotalResults ?? 50,
      sources: (config.sources?.length
        ? config.sources
        : DEFAULT_SOURCES
      ).filter((s) => isSourceAvailable(s)),
      includeReviewSearch: config.includeReviewSearch ?? false,
      scoreThreshold: config.scoreThreshold ?? 50,
      aiWeight: config.aiWeight ?? DEFAULT_AI_WEIGHT,
      fetchFullText: config.fetchFullText ?? false,
      query: config.query,
      abortSignal: config.abortSignal,
    };
  }

  /** Throw if pipeline has been cancelled. */
  private checkAbort(): void {
    if (this.config.abortSignal?.aborted) {
      throw new Error("cancelled");
    }
  }

  async run(): Promise<PipelineResult> {
    const { query, maxRounds, sources } = this.config;

    if (!sources?.length) {
      return {
        papers: [],
        metadata: {
          rounds: 0,
          totalSearched: 0,
          totalEvaluated: 0,
          totalFullTextFetched: 0,
          queriesByRound: [],
          discoveredQueries: [],
          decomposedEvents: [],
          scoreDistribution: { high: 0, medium: 0, low: 0 },
          aiFallbackCount: 0,
        },
      };
    }

    await this.searchLearning.hydrate();

    const { expandedQueries, concepts } =
      await discoveryEngine.expandQueryWithAI(query);
    this.checkAbort();
    const initialQueries = [query, ...expandedQueries].slice(
      0,
      QUERIES_PER_ROUND + 1,
    );

    const excludedDomains = qualityMemory.getExcludedDomains();
    qualityMemory.prune();

    // Tracking state
    const usedQueries = new Set<string>();
    const allPapers: FusionPaper[] = [];
    const queriesByRound: string[][] = [];
    const allDiscoveredQueries: string[] = [];
    const allDecomposedEvents: Array<{ title: string; queries: string[] }> = [];
    let totalSearched = 0;
    let totalEvaluated = 0;
    let totalFullTextFetched = 0;
    let totalAiFallback = 0;
    let actualRounds = 0;
    let enrichedQueriesFromReviews: string[] = [];
    let reviewPaperCount = 0;
    // Cross-stage dedup keys (DOI + normalized URL) so Phase A review papers are
    // not re-added when Phase B retrieves the same paper without type filtering.
    const seenPaperKeys = new Set<string>();

    // Comprehensive review-paper retrieval to seed dimension discovery.
    // Uses API type filters (openalex/crossref/europe-pmc/pubmed) + review-oriented
    // query adaptation. Review papers are high-value for landscape mapping because
    // they map the field's structure — replacing the former (disabled) web search.
    if (this.config.includeReviewSearch) {
      const {
        papers: reviewPapers,
        searched: reviewSearched,
        evaluated: reviewEvaluated,
      } = await this.reviewSearchRound(initialQueries, concepts);
      this.checkAbort();
      reviewPaperCount = reviewPapers.length;
      totalSearched += reviewSearched;
      totalEvaluated += reviewEvaluated;

      // Record review search results for cross-session learning (parity with Phase B).
      for (const rq of initialQueries.slice(0, 3)) {
        this.searchLearning.recordSearchResult(rq, reviewPapers);
      }

      // Decompose roundup-style reviews into sub-event queries (parity with Phase B).
      // Reviews covering multiple independent studies yield high-value seed queries.
      const reviewRoundups = reviewPapers.filter((p) => p.isRoundup);
      if (reviewRoundups.length > 0) {
        try {
          const { subQueries, events } = await discoveryEngine.decomposeRoundup(
            reviewRoundups.map((p) => ({
              title: p.title,
              abstract: p.abstract,
            })),
          );
          allDecomposedEvents.push(...events);
          if (subQueries.length > 0) {
            allDiscoveredQueries.push(...subQueries);
          }
        } catch (e) {
          safeDebug("[z-search] SearchPipeline: decomposeRoundup failed: " + e);
          /* non-blocking */
        }
      }

      for (const p of reviewPapers) {
        const key = this.paperDedupKey(p);
        if (key && !seenPaperKeys.has(key)) {
          seenPaperKeys.add(key);
          allPapers.push(p);
          if (p.fullTextAvailable) totalFullTextFetched++;
        }
      }

      enrichedQueriesFromReviews = this.extractEnrichedQueriesFromReviews(
        reviewPapers,
        query,
      );
    }

    const startRound = 1;
    const academicRounds = maxRounds;
    let currentQueries =
      enrichedQueriesFromReviews.length > 0
        ? [...initialQueries, ...enrichedQueriesFromReviews].slice(
            0,
            QUERIES_PER_ROUND + 1,
          )
        : initialQueries;

    for (let round = startRound; round <= academicRounds; round++) {
      const freshQueries = currentQueries.filter(
        (q) => !usedQueries.has(q.toLowerCase().trim()),
      );
      if (freshQueries.length === 0) break;

      for (const q of freshQueries) usedQueries.add(q.toLowerCase().trim());
      queriesByRound.push([...freshQueries]);
      actualRounds = round;

      if (allPapers.length >= this.config.maxTotalResults) break;

      // --- Search phase ---
      const rawArticles = await this.searchRound(freshQueries);
      this.checkAbort();
      totalSearched += rawArticles.length;

      // --- Deduplicate ---
      const deduped = academicSearchHandlers.deduplicateArticles(rawArticles);

      // --- Filter: domain whitelist/blacklist ---
      const domainFiltered = filterByDomain(
        deduped,
        discoveryEngine.getFilterConfig(),
      );

      // --- Filter: quality memory post-filter ---
      const qualityFiltered =
        excludedDomains.length > 0
          ? domainFiltered.filter((a: any) => {
              const url = a.url || a.oaUrl || "";
              if (!url) return true;
              try {
                const host = new URL(String(url)).hostname
                  .replace(/^www\./, "")
                  .toLowerCase();
                return !excludedDomains.some(
                  (d) => host === d || host.endsWith(`.${d}`),
                );
              } catch (e) {
                safeDebug(
                  "[z-search] SearchPipeline.domainFilter URL parse failed: " +
                    e,
                );
                return true;
              }
            })
          : domainFiltered;

      // --- Filter: title keyword soft sort (matched first) ---
      const titleSorted = filterByTitleKeywords(qualityFiltered, query);

      // --- Filter: library dedup ---
      const newToLibrary = await this.filterLibraryDuplicates(titleSorted);

      // --- Adaptive full-text fetch ---
      const fetchResults = await this.fetchFullTexts(newToLibrary);
      this.checkAbort();
      totalFullTextFetched += fetchResults.filter(
        (r) => r.fullText !== null,
      ).length;

      // --- Heuristic scoring (use AI-generated concepts as dynamic keywords) ---
      const pipelineKeywords = concepts.length > 0 ? concepts : undefined;
      // Prefetch JCR+CASS+Warning metrics in one DB query (avoids per-paper async lookup)
      const { jcrQuartileMap, cassQuartileMap, warningSet } =
        await prefetchMetrics(fetchResults.map((r) => r.article));
      const scored = fetchResults.map((r) => {
        const { score: heuristic } = heuristicScoreSearchResult(
          r.article,
          r.fullText ?? undefined,
          pipelineKeywords,
        );
        const { score: academic } = scoreAcademicArticle(
          {
            title: r.article.title || "",
            abstract: r.article.abstract || "",
            citationCount: r.article.citationCount ?? 0,
            year: r.article.year || "",
            source: r.article.source || "",
            containerTitle:
              r.article.containerTitle || r.article.journalName || "",
            publicationType: r.article.publicationType,
            doi: r.article.doi,
          },
          jcrQuartileMap,
          cassQuartileMap,
          warningSet,
        );
        // Academic scorer complements heuristic: take the higher of the two
        return { ...r, heuristicScore: Math.max(heuristic, academic) };
      });

      // --- AI batch evaluation ---
      const aiResults = await this.aiBatchEvaluate(scored, query);
      this.checkAbort();
      totalEvaluated += scored.length;

      // --- Score fusion + build results ---
      const roundPapers: FusionPaper[] = [];
      let roundAiFallback = 0;
      for (let i = 0; i < scored.length; i++) {
        const s = scored[i];
        const ai = aiResults[i];
        const fused = fuseScores(
          ai.score,
          s.heuristicScore,
          this.config.aiWeight,
        );
        if (ai.aiFailed) roundAiFallback++;

        if (fused < this.config.scoreThreshold) {
          this.recordLowQuality(s.article, fused);
          continue;
        }

        const article = s.article;
        if (fused >= 70) {
          try {
            const hqDomain = new URL(
              article.url || article.oaUrl || "",
            ).hostname.replace(/^www\./, "");
            qualityMemory.recordHighQuality(
              hqDomain,
              "high_fused_score",
              fused,
            );
          } catch (e) {
            safeDebug(
              "[z-search] SearchPipeline.recordHighQuality URL parse failed: " +
                e,
            ); /* skip invalid URLs */
          }
        }

        roundPapers.push({
          title: article.title || "",
          authors: article.authors || "",
          year: article.year ?? 0,
          doi: article.doi || "",
          abstract: article.abstract || "",
          citationCount: article.citationCount ?? 0,
          source: article.source || "",
          containerTitle: article.containerTitle || "",
          journalName:
            article.journalName || article.containerTitle || undefined,
          issn: article.issn || undefined,
          volume: article.volume || undefined,
          issue: article.issue || undefined,
          pages: article.pages || undefined,
          publicationType: article.publicationType || undefined,
          publisher: article.publisher || undefined,
          url:
            article.url ||
            (article.doi ? `https://doi.org/${article.doi}` : ""),
          pdfUrl: article.pdfUrl,
          oaUrl: article.oaUrl,
          heuristicScore: s.heuristicScore,
          aiScore: ai.score,
          fusedScore: fused,
          round,
          searchSources:
            article.sources || (article.source ? [article.source] : []),
          fullTextAvailable: s.fullText !== null,
          fullText: s.fullText ?? undefined,
          paperType: ai.paperType,
          isRoundup: ai.isRoundup,
          isBreakthrough: ai.isBreakthrough,
          frontierScore: ai.frontierScore,
          primaryDomain: ai.primaryDomain,
          tags: ai.tags,
          relevanceReason: ai.relevanceReason,
          keyContribution: ai.keyContribution,
          additions: ai.additions,
          deductions: ai.deductions,
          queryOrigin: article._queryOrigin || freshQueries[0],
        });
      }

      // Push Phase B papers, skipping any already added by Phase A (cross-stage
      // dedup by DOI/URL — Phase B does not apply type filtering, so overlaps
      // with the review search are expected).
      for (const p of roundPapers) {
        const key = this.paperDedupKey(p);
        if (key && seenPaperKeys.has(key)) continue;
        if (key) seenPaperKeys.add(key);
        allPapers.push(p);
      }
      totalAiFallback += roundAiFallback;

      // --- Record search results for cross-session learning ---
      for (const q of freshQueries) {
        this.searchLearning.recordSearchResult(q, roundPapers);
      }

      // --- Event decomposition (roundup articles) ---
      const roundups = roundPapers.filter((p) => p.isRoundup);
      if (roundups.length > 0) {
        const { subQueries, events } = await discoveryEngine.decomposeRoundup(
          roundups.map((p) => ({ title: p.title, abstract: p.abstract })),
        );
        allDecomposedEvents.push(...events);
        if (subQueries.length > 0) {
          allDiscoveredQueries.push(...subQueries);
        }
      }

      // --- Query discovery (not on last round) ---
      if (round < academicRounds) {
        const highQuality = roundPapers.filter((p) => p.fusedScore >= 70);
        if (highQuality.length > 0) {
          const discovered =
            await discoveryEngine.discoverNewQueries(highQuality);
          const newQueries = discovered.newSearchQueries || [];
          if (newQueries.length > 0) {
            allDiscoveredQueries.push(...newQueries);
          }

          const candidates = deduplicateQueriesJaccard([
            ...newQueries,
            ...allDiscoveredQueries,
          ]);
          currentQueries = candidates.slice(0, QUERIES_PER_ROUND);
        } else {
          currentQueries =
            allDiscoveredQueries.length > 0
              ? allDiscoveredQueries.slice(0, QUERIES_PER_ROUND)
              : [];
        }
      } else {
        currentQueries = [];
      }

      if (currentQueries.length === 0 && round < academicRounds) break;
    }

    // --- Sort by fused score ---
    // Review papers from Phase A are already full FusionPaper objects (AI-evaluated),
    // so they merge into allPapers directly — no separate merge step needed.
    allPapers.sort((a, b) => b.fusedScore - a.fusedScore);
    const finalPapers = allPapers.slice(0, this.config.maxTotalResults);

    // --- Score distribution ---
    const high = finalPapers.filter((p) => p.fusedScore >= 70).length;
    const medium = finalPapers.filter(
      (p) => p.fusedScore >= 50 && p.fusedScore < 70,
    ).length;
    const low = finalPapers.filter((p) => p.fusedScore < 50).length;

    // Persist search learning data before returning
    await this.searchLearning.persist();

    return {
      papers: finalPapers,
      metadata: {
        rounds: actualRounds,
        totalSearched,
        totalEvaluated,
        totalFullTextFetched,
        queriesByRound,
        discoveredQueries: allDiscoveredQueries,
        decomposedEvents: allDecomposedEvents,
        scoreDistribution: { high, medium, low },
        aiFallbackCount: totalAiFallback,
        enrichedQueriesFromReviews,
        reviewPaperCount,
        ...(this.failedSources.size > 0
          ? { failedSources: [...this.failedSources].sort() }
          : {}),
        ...(this.libraryDedupSkipped ? { libraryDedupSkipped: true } : {}),
      },
    };
  }

  // ── Phase A: Review/Survey Search ──

  /** Sources supporting API-level publication-type filtering. */
  private static readonly REVIEW_FILTER_SOURCES = new Set([
    "openalex",
    "crossref",
    "europe-pmc",
    "pubmed",
  ]);

  /**
   * Phase A — comprehensive review/survey paper retrieval.
   *
   * For each initial query, adapt it via adaptForReview() (which keeps
   * review/survey terms), then fan out across all configured sources.
   * Sources supporting type filters (openalex/crossref/europe-pmc/pubmed)
   * get reviewOnly:true; others rely on the review-oriented query words.
   *
   * Reuses the Phase B scoring pipeline (fetch full text → heuristic +
   * academic scoring → AI batch eval → fuse) so review papers carry full
   * FusionPaper metadata and integrate seamlessly with Phase B results.
   *
   * Returns the review papers plus search/eval counts so run() can fold them
   * into the pipeline-wide metadata (totalSearched/totalEvaluated).
   */
  private async reviewSearchRound(
    queries: string[],
    concepts: string[],
  ): Promise<{ papers: FusionPaper[]; searched: number; evaluated: number }> {
    const { sources } = this.config;
    const reviewQueries = queries.slice(0, 3); // top-3 initial queries
    const perApiLimit = Math.ceil(
      this.config.maxResultsPerRound / (sources!.length || 1),
    );

    const searchPromises = reviewQueries.flatMap((q, qi) => {
      return sources!.map(async (source) => {
        const adapted = await this.getReviewAdaptedQuery(q, source);
        const reviewOnly = SearchPipeline.REVIEW_FILTER_SOURCES.has(source);
        return academicSearchHandlers
          .callSearchAPI(source, adapted, undefined, perApiLimit, {
            reviewOnly,
          })
          .then((res) => {
            if (res?.articles) {
              for (const a of res.articles) a._queryOrigin = reviewQueries[qi];
            }
            return res;
          })
          .catch((e) => {
            // F-31：失败源不再静默丢弃——记录进 metadata.failedSources 上浮
            this.failedSources.add(source);
            safeDebug(
              `[z-search] SearchPipeline: source "${source}" failed in review round: ${e}`,
            );
            return { articles: [] as unknown[] };
          });
      });
    });

    const results = await Promise.allSettled(searchPromises);
    const articles: any[] = [];
    for (const result of results) {
      if (result.status === "fulfilled" && result.value?.articles) {
        articles.push(...result.value.articles);
      }
    }

    if (articles.length === 0) return { papers: [], searched: 0, evaluated: 0 };

    // Dedup, filter, score — mirrors a single Phase B round.
    const deduped = academicSearchHandlers.deduplicateArticles(articles);
    const domainFiltered = filterByDomain(
      deduped,
      discoveryEngine.getFilterConfig(),
    );
    const titleSorted = filterByTitleKeywords(
      domainFiltered,
      this.config.query,
    );
    const fetchResults = await this.fetchFullTexts(titleSorted);
    this.checkAbort();

    // Reuse the AI-expanded concepts from run() step 1 (avoids a redundant
    // expandQueryWithAI LLM call) as dynamic scoring keywords.
    const pipelineKeywords = concepts.length > 0 ? concepts : undefined;
    const { jcrQuartileMap, cassQuartileMap, warningSet } =
      await prefetchMetrics(fetchResults.map((r) => r.article));
    const scored = fetchResults.map((r) => {
      const { score: heuristic } = heuristicScoreSearchResult(
        r.article,
        r.fullText ?? undefined,
        pipelineKeywords,
      );
      const { score: academic } = scoreAcademicArticle(
        {
          title: r.article.title || "",
          abstract: r.article.abstract || "",
          citationCount: r.article.citationCount ?? 0,
          year: r.article.year || "",
          source: r.article.source || "",
          containerTitle:
            r.article.containerTitle || r.article.journalName || "",
          publicationType: r.article.publicationType,
          doi: r.article.doi,
        },
        jcrQuartileMap,
        cassQuartileMap,
        warningSet,
      );
      return { ...r, heuristicScore: Math.max(heuristic, academic) };
    });

    const aiResults = await this.aiBatchEvaluate(
      scored,
      this.config.query,
      true,
    );
    this.checkAbort();

    // Review-oriented scoring raises review base scores, so the threshold can
    // stay close to the configured value (no longer needs the steep discount).
    const reviewThreshold = Math.max(30, this.config.scoreThreshold - 5);
    const roundPapers: FusionPaper[] = [];
    for (let i = 0; i < scored.length; i++) {
      const s = scored[i];
      const ai = aiResults[i];
      const fused = fuseScores(
        ai.score,
        s.heuristicScore,
        this.config.aiWeight,
      );
      if (fused < reviewThreshold) continue;

      const article = s.article;
      roundPapers.push({
        title: article.title || "",
        authors: article.authors || "",
        year: article.year ?? 0,
        doi: article.doi || "",
        abstract: article.abstract || "",
        citationCount: article.citationCount ?? 0,
        source: article.source || "",
        containerTitle: article.containerTitle || "",
        journalName: article.journalName || article.containerTitle || undefined,
        issn: article.issn || undefined,
        volume: article.volume || undefined,
        issue: article.issue || undefined,
        pages: article.pages || undefined,
        publicationType: article.publicationType || undefined,
        publisher: article.publisher || undefined,
        url:
          article.url || (article.doi ? `https://doi.org/${article.doi}` : ""),
        pdfUrl: article.pdfUrl,
        oaUrl: article.oaUrl,
        heuristicScore: s.heuristicScore,
        aiScore: ai.score,
        fusedScore: fused,
        round: 1, // Phase A review search (treated as round 1; no consumer reads .round)
        searchSources:
          article.sources || (article.source ? [article.source] : []),
        fullTextAvailable: s.fullText !== null,
        fullText: s.fullText ?? undefined,
        paperType: ai.paperType || "review",
        isRoundup: ai.isRoundup,
        isBreakthrough: ai.isBreakthrough,
        frontierScore: ai.frontierScore,
        primaryDomain: ai.primaryDomain,
        tags: ai.tags,
        relevanceReason: ai.relevanceReason || "Review/survey paper (Phase A)",
        keyContribution: ai.keyContribution,
        additions: ai.additions,
        deductions: ai.deductions,
        queryOrigin: article._queryOrigin || reviewQueries[0],
      });
    }

    return {
      papers: roundPapers,
      searched: articles.length,
      evaluated: scored.length,
    };
  }

  /** Cached review-oriented query adaptation (separate cache from normal adapt). */
  private async getReviewAdaptedQuery(
    rawQuery: string,
    source: string,
  ): Promise<string> {
    const cacheKey = `review:${rawQuery.toLowerCase().trim()}`;
    let adapted = this.adaptedQueryCache.get(cacheKey);
    if (!adapted) {
      adapted = await this.queryAdapter.adaptForReview(rawQuery);
      this.adaptedQueryCache.set(cacheKey, adapted);
    }
    return adapted[source as keyof typeof adapted] || rawQuery;
  }

  /**
   * Extract enriched seed queries from review papers for Phase B.
   *
   * Reviews map a field's structure — their tags, primary domains, and
   * key contributions surface sub-topics worth dedicated investigation.
   * Each signal is combined with the original query to stay on-topic.
   */
  private extractEnrichedQueriesFromReviews(
    reviewPapers: FusionPaper[],
    originalQuery: string,
  ): string[] {
    if (reviewPapers.length === 0) return [];

    const signals = new Set<string>();
    for (const p of reviewPapers) {
      // Tags are AI-assigned keywords — high signal for sub-topics.
      for (const tag of (p.tags || []).slice(0, 5)) {
        if (tag && tag.length >= 2 && tag.length <= 60) signals.add(tag);
      }
      // primaryDomain marks a subfield boundary.
      if (
        p.primaryDomain &&
        p.primaryDomain.length >= 2 &&
        p.primaryDomain.length <= 60
      ) {
        signals.add(p.primaryDomain);
      }
      // Extract CamelCase / hyphenated technical terms from titles (same heuristic
      // as the former web extractor — reviews mention methods/tools by name).
      const titleMatches = (p.title || "").match(
        /\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g,
      );
      if (titleMatches) for (const m of titleMatches) signals.add(m);
    }

    const candidates = [...signals].map((s) => `${s} ${originalQuery}`);
    return deduplicateQueriesJaccard(candidates).slice(0, 5);
  }

  /**
   * Execute parallel search across all configured sources for given queries.
   * Exclusion operators are NOT appended to academic API queries
   * (they only work with web search engines).
   */
  private queryAdapter = new AcademicQueryAdapter();
  private adaptedQueryCache = new Map<string, AdaptedQueries>();
  private searchLearning = new SearchLearning();

  private async getAdaptedQuery(
    rawQuery: string,
    source: string,
  ): Promise<string> {
    const cacheKey = rawQuery.toLowerCase().trim();
    let adapted = this.adaptedQueryCache.get(cacheKey);
    if (!adapted) {
      adapted = await this.queryAdapter.adapt(rawQuery);
      this.adaptedQueryCache.set(cacheKey, adapted);
    }
    return adapted[source as keyof typeof adapted] || rawQuery;
  }

  private async searchRound(queries: string[]): Promise<any[]> {
    const { sources } = this.config;
    const perApiLimit = Math.ceil(
      this.config.maxResultsPerRound / (sources!.length || 1),
    );

    const searchPromises = queries.flatMap((q, qi) => {
      return sources!.map(async (source) => {
        const adaptedQuery = await this.getAdaptedQuery(q, source);
        return academicSearchHandlers
          .callSearchAPI(source, adaptedQuery, undefined, perApiLimit)
          .then((res) => {
            if (res?.articles) {
              for (const a of res.articles) a._queryOrigin = queries[qi];
            }
            return res;
          })
          .catch((e) => {
            // F-31：同 reviewSearchRound——失败源上浮
            this.failedSources.add(source);
            safeDebug(
              `[z-search] SearchPipeline: source "${source}" failed in round: ${e}`,
            );
            return { articles: [] as unknown[] };
          });
      });
    });

    const results = await Promise.allSettled(searchPromises);
    const articles: any[] = [];
    for (const result of results) {
      if (result.status === "fulfilled" && result.value?.articles) {
        articles.push(...result.value.articles);
      }
    }
    return articles;
  }

  /**
   * Filter out papers already in the Zotero library (by DOI).
   * Batches DOI lookups into SQL queries (max 999 per batch for SQLite limits).
   */
  private async filterLibraryDuplicates(articles: any[]): Promise<any[]> {
    const withDoi = articles.filter((a) => a.doi);
    const withoutDoi = articles.filter((a) => !a.doi);

    if (withDoi.length === 0) return articles;

    // Batch SQL lookup: collect all existing DOIs in library
    const existingDois = new Set<string>();
    const dois = withDoi.map((a) => String(a.doi).toLowerCase().trim());
    const BATCH_SIZE = SAFE_BATCH_SIZE;

    for (let i = 0; i < dois.length; i += BATCH_SIZE) {
      const batch = dois.slice(i, i + BATCH_SIZE);
      try {
        const placeholders = batch.map(() => "?").join(",");
        const rows = await Zotero.DB.queryAsync(
          `SELECT DISTINCT lower(DOI) as doi FROM items WHERE DOI != '' AND lower(DOI) IN (${placeholders})`,
          batch,
        );
        for (const row of rows) {
          if (row.doi) existingDois.add(row.doi);
        }
      } catch (e) {
        // F-37（回退审计 2026-09-11，P2）：去重整体跳过时结果可能含已入库
        // 条目——置位上浮 metadata，UI 可提示"部分结果可能已存在于库中"。
        this.libraryDedupSkipped = true;
        safeDebug(
          "[z-search] SearchPipeline.filterLibraryDuplicates DB query failed: " +
            e,
        );
        /* best-effort: proceed without filtering */
      }
    }

    const filtered = withDoi.filter(
      (a) => !existingDois.has(String(a.doi).toLowerCase().trim()),
    );

    return [...filtered, ...withoutDoi];
  }

  /**
   * Adaptive full-text fetch: OA HTML → structured XML (PMC/GROBID).
   *
   * summary-level 立法（2026-09-23）：默认（fetchFullText=false）零网络——
   * 直接以 null 全文返回，评分走摘要维度；只有显式开启（fetchFullText 参数）
   * 才付每篇的 PMC 解析 / OA 网页抓取成本。
   * html-first：已有 OA 落地页可抓的文章（OpenAlex OA、PMC 文章页）维持
   * 单次请求开销；PubMed 的 url 是 SPA 摘要页（静态抓取拿到空壳）、
   * Europe PMC 的 oaUrl 是 PDF 直链（抓不得）——这两类由结构化 XML 链路
   * （PMC JATS，DOI→PMCID）补齐。PDF 直链不在此处理（库内 PDF 解析入口
   * 只接受 attachment id）。
   */
  private async fetchFullTexts(
    articles: any[],
  ): Promise<Array<{ article: any; fullText: string | null }>> {
    if (!this.config.fetchFullText) {
      return articles.map((article) => ({ article, fullText: null }));
    }

    const results: Array<{ article: any; fullText: string | null }> = [];

    const batchSize = 3;
    for (let i = 0; i < articles.length; i += batchSize) {
      const batch = articles.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (article) => {
          const resolved = await resolveArticleFullText(article, {
            strategy: "html-first",
          });
          return { article, fullText: resolved?.text ?? null };
        }),
      );
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * AI batch evaluation for search results.
   * Separate from DiscoveryEngine.aiEvaluatePapers (which ties to a source paper's concepts).
   * Pipeline evaluates results against the original user query directly.
   */
  private async aiBatchEvaluate(
    scored: Array<{ article: any; heuristicScore: number }>,
    query: string,
    reviewMode: boolean = false,
  ): Promise<
    Array<{
      score: number;
      paperType: string;
      isRoundup: boolean;
      isBreakthrough: boolean;
      frontierScore: number;
      primaryDomain: string;
      tags: string[];
      relevanceReason: string;
      keyContribution: string;
      additions: string[];
      deductions: string[];
      aiFailed: boolean;
    }>
  > {
    const defaultResult = () => ({
      score: 0,
      paperType: "",
      isRoundup: false,
      isBreakthrough: false,
      frontierScore: 0,
      primaryDomain: "",
      tags: [] as string[],
      relevanceReason: "",
      keyContribution: "",
      additions: [] as string[],
      deductions: [] as string[],
      aiFailed: true,
    });

    if (scored.length === 0) return [];

    const provider = AIProviderRegistry.getProviderForFeature("chat");
    if (!provider) return scored.map(defaultResult);

    // Detect query language for prompt matching
    const isChineseQuery = /[\u4e00-\u9fff]/.test(query);
    const langInstruction = isChineseQuery
      ? "Output relevance_reason, key_contribution, tags, and primary_domain in Chinese."
      : "Output relevance_reason, key_contribution, tags, and primary_domain in English.";

    const paperSummaries = scored.map((s, i) => ({
      i,
      t: (s.article.title || "").slice(0, 200),
      a: (s.article.abstract || "").slice(0, 300),
      y: s.article.year || "",
      c: s.article.citationCount ?? 0,
      j: s.article.containerTitle || "",
    }));

    const prompt = `You are an academic paper evaluation expert. Evaluate these papers for relevance to the user's query.

## User Query
${query}

## Candidate Papers
${JSON.stringify(paperSummaries)}

## Scoring Rules (multi-dimensional add/subtract system)

### Step 1: Determine content type base score
${
  reviewMode
    ? `- Systematic review / meta-analysis / comprehensive literature review: base 75
- Survey / tutorial covering a field's landscape: base 65
- Technical review with comparative analysis: base 55
- Original research / new method (secondary value here): base 45
- News / conference report (relaying others' findings): base 25
- Reprint / press release / commercial promotion: base 15
- Unrelated: base 5
NOTE: This is a REVIEW-FOCUSED retrieval. Reviews and surveys are the PRIMARY target — score them higher than primary research.`
    : `- Original research / new method / new tool (paper/preprint/tech report): base 65
- Technical tutorial / deep analysis (with steps or theory): base 50
- Industry survey / tech review (with analysis and opinions): base 40
- News / conference report (relaying others' findings): base 25
- Reprint / press release / commercial promotion: base 15
- Unrelated: base 5`
}

### Step 2: Additions (independent judgment per item)
${
  reviewMode
    ? `+ Comprehensive coverage of the field (maps multiple sub-areas): +12
+ Systematic methodology / explicit inclusion criteria: +10
+ Comparative tables / taxonomy of approaches: +8
+ Cites a large body of traceable references (50+): +8
+ From authoritative source (top journal / established review series): +5
+ Recent (covers latest developments within last 2 years): +5`
    : `+ Has runnable code / complete CLI examples: +12
+ Has experimental data / benchmark results: +12
+ Technical depth reaches advanced/expert: +8
+ From authoritative source (Nature/Science/arXiv/top conference/official tech blog): +5
+ Cites traceable references / original papers: +3`
}

### Step 3: Deductions (independent judgment per item)
- Pure press release / reprint with no original analysis: -25
- Only lists links / tool names without explanation: -15
- Commercial promotion / advertorial: -20
- Clickbait title (exaggerated but empty content): -10
- Body too short (<300 words of substantive content): -15

### Step 4: Calculate final score
score = base + additions - deductions, clamped to 0-100.

### Step 5: Frontier score breakdown
New method +30, top journal +20, published this year +15, pioneering +15, has code +10, first tool report +10

## Output Fields
For each paper, provide:
1. i: paper index
2. score (0-100): final computed score
3. paper_type: "original" | "review" | "roundup" | "preprint" | "tool" | "dataset"
4. is_roundup: whether it covers multiple independent studies
5. is_breakthrough: breakthrough result
6. frontier_score (0-100): innovation/novelty
7. primary_domain: main subject area
8. tags: 3-5 keyword tags
9. relevance_reason: one-sentence relevance explanation
10. key_contribution: core contribution
11. additions: list of applied additions, e.g. ["code examples +12", "authority source +5"]
12. deductions: list of applied deductions, e.g. ["commercial promotion -20"]

## Language
${langInstruction}

## Output Format (pure JSON, no markdown)
{"evaluations":[{"i":0,"score":85,"paper_type":"original","is_roundup":false,"is_breakthrough":false,"frontier_score":70,"primary_domain":"AI/ML","tags":["LLM","agent"],"relevance_reason":"explanation","key_contribution":"contribution","additions":["experimental data +12","authority source +5"],"deductions":[]}]}`;

    try {
      const response = await provider.execute({
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        maxTokens: Math.min(4000, scored.length * 200 + 500),
      });

      const json = parseJsonFromMarkdown(response.content);
      if (!json?.evaluations || !Array.isArray(json.evaluations)) {
        return scored.map(defaultResult);
      }

      const evalMap = new Map<number, any>();
      for (const e of json.evaluations) {
        if (typeof e.i === "number") evalMap.set(e.i, e);
      }

      return scored.map((_, i) => {
        const e = evalMap.get(i);
        if (!e) return defaultResult();
        return {
          score:
            typeof e.score === "number"
              ? Math.min(100, Math.max(0, e.score))
              : 0,
          paperType: e.paper_type || "",
          isRoundup: !!e.is_roundup,
          isBreakthrough: !!e.is_breakthrough,
          frontierScore:
            typeof e.frontier_score === "number" ? e.frontier_score : 0,
          primaryDomain: e.primary_domain || "",
          tags: Array.isArray(e.tags) ? e.tags : [],
          relevanceReason: e.relevance_reason || "",
          keyContribution: e.key_contribution || "",
          additions: Array.isArray(e.additions) ? e.additions : [],
          deductions: Array.isArray(e.deductions) ? e.deductions : [],
          aiFailed: false,
        };
      });
    } catch (e) {
      safeDebug("[z-search] SearchPipeline.scoreWithLearning failed: " + e);
      return scored.map(defaultResult);
    }
  }

  private recordLowQuality(article: any, fusedScore: number): void {
    if (fusedScore >= 30) return;
    const url = article.url || article.oaUrl;
    if (!url) return;
    try {
      const domain = new URL(String(url)).hostname.replace(/^www\./, "");
      qualityMemory.recordLowQuality(domain, "low_fused_score", fusedScore);
    } catch (e) {
      safeDebug(
        "[z-search] SearchPipeline.recordLowQuality URL parse failed: " + e,
      ); /* skip invalid URLs */
    }
  }

  /**
   * Compute a cross-stage dedup key for a FusionPaper.
   * Prefers DOI (most reliable), falls back to normalized URL.
   * Returns empty string if neither is usable (paper won't be deduped).
   */
  private paperDedupKey(p: FusionPaper): string {
    if (p.doi) return `doi:${p.doi.toLowerCase().trim()}`;
    if (p.url) {
      try {
        const u = new URL(p.url);
        return `url:${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}`;
      } catch (e) {
        safeDebug(
          "[z-search] SearchPipeline.paperDedupKey URL parse failed: " + e,
        );
        return `url:${p.url.toLowerCase().replace(/\/+$/, "")}`;
      }
    }
    return "";
  }
}

/**
 * Run the deep search pipeline.
 * This is the main entry point called by the `deep-search` skill handler.
 */
export async function runSearchPipeline(
  config: SearchPipelineConfig,
): Promise<PipelineResult> {
  const pipeline = new SearchPipeline(config);
  try {
    return await pipeline.run();
  } catch (e: any) {
    const err =
      e instanceof Error
        ? e
        : new Error(toErrorMessage(e, "Deep search failed"));
    safeDebug(
      "[z-search] runSearchPipeline failed: " + (err.stack || err.message),
    );
    throw err;
  }
}

export default SearchPipeline;
