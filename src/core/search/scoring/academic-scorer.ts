/**
 * Academic Article Scorer — 4-dimension academic-specific scoring
 *
 * Ported from spider_article/src/academic/scoring.py.
 * Complements the general heuristicScoreSearchResult() with academic-specific dimensions.
 *
 * Dimensions (raw score ranges, weighted to ~0-25 total):
 *   1. Citation Impact      (0-30, weight 0.33)
 *   2. Journal Tier         (0-30, weight 0.33)
 *   3. Recency              (0-15, weight 0.17)
 *   4. Peer Review Status   (0-15, weight 0.17)
 */

import type { ScoreFactor } from "../../tool/builtin/atomic/paper-quality-scorer";
import { safeDebug } from "../../../utils/logger";

// ---------------------------------------------------------------------------
// Input / Output types
// ---------------------------------------------------------------------------

/** Input metadata for academic scoring */
export interface AcademicArticleMeta {
  title: string;
  abstract: string;
  citationCount: number;
  year: number | string;
  source: string;
  /** Journal / conference / container title */
  containerTitle?: string;
  /** e.g. "journalArticle" | "preprint" | "conferencePaper" | "review" */
  publicationType?: string;
  /** DOI — presence implies formal publication */
  doi?: string;
}

/** Output of academic scoring */
export interface AcademicScorerResult {
  /** Total score 0-100 */
  score: number;
  /** Per-dimension breakdown */
  factors: ScoreFactor[];
}

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

function citationScore(citations: number): number {
  if (citations > 100) return 30;
  if (citations > 50) return 25;
  if (citations > 20) return 20;
  if (citations > 5) return 12;
  if (citations > 0) return 6;
  return 0;
}

function journalTierScore(
  containerTitle: string | undefined,
  source: string,
  jcrQuartileMap?: Map<string, string>,
  cassQuartileMap?: Map<string, { quartile: number; isTop: boolean }>,
  warningSet?: Set<string>,
): number {
  // Warning veto: if journal is on the warning list, score 0
  if (containerTitle && warningSet?.has(containerTitle.toUpperCase())) return 0;

  // JCR quartile scoring
  let jcrScore = 0;
  if (containerTitle && jcrQuartileMap) {
    const q = jcrQuartileMap.get(containerTitle.toUpperCase());
    if (q === "Q1") jcrScore = 30;
    else if (q === "Q2") jcrScore = 24;
    else if (q === "Q3") jcrScore = 18;
    else if (q === "Q4") jcrScore = 12;
  }

  // CASS quartile: use to adjust score (take lower of JCR/CASS for cautious estimate)
  let cassScore = 0;
  if (containerTitle && cassQuartileMap) {
    const cass = cassQuartileMap.get(containerTitle.toUpperCase());
    if (cass) {
      if (cass.quartile === 1) cassScore = cass.isTop ? 30 : 27;
      else if (cass.quartile === 2) cassScore = 22;
      else if (cass.quartile === 3) cassScore = 16;
      else if (cass.quartile === 4) cassScore = 10;
    }
  }

  // If both JCR and CASS available, take the lower score (more conservative)
  if (jcrScore > 0 && cassScore > 0) return Math.min(jcrScore, cassScore);
  if (jcrScore > 0) return jcrScore;
  if (cassScore > 0) return cassScore;

  // No journal data available — return 0 rather than giving unearned points
  return 0;
}

function recencyScore(year: number | string): number {
  if (year === undefined || year === null || year === "") return 3;

  const pubYear =
    typeof year === "string"
      ? parseInt(year.match(/\d{4}/)?.[0] ?? "0", 10)
      : year;

  if (isNaN(pubYear) || pubYear === 0) return 3;

  const currentYear = new Date().getFullYear();
  if (pubYear === currentYear) return 15;
  if (pubYear === currentYear - 1) return 12;
  if (pubYear >= currentYear - 2) return 8;
  return 3;
}

function peerReviewScore(
  publicationType: string | undefined,
  doi: string | undefined,
): number {
  const hasDoi = !!doi;
  const pt = (publicationType ?? "").toLowerCase();

  if (
    pt === "journalarticle" ||
    pt === "journal_article" ||
    pt === "journal article"
  )
    return 15;
  if (pt === "review") return 15;
  if (pt === "clinicaltrial" || pt === "clinical_trial") return 15;
  if (pt === "preprint") return hasDoi ? 10 : 5;
  if (pt === "conferencepaper" || pt === "conference_paper") return 8;

  // Unknown type: DOI implies formal publication
  return hasDoi ? 10 : 3;
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * Prefetch JCR quartiles for a batch of articles.
 * Call once before scoring multiple articles, then pass the result to scoreAcademicArticle.
 */
export async function prefetchJCRQuartiles(
  articles: Array<{ containerTitle?: string }>,
): Promise<Map<string, string>> {
  const names = articles
    .map((a) => a.containerTitle)
    .filter((n): n is string => !!n);

  if (names.length === 0) return new Map();

  try {
    const jcrStore = (await import("../../data/JCRStore")).default;
    return await jcrStore.batchLookupQuartiles(names);
  } catch (e) {
    safeDebug("[z-search] academic-scorer.prefetchJCRQuartiles failed: " + e);
    return new Map();
  }
}

/**
 * Prefetch all journal quality metrics (JCR, CASS, Warning) for a batch of articles.
 * Returns a tuple of [jcrQuartileMap, cassQuartileMap, warningSet].
 */
export async function prefetchMetrics(
  articles: Array<{ containerTitle?: string }>,
): Promise<{
  jcrQuartileMap: Map<string, string>;
  cassQuartileMap: Map<string, { quartile: number; isTop: boolean }>;
  warningSet: Set<string>;
}> {
  const names = articles
    .map((a) => a.containerTitle)
    .filter((n): n is string => !!n);

  const emptyResult = {
    jcrQuartileMap: new Map<string, string>(),
    cassQuartileMap: new Map<string, { quartile: number; isTop: boolean }>(),
    warningSet: new Set<string>(),
  };
  if (names.length === 0) return emptyResult;

  const [jcrQuartileMap, cassQuartileMap, warningMap] = await Promise.all([
    prefetchJCRQuartiles(articles),
    (async () => {
      try {
        const cassStore = (await import("../../data/CASSStore")).default;
        return await cassStore.batchLookupQuartiles(names);
      } catch (e) {
        safeDebug(
          "[z-search] academic-scorer.prefetchCASSQuartiles failed: " + e,
        );
        return new Map<string, { quartile: number; isTop: boolean }>();
      }
    })(),
    (async () => {
      try {
        const warningStore = (await import("../../data/WarningListStore"))
          .default;
        return await warningStore.batchLookupWarnings(names);
      } catch (e) {
        safeDebug(
          "[z-search] academic-scorer.prefetchWarningList failed: " + e,
        );
        return new Map<string, any>();
      }
    })(),
  ]);

  const warningSet = new Set(warningMap.keys());
  return { jcrQuartileMap, cassQuartileMap, warningSet };
}

/**
 * Score an academic article across 4 dimensions.
 *
 * Total: ~0-25 (weighted sum of raw scores, max 30+30+15+15 weighted by 0.33/0.33/0.17/0.17).
 * @param jcrQuartileMap - Prefetched JCR quartile map (from prefetchJCRQuartiles)
 * @param cassQuartileMap - Prefetched CASS quartile map (from prefetchMetrics)
 * @param warningSet - Set of warning journal names (from prefetchMetrics)
 */
export function scoreAcademicArticle(
  meta: AcademicArticleMeta,
  jcrQuartileMap?: Map<string, string>,
  cassQuartileMap?: Map<string, { quartile: number; isTop: boolean }>,
  warningSet?: Set<string>,
): AcademicScorerResult {
  const factors: ScoreFactor[] = [];

  const s1 = citationScore(meta.citationCount);
  factors.push({
    name: "Citation Impact",
    score: s1,
    weight: 0.33,
    contribution: s1 * 0.33,
    note: `${meta.citationCount} citations`,
  });

  const s2 = journalTierScore(
    meta.containerTitle,
    meta.source,
    jcrQuartileMap,
    cassQuartileMap,
    warningSet,
  );
  factors.push({
    name: "Journal Tier",
    score: s2,
    weight: 0.33,
    contribution: s2 * 0.33,
    note:
      jcrQuartileMap && meta.containerTitle
        ? `${meta.containerTitle} (${jcrQuartileMap.get(meta.containerTitle.toUpperCase()) ?? "not found"})`
        : (meta.containerTitle ?? meta.source),
  });

  const s3 = recencyScore(meta.year);
  factors.push({
    name: "Recency",
    score: s3,
    weight: 0.17,
    contribution: s3 * 0.17,
    note: `${meta.year}`,
  });

  const s4 = peerReviewScore(meta.publicationType, meta.doi);
  factors.push({
    name: "Peer Review",
    score: s4,
    weight: 0.17,
    contribution: s4 * 0.17,
    note: meta.publicationType ?? (meta.doi ? "has DOI" : "unknown"),
  });

  const total = Math.round(factors.reduce((sum, f) => sum + f.contribution, 0));

  return { score: total, factors };
}
