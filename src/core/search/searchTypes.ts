/**
 * Shared types for the deep-search pipeline.
 *
 * Extracted from SearchPipeline.ts to break the circular dependency:
 *   SearchPipeline -> DiscoveryEngine -> SearchLearning -> SearchPipeline
 */

/**
 * A paper candidate produced by the search pipeline.
 */
export interface FusionPaper {
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
  url: string;
  pdfUrl?: string;
  oaUrl?: string;
  // Scoring fields
  heuristicScore: number;
  aiScore: number;
  fusedScore: number;
  // Pipeline metadata
  round: number;
  searchSources: string[];
  fullTextAvailable: boolean;
  // AI evaluation fields
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
  queryOrigin: string;
  /** Full text content (post-cleaned), available when fetchFullText succeeded */
  fullText?: string;
}
