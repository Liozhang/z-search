/**
 * DiscoveryEngine types and constants.
 */

/** Stop words for rule-based query expansion fallback */
export const QUERY_EXPANSION_STOP_WORDS = new Set([
  "this",
  "that",
  "with",
  "from",
  "have",
  "been",
  "they",
  "them",
  "their",
  "your",
  "about",
  "which",
  "what",
  "when",
  "where",
  "there",
  "would",
  "could",
  "should",
  "more",
  "some",
  "other",
  "also",
  "into",
  "over",
  "after",
  "before",
  "between",
  "through",
  "than",
  "then",
  "very",
  "just",
  "only",
  "such",
  "each",
  "every",
  "these",
  "those",
  "latest",
  "best",
  "most",
  "the",
  "and",
  "for",
  "are",
  "but",
  "not",
  "you",
  "all",
  "can",
  "had",
  "her",
  "was",
  "one",
  "our",
  "out",
  "how",
  "new",
  "old",
  "see",
  "way",
  "who",
  "did",
  "get",
  "use",
  "using",
  "used",
  "based",
  "method",
  "study",
  "data",
  "analysis",
  "approach",
  "review",
  "overview",
  "tutorial",
]);

/** AI-extracted related concept from a paper */
export interface RelatedConcept {
  concept: string;
  conceptZh?: string;
  type: "method" | "dataset" | "framework" | "domain" | "technique" | "theory";
  relevance: number; // 0-1
  context: string;
}

/** AI-evaluated discovered paper */
export interface DiscoveredPaper {
  title: string;
  authors: string;
  year: number | string;
  doi: string;
  abstract: string;
  citationCount: number;
  source: string;
  containerTitle?: string;
  journalName?: string;
  issn?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  publicationType?: string;
  publisher?: string;
  // AI evaluation fields
  relevanceScore: number; // 0-100 (fused score when available)
  paperType: string;
  relevanceReason: string;
  keyContribution: string;
  queryOrigin: string;
  // Heuristic + fusion fields (populated by aiEvaluatePapers)
  heuristicScore?: number;
  fusedScore?: number;
  fullTextAvailable?: boolean;
}

/** AI-generated research suggestion */
export interface ResearchSuggestion {
  gapDescription: string;
  suggestedQueries: string[];
  relatedConcepts: string[];
  priority: "high" | "medium" | "low";
  reasoning: string;
}

/** Blacklist for filtering low-quality sources */
export interface DiscoveryBlacklist {
  domains: string[];
  journals: string[];
}

/** Extended filter config with whitelist support */
export interface DiscoveryFilterConfig {
  blacklist: DiscoveryBlacklist;
  whitelist: {
    domains: string[];
    journals: string[];
  };
}

export const DEFAULT_BLACKLIST: DiscoveryBlacklist = {
  domains: [
    "academia.edu",
    "researchgate.net",
    "medium.com",
    "csdn.net",
    "zhihu.com",
  ],
  journals: [],
};

export const DEFAULT_WHITELIST = {
  domains: [] as string[],
  journals: [] as string[],
};

export const BLACKLIST_PREF = "discovery.blacklist";
export const WHITELIST_PREF = "discovery.whitelist";
export const CONCEPT_MEMORY_PREFIX = "discovery:concept:";
