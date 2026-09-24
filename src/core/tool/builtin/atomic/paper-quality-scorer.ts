/**
 * Paper Quality Scorer — heuristic + AI paper scoring
 *
 * Extracted from paper-scorer.ts for SRP.
 *
 * Architecture: Atomic Capability → Used by skill handlers
 */

import { withOpenalexAuth } from "../../../../utils/openalexAuth";
import { ZSEARCH_HTTP_HEADERS } from "../../../../utils/httpHeaders";
import { safeDebug } from "../../../../utils/logger";

// --- Paper metadata cache (Semantic Scholar + OpenAlex) ---

interface PaperMetaCache {
  s2CitationCount: number;
  s2OpenAccess: boolean;
  oaJournalCitations: number;
  timestamp: number;
}

const paperMetaCache = new Map<string, PaperMetaCache>();
const PAPER_META_CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const PAPER_META_CACHE_MAX = 500;

/**
 * Fetch paper metadata from Semantic Scholar and OpenAlex APIs.
 * Returns unified cache object.
 */
async function fetchPaperMetadata(doi: string): Promise<PaperMetaCache> {
  const result: PaperMetaCache = {
    s2CitationCount: 0,
    s2OpenAccess: false,
    oaJournalCitations: 0,
    timestamp: Date.now(),
  };

  // Semantic Scholar: citation count + open access
  try {
    const s2Url = `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}?fields=citationCount,openAccessPdf`;
    const s2Resp = await Zotero.HTTP.request("GET", s2Url, {
      headers: {
        Accept: "application/json",
        ...ZSEARCH_HTTP_HEADERS,
      },
      // Fail fast on 429/5xx instead of inheriting Zotero's default
      // up-to-1h retry backoff (http.js:1528+) — S2 rate-limits
      // aggressively and this is optional enrichment.
      errorDelayMax: 0,
    } as any);
    if (s2Resp.status < 400) {
      const s2Data = JSON.parse(s2Resp.responseText ?? "");
      result.s2CitationCount = s2Data.citationCount ?? 0;
      result.s2OpenAccess = !!s2Data.openAccessPdf;
    }
  } catch (e) {
    safeDebug("[z-search] paper-quality-scorer: " + e);
    // S2 data optional
  }

  // OpenAlex: journal total citations as impact proxy
  try {
    const oaHeaders: Record<string, string> = {
      Accept: "application/json",
      ...ZSEARCH_HTTP_HEADERS,
    };
    let oaUrl = `https://api.openalex.org/works/doi:${encodeURIComponent(doi)}?select=primary_location.source.cited_by_count`;
    oaUrl = withOpenalexAuth(oaUrl);
    const oaResp = await Zotero.HTTP.request("GET", oaUrl, {
      headers: oaHeaders,
      errorDelayMax: 0,
    } as any);
    if (oaResp.status < 400) {
      const oaData = JSON.parse(oaResp.responseText ?? "");
      result.oaJournalCitations =
        oaData?.primary_location?.source?.cited_by_count ?? 0;
    }
  } catch (e) {
    safeDebug("[z-search] paper-quality-scorer: " + e);
    // OpenAlex data optional
  }

  return result;
}

// --- Paper scoring ---

export type ScoreDimension =
  "overall" | "relevance" | "quality" | "impact" | "novelty" | "evidence";

export interface PaperScore {
  /** Item ID */
  itemId: number;
  /** Overall score 0-100 */
  overall: number;
  /** Dimension-specific scores 0-100 */
  dimensions: Partial<Record<ScoreDimension, number>>;
  /** Breakdown of factors that contributed to score */
  factors: ScoreFactor[];
  /** Scoring method used */
  method: "heuristic" | "ai";
}

export interface ScoreFactor {
  name: string;
  score: number; // 0-100
  weight: number; // 0-1
  contribution: number; // score * weight
  note?: string;
}

/**
 * Calculate a heuristic quality score based on available metadata.
 *
 * Factors (weighted):
 * - Citation count (S2) 20% - log-scale normalization
 * - Recency 15% - newer papers score higher
 * - Venue type 15% - journal vs conference vs preprint
 * - Abstract detail 10% - longer abstract correlates with thoroughness
 * - Open Access 10% - OA papers have higher visibility
 * - Journal Impact (OpenAlex) 30% - journal total citations as impact proxy
 */
export async function heuristicScorePaper(itemId: number): Promise<PaperScore> {
  const item = await Zotero.Items.getAsync(itemId);
  if (!item) {
    throw new Error(`Item ${itemId} not found`);
  }

  const factors: ScoreFactor[] = [];
  const doi = item.getField("DOI") || "";

  let meta = {
    s2CitationCount: 0,
    s2OpenAccess: false,
    oaJournalCitations: 0,
    timestamp: 0,
  };
  if (doi) {
    const cached = paperMetaCache.get(doi);
    if (cached && Date.now() - cached.timestamp < PAPER_META_CACHE_TTL) {
      meta = cached;
    } else {
      meta = await fetchPaperMetadata(doi);
      // Evict oldest entries when cache exceeds limit
      if (paperMetaCache.size >= PAPER_META_CACHE_MAX) {
        const oldest = [...paperMetaCache.entries()]
          .sort((a, b) => a[1].timestamp - b[1].timestamp)
          .slice(0, paperMetaCache.size - PAPER_META_CACHE_MAX + 1);
        for (const [key] of oldest) paperMetaCache.delete(key);
      }
      paperMetaCache.set(doi, meta);
    }
  }

  // Factor 1: Citation count (Semantic Scholar, log scale)
  const citationScore =
    meta.s2CitationCount > 0
      ? Math.min(100, Math.log10(meta.s2CitationCount + 1) * 25)
      : 0;
  factors.push({
    name: "Citation Count",
    score: citationScore,
    weight: 0.2,
    contribution: citationScore * 0.2,
    note: `${meta.s2CitationCount} citations`,
  });

  // Factor 2: Recency
  const dateStr = item.getField("date") || "";
  const year = parseInt(dateStr.match(/\d{4}/)?.[0] || "1900");
  const currentYear = new Date().getFullYear();
  const age = currentYear - year;
  const recencyScore = age <= 0 ? 100 : Math.max(0, 100 - age * 10);
  factors.push({
    name: "Recency",
    score: recencyScore,
    weight: 0.15,
    contribution: recencyScore * 0.15,
    note: `Published ${age} years ago`,
  });

  // Factor 3: Venue type
  const itemType = item.itemType;
  let venueScore = 50;
  if (itemType === "journalArticle") venueScore = 80;
  else if (itemType === "conferencePaper") venueScore = 75;
  else if (itemType === "preprint") venueScore = 40;
  else if (itemType === "book") venueScore = 85;
  factors.push({
    name: "Venue Type",
    score: venueScore,
    weight: 0.15,
    contribution: venueScore * 0.15,
    note: itemType,
  });

  // Factor 4: Abstract detail
  const abstract = item.getField("abstractNote") || "";
  const abstractScore = Math.min(100, abstract.length / 3);
  factors.push({
    name: "Abstract Detail",
    score: abstractScore,
    weight: 0.1,
    contribution: abstractScore * 0.1,
    note: `${abstract.length} chars`,
  });

  // Factor 5: Open Access
  const oaScore = meta.s2OpenAccess ? 100 : 0;
  factors.push({
    name: "Open Access",
    score: oaScore,
    weight: 0.1,
    contribution: oaScore * 0.1,
    note: meta.s2OpenAccess ? "Open access" : "Paywalled",
  });

  // Factor 6: Journal Impact — priority: JCR IF > OpenAlex journal citations > venue type
  let journalImpactScore: number;
  let journalImpactNote: string;

  const publicationTitle = item.getField("publicationTitle") || "";
  const issn = item.getField("ISSN") || "";

  if (publicationTitle || issn) {
    try {
      const jcrStore = (await import("../../../data/JCRStore")).default;
      const jcrRecord = await jcrStore.lookup({
        issn: issn || undefined,
        journalName: publicationTitle || undefined,
      });
      if (jcrRecord && jcrRecord.jif != null && jcrRecord.jif > 0) {
        journalImpactScore = Math.min(100, Math.log10(jcrRecord.jif + 1) * 25);
        journalImpactNote = `JCR IF ${jcrRecord.jif.toFixed(2)} (${jcrRecord.jif_quartile || "no quartile"})`;
      } else if (meta.oaJournalCitations > 0) {
        journalImpactScore = Math.min(
          100,
          Math.log10(meta.oaJournalCitations + 1) * 12,
        );
        journalImpactNote = `${meta.oaJournalCitations} journal citations (OpenAlex)`;
      } else {
        journalImpactScore = venueScore;
        journalImpactNote = "Fallback to venue type";
      }
    } catch (e) {
      safeDebug("[z-search] paper-quality-scorer: " + e);
      if (meta.oaJournalCitations > 0) {
        journalImpactScore = Math.min(
          100,
          Math.log10(meta.oaJournalCitations + 1) * 12,
        );
        journalImpactNote = `${meta.oaJournalCitations} journal citations (OpenAlex)`;
      } else {
        journalImpactScore = venueScore;
        journalImpactNote = "Fallback to venue type";
      }
    }
  } else if (meta.oaJournalCitations > 0) {
    journalImpactScore = Math.min(
      100,
      Math.log10(meta.oaJournalCitations + 1) * 12,
    );
    journalImpactNote = `${meta.oaJournalCitations} journal citations (OpenAlex)`;
  } else {
    journalImpactScore = venueScore;
    journalImpactNote = "Fallback to venue type";
  }

  // Warning list veto: journals on the warning list get journal impact = 0
  if (publicationTitle) {
    try {
      const warningStore = (await import("../../../data/WarningListStore"))
        .default;
      // F-38：null = 查询失败（状态未知），不得当作"不在名单"静默放行
      const isWarned = await warningStore.isWarning(publicationTitle);
      if (isWarned === true) {
        journalImpactScore = 0;
        journalImpactNote += " [WARNING: journal on warning list]";
      } else if (isWarned === null) {
        journalImpactNote += " [warning-list lookup failed — status unknown]";
      }
    } catch (e) {
      safeDebug(
        "[z-search] paper-quality-scorer: " + e,
      ); /* Warning store may not be available */
    }
  }

  // Beall's List veto: predatory journals get journal impact = 0
  if (publicationTitle) {
    try {
      const beallsStore = (await import("../../../data/BeallsListStore"))
        .default;
      const beallsResult = await beallsStore.checkItem(
        publicationTitle,
        item.getField("publisher") || undefined,
        item.getField("url") || undefined,
      );
      if (beallsResult.isPredatory) {
        journalImpactScore = 0;
        const layer = beallsResult.bestLayer || "unknown";
        journalImpactNote += ` [PREDATORY: Beall's list (${layer}, ${Math.round(beallsResult.confidence * 100)}%)]`;
      }
    } catch (e) {
      safeDebug(
        "[z-search] paper-quality-scorer: " + e,
      ); /* Beall's store may not be available */
    }
  }

  factors.push({
    name: "Journal Impact",
    score: journalImpactScore,
    weight: 0.3,
    contribution: journalImpactScore * 0.3,
    note: journalImpactNote,
  });

  // Calculate weighted overall score
  const overall = factors.reduce((sum, f) => sum + f.contribution, 0);

  return {
    itemId,
    overall: Math.round(overall),
    dimensions: {
      impact: Math.round(citationScore),
      quality: Math.round(journalImpactScore),
      novelty: Math.round(recencyScore),
    },
    factors,
    method: "heuristic",
  };
}

/**
 * AI-based paper scoring using a language model.
 *
 * Asks the AI to rate the paper on multiple dimensions.
 * More accurate but costs API calls.
 *
 * @param itemId - Paper to score
 * @param dimensions - Which scoring dimensions to evaluate
 * @param model - AI model to use (vision-capable recommended for figure analysis)
 * @returns AI-generated scores with reasoning
 */
export async function aiScorePaper(
  itemId: number,
  dimensions: ScoreDimension[] = ["overall", "quality", "impact", "novelty"],
  model?: string,
): Promise<PaperScore> {
  const item = await Zotero.Items.getAsync(itemId);
  if (!item) {
    throw new Error(`Item ${itemId} not found`);
  }

  const title = item.getField("title") || "";
  const abstract = item.getField("abstractNote") || "";
  const authors = item.getField("firstCreator") || "";
  const date = item.getField("date") || "";
  const itemType = item.itemType;

  const { extractPdfTextByPage } = await import("./pdf-text-extractor");
  const pdfResult = await extractPdfTextByPage(itemId, 5); // First 5 pages only for scoring
  const paperExcerpt = pdfResult.success
    ? pdfResult.pages
        .map((p) => p.text)
        .join("\n\n")
        .slice(0, 8000)
    : "";

  const prompt = `You are an expert academic paper reviewer.

Rate the following paper on a scale of 0-100 for each dimension:

${dimensions.map((d) => `- ${d}`).join("\n")}

Paper Information:
- Title: ${title}
- Authors: ${authors}
- Date: ${date}
- Type: ${itemType}
- Abstract: ${abstract}

${paperExcerpt ? `\nPaper Excerpt (first ${Math.ceil(paperExcerpt.length / 500)} paragraphs):\n${paperExcerpt}` : ""}

Consider:
- Methodological rigor and clarity
- Significance of findings
- Novelty and originality
- Quality of presentation
- Potential impact on the field
${
  dimensions.includes("evidence")
    ? `
For the "evidence" dimension specifically (cross-discipline, NOT medical-only):
- Sample size adequacy relative to the claim's scope (small samples supporting broad claims = lower)
- Whether methods address plausible confounds / alternative explanations
- Reproducibility signals (data/code availability, clear procedure description)
- Whether the conclusion strength matches what the data actually shows
- Do NOT apply clinical-trial-specific checklists (GRADE/RoB). Judge evidence strength
  as a general researcher would across any field (empirical, computational, theoretical).
- Score 90-100 = compelling, well-controlled, appropriately scoped; 50-69 = moderate,
  some limitations; below 50 = weak, overclaimed, or methodologically thin.`
    : ""
}
Output JSON format:
{
  "overall": 0-100,
  "quality": 0-100,
  "impact": 0-100,
  "novelty": 0-100,
  ${dimensions.includes("evidence") ? `"evidence": 0-100,` : ""}
  "reasoning": "Brief explanation of scores"
}`;

  try {
    const { default: modelRouter } = await import("../../../ai/ModelRouter");
    const provider = modelRouter.resolve("bg.paper-scorer");

    if (!provider) {
      throw new Error("No AI provider configured");
    }

    const result = await provider.execute({
      messages: [{ role: "system", content: prompt }],
      model,
      maxTokens: 500,
    });

    const jsonMatch = result.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Failed to parse AI response");
    }

    const scores = JSON.parse(jsonMatch[0]);

    const factors: ScoreFactor[] = [
      {
        name: "AI Assessment",
        score: scores.overall || 50,
        weight: 1,
        contribution: scores.overall || 50,
        note: scores.reasoning?.slice(0, 100),
      },
    ];

    return {
      itemId,
      overall: Math.round(scores.overall || 50),
      dimensions: {
        quality: Math.round(scores.quality || 50),
        impact: Math.round(scores.impact || 50),
        novelty: Math.round(scores.novelty || 50),
      },
      factors,
      method: "ai",
    };
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (e: any) {
    // Fallback to heuristic on AI failure
    return heuristicScorePaper(itemId);
  }
}
