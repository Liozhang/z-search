/**
 * Screening triage — decision-model (System 1/JEV-class) pre-screen for
 * discovery candidates, inserted before the LLM batch evaluation in
 * DiscoveryEngine.discoverRelated.
 *
 * Ensemble law (per the screening literature): high-confidence relevant
 * papers skip the LLM evaluation, high-confidence irrelevant papers are
 * dropped, and the uncertain band goes to the existing LLM evaluation
 * unchanged. Any decision failure (service off, breaker tripped, per-paper
 * error) degrades to the legacy path for the affected papers — the triage
 * never removes results the legacy path would have produced.
 */

import { getPrefDynamic } from "../../utils/prefs";
import { safeDebug } from "../../utils/logger";
import decisionService from "./DecisionService";
import { noulOf, DecisionQuestion } from "./decisionTypes";
import {
  DEFAULT_DECISION_SCREEN_EXCLUDE,
  DEFAULT_DECISION_SCREEN_INCLUDE,
} from "../../utils/defaults";
import type { DiscoveredPaper, RelatedConcept } from "../search/DiscoveryTypes";

export interface TriageResult {
  /** False when the decision path never ran (service off/unavailable). */
  ran: boolean;
  /** High-confidence relevant — bypass the LLM evaluation. */
  autoInclude: DiscoveredPaper[];
  /** Uncertain band + all fallbacks — goes to aiEvaluatePapers as before. */
  midBand: any[];
}

const MAX_CONCURRENT = 3;
const ABSTRACT_SLICE = 1500;

function toThreshold(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 && n < 1 ? n : fallback;
}

function relevanceQuestion(
  sourceTitle: string,
  concepts: RelatedConcept[],
): DecisionQuestion {
  const conceptsStr = concepts.map((c) => c.concept).join(", ");
  return {
    type: "noul",
    instructions:
      `Relevance screen: should this paper be considered for a reading list built from "${sourceTitle}"?` +
      (conceptsStr ? ` Core concepts: ${conceptsStr}.` : ""),
    criteria: {
      true: "The paper's main topic directly studies or applies the source direction or its core concepts.",
      false:
        "The paper only mentions a concept in passing, or is unrelated to the source direction.",
    },
  };
}

export async function triagePapers(
  papers: any[],
  sourceTitle: string,
  concepts: RelatedConcept[],
): Promise<TriageResult> {
  if (papers.length === 0 || !decisionService.isAvailable()) {
    return { ran: false, autoInclude: [], midBand: papers };
  }

  const includeAt = toThreshold(
    getPrefDynamic("decision.screen.include"),
    DEFAULT_DECISION_SCREEN_INCLUDE,
  );
  const excludeAt = toThreshold(
    getPrefDynamic("decision.screen.exclude"),
    DEFAULT_DECISION_SCREEN_EXCLUDE,
  );
  const question = relevanceQuestion(sourceTitle, concepts);

  // Per-paper verdict: null = dropped (high-confidence irrelevant), number =
  // auto-include probability; undefined slot = mid band (uncertain or failed).
  const verdicts: Array<number | null | undefined> = new Array(
    papers.length,
  ).fill(undefined);
  let cursor = 0;
  let stopped = false;

  const worker = async (): Promise<void> => {
    while (!stopped) {
      const i = cursor;
      if (i >= papers.length) return;
      cursor += 1;
      const paper = papers[i];
      try {
        const answers = await decisionService.decide(
          {
            title: paper.title || "",
            abstract: (paper.abstract || "").slice(0, ABSTRACT_SLICE),
            year: paper.year || "",
            containerTitle: paper.containerTitle || "",
            citationCount: paper.citationCount ?? 0,
          },
          { relevant: question },
        );
        const p = noulOf(answers.relevant);
        if (p === undefined) continue; // uncertain → mid band
        if (p >= includeAt) verdicts[i] = p;
        else if (p <= excludeAt) verdicts[i] = null;
      } catch (e) {
        // This paper stays in the mid band (legacy path decides). If the
        // breaker tripped mid-run, stop issuing new calls — remaining papers
        // all fall to the mid band.
        safeDebug("[z-search] screeningTriage: paper decision failed: " + e);
        if (!decisionService.isAvailable()) stopped = true;
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(MAX_CONCURRENT, papers.length) }, () =>
      worker(),
    ),
  );

  const midBand: any[] = [];
  const hits: Array<{ paper: any; probability: number }> = [];
  for (let i = 0; i < papers.length; i += 1) {
    const v = verdicts[i];
    if (typeof v === "number") hits.push({ paper: papers[i], probability: v });
    else if (v === undefined) midBand.push(papers[i]);
    // null = high-confidence irrelevant → dropped
  }

  return {
    ran: true,
    autoInclude: await buildAutoInclude(hits, concepts),
    midBand,
  };
}

/** Map a triage hit to DiscoveredPaper, mirroring PaperEvaluator's shape. */
async function buildAutoInclude(
  hits: Array<{ paper: any; probability: number }>,
  concepts: RelatedConcept[],
): Promise<DiscoveredPaper[]> {
  if (hits.length === 0) return [];
  const { heuristicScoreSearchResult } =
    await import("../search/scoring/search-result-scorer");
  const conceptKeywords = concepts.map((c) => c.concept);

  return hits.map(({ paper: original, probability }) => {
    const heuristic = heuristicScoreSearchResult(
      {
        title: original.title || "",
        abstract: original.abstract || "",
        citationCount: original.citationCount ?? 0,
        year: original.year || "",
        source: original.source || "",
        url: original.url || original.pdfUrl || original.oaUrl || "",
        containerTitle: original.containerTitle || "",
      },
      null,
      conceptKeywords.length > 0 ? conceptKeywords : undefined,
    );
    const score = Math.round(probability * 100);
    return {
      title: original.title || "",
      authors: original.authors || "",
      year: original.year || "",
      doi: original.doi || "",
      abstract: original.abstract || "",
      citationCount: original.citationCount ?? 0,
      source: original.source || "openalex",
      containerTitle: original.containerTitle || "",
      journalName: original.journalName || original.containerTitle || undefined,
      issn: original.issn || undefined,
      volume: original.volume || undefined,
      issue: original.issue || undefined,
      pages: original.pages || undefined,
      publicationType: original.publicationType || undefined,
      publisher: original.publisher || undefined,
      relevanceScore: score,
      paperType: "research",
      relevanceReason: `decision triage p=${probability.toFixed(2)}`,
      keyContribution: "",
      queryOrigin: original._queryOrigin || "",
      heuristicScore: heuristic.score,
      fusedScore: score,
      fullTextAvailable: heuristic.fullTextAvailable,
    } satisfies DiscoveredPaper;
  });
}
