/**
 * Search Result Scorer — heuristic scoring for web search results
 *
 * Extracted from paper-scorer.ts for SRP.
 */

import type { ScoreFactor } from "../../tool/builtin/atomic/paper-quality-scorer";
import { safeDebug } from "../../../utils/logger";

/** Domain authority scores */
export const DOMAIN_AUTHORITY: Record<string, number> = {
  // Top academic journals
  "nature.com": 10,
  "science.org": 10,
  "cell.com": 10,
  "nejm.org": 10,
  "lancet.com": 10,
  "pnas.org": 8,
  "pubmed.ncbi.nlm.nih.gov": 8,
  "pmc.ncbi.nlm.nih.gov": 8, // Preprints
  "biorxiv.org": 6,
  "medrxiv.org": 6,
  "arxiv.org": 5,
  // AI/ML deep content
  "distill.pub": 9,
  "lilianweng.github.io": 8,
  "jalammar.github.io": 8,
  "thegradient.pub": 8,
  "paperswithcode.com": 7, // Major AI labs
  "deepmind.google": 9,
  "deepmind.com": 9,
  "openai.com": 8,
  "research.google": 8,
  "ai.meta.com": 7,
  "blog.google": 7,
  "anthropic.com": 8,
  // Biology foundation models
  "evolutionaryscale.ai": 9,
  "profluent.ai": 7,
  "isomorphiclabs.com": 8,
  // AI medical
  "thelancet.com/digital-health": 10,
  "npjdigitalmed.org": 9,
  "jamanetwork.com": 8, // Agent/tools
  "langchain.com": 7,
  "llamaindex.ai": 7,
  "simonwillison.net": 7, // Community/bioinformatics
  "biostars.org": 7,
  "bioconductor.org": 8, // General
  "github.com": 4,
  "medium.com": 3,
};

/** Content feature detection patterns */
const CODE_PATTERN =
  /```|import |def |class |library\(|pip install|conda install/;
const REFERENCE_PATTERN = /\[\d+\]|References|et al\.|doi:/;
const FIGURE_PATTERN = /Figure \d|Table \d|图\d|表\d/;
const STATISTICS_PATTERN = /p\s*[<>=]\s*0\.0?\d|n\s*=\s*\d+|CI\s*=/;

/** Search result metadata for heuristic scoring */
export interface SearchResultMeta {
  title: string;
  abstract: string;
  citationCount: number;
  year: number | string;
  source: string;
  url?: string;
  containerTitle?: string;
}

export interface HeuristicResult {
  score: number;
  factors: ScoreFactor[];
  fullTextAvailable: boolean;
}

/**
 * Heuristic scoring for search results
 *
 * When keywords provided (from AI query expansion): 5-dimension weighted scale
 * - Content Length (0-30, 30%): optimal 2000-5000 words
 * - Title Quality (0-20, 20%): 10-200 chars optimal
 * - Dynamic Keyword Matching (0-25, 25%): query-relevant keyword matching
 * - Source Authority (0-15, 15%): domain-based scoring
 * - Content Features (0-10, 10%): code, references, figures, statistics
 *
 * When no keywords: 4-dimension scale (keyword weight redistributed)
 * - Content Length (40%), Title Quality (25%), Source Authority (20%), Content Features (15%)
 *
 * When fullText is unavailable, uses abstract-only fallback for dimensions 1 and 4/5.
 */
export function heuristicScoreSearchResult(
  paper: SearchResultMeta,
  fullText?: string | null,
  keywords?: string[],
): HeuristicResult {
  const factors: ScoreFactor[] = [];
  const hasFullText = !!fullText && fullText.length > 100;
  const content = hasFullText ? fullText! : paper.abstract;
  const wordCount = content ? content.split(/\s+/).length : 0;
  const hasKeywords = !!(keywords && keywords.length > 0);

  // Dynamic weights: 5-dimension when keywords available, 4-dimension when not
  const W_LENGTH = hasKeywords ? 0.3 : 0.4;
  const W_TITLE = hasKeywords ? 0.2 : 0.25;
  const W_KEYWORD = 0.25;
  const W_AUTHORITY = hasKeywords ? 0.15 : 0.2;
  const W_FEATURES = hasKeywords ? 0.1 : 0.15;

  // Dimension 1: Content length (0-30)
  let lengthScore: number;
  if (hasFullText) {
    if (wordCount < 500) lengthScore = 0;
    else if (wordCount > 50000) lengthScore = 10;
    else if (wordCount <= 2000)
      lengthScore = Math.round((wordCount / 2000) * 30);
    else if (wordCount <= 5000) lengthScore = 30;
    else lengthScore = Math.round(30 - ((wordCount - 5000) / 45000) * 20);
  } else {
    // Abstract-only: map length to score
    const abstractLen = paper.abstract.length;
    if (abstractLen < 50) lengthScore = 5;
    else if (abstractLen <= 300)
      lengthScore = Math.round((abstractLen / 300) * 20);
    else if (abstractLen <= 1000) lengthScore = 30;
    else lengthScore = 25;
  }
  factors.push({
    name: hasFullText ? "Content Length" : "Abstract Detail",
    score: lengthScore,
    weight: W_LENGTH,
    contribution: lengthScore * W_LENGTH,
    note: hasFullText ? `${wordCount} words` : `${paper.abstract.length} chars`,
  });

  // Dimension 2: Title quality (0-20)
  const titleLen = (paper.title || "").length;
  let titleScore: number;
  if (!paper.title) titleScore = 0;
  else if (titleLen >= 10 && titleLen <= 200) titleScore = 20;
  else if (titleLen >= 5 && titleLen <= 300) titleScore = 10;
  else titleScore = 5;
  factors.push({
    name: "Title Quality",
    score: titleScore,
    weight: W_TITLE,
    contribution: titleScore * W_TITLE,
    note: `${titleLen} chars`,
  });

  // Dimension 3: Dynamic keyword matching (only when keywords provided)
  if (hasKeywords) {
    const titleLower = (paper.title || "").toLowerCase();
    const contentLower = (content || "").slice(0, 3000).toLowerCase();
    let titleMatches = 0;
    let contentMatches = 0;
    for (const kw of keywords!) {
      const kwLower = kw.toLowerCase();
      if (titleLower.includes(kwLower)) titleMatches++;
      if (contentLower.includes(kwLower)) contentMatches++;
    }
    const keywordScore = Math.min(25, contentMatches * 3 + titleMatches * 2);
    factors.push({
      name: "Keyword Match",
      score: keywordScore,
      weight: W_KEYWORD,
      contribution: keywordScore * W_KEYWORD,
      note: `${titleMatches} title + ${contentMatches} content matches`,
    });
  }

  // Dimension 4: Source authority (0-15)
  const domain = extractDomain(paper.url || "");
  let authorityScore = 3; // default for unknown
  for (const [site, score] of Object.entries(DOMAIN_AUTHORITY)) {
    if (domain.includes(site)) {
      authorityScore = score;
      break;
    }
  }
  factors.push({
    name: "Source Authority",
    score: authorityScore,
    weight: W_AUTHORITY,
    contribution: authorityScore * W_AUTHORITY,
    note: domain || "unknown",
  });

  // Dimension 5: Content features (0-10) or Citation count (0-10)
  let featureScore: number;
  if (hasFullText) {
    // Full text: detect code, references, figures, statistics
    let features = 0;
    if (CODE_PATTERN.test(content!)) features += 3;
    if (REFERENCE_PATTERN.test(content!)) features += 3;
    if (FIGURE_PATTERN.test(content!)) features += 2;
    if (STATISTICS_PATTERN.test(content!)) features += 2;
    featureScore = Math.min(10, features);
  } else {
    // Abstract-only: use citation count as proxy
    featureScore =
      paper.citationCount > 0
        ? Math.min(10, Math.log10(paper.citationCount + 1) * 3)
        : 0;
  }
  factors.push({
    name: hasFullText ? "Content Features" : "Citation Count",
    score: featureScore,
    weight: W_FEATURES,
    contribution: featureScore * W_FEATURES,
    note: hasFullText
      ? `${CODE_PATTERN.test(content!) ? "code " : ""}${REFERENCE_PATTERN.test(content!) ? "refs " : ""}${FIGURE_PATTERN.test(content!) ? "figs " : ""}${STATISTICS_PATTERN.test(content!) ? "stats" : ""}`
      : `${paper.citationCount} citations`,
  });

  const overall = Math.round(
    factors.reduce((sum, f) => sum + f.contribution, 0),
  );

  return { score: overall, factors, fullTextAvailable: hasFullText };
}

/** Extract domain from URL */
function extractDomain(url: string): string {
  try {
    const match = url.match(/^https?:\/\/([^/]+)/);
    if (!match) return "";
    let domain = match[1].toLowerCase();
    if (domain.startsWith("www.")) domain = domain.slice(4);
    return domain;
  } catch (e) {
    safeDebug("[z-search] search-result-scorer: " + e);
    return "";
  }
}
