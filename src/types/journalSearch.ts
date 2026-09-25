/**
 * Shared types for Journal Search — imported by both:
 *   - React iframe side (src/react/components/Hub/search/JournalSearch/types.ts)
 *   - Zotero main-script bridge (src/ui/hub/HubWindowBridge.ts → JournalSearchService)
 *
 * Lives under src/types/ so it is reachable from both tsconfig scopes (same
 * pattern as literatureSearch.ts).
 *
 * @module types/journalSearch
 */

/** Where the journal data came from. Local = one of the 4 local DB tables
 *  (JCR/CASS/Warning/Bealls) hit; openalex = fell back to OpenAlex /sources. */
export type JournalDataSource = "local" | "openalex";

/** CAS minor-category entry for the metric card. */
export interface JournalMinorCategory {
  /** English subject name. */
  name: string;
  /** Chinese subject name. */
  nameCn: string;
  /** Quartile 1-4. */
  quartile: number;
}

/** One research topic the journal publishes (its scope). From OpenAlex. */
export interface JournalTopic {
  displayName: string;
  field?: string;
  count?: number;
}

/** Full journal metric card (mode 'metric'). Populated from the local JCR/
 *  CASS/Warning/Bealls tables when available, with OpenAlex fields filling in
 *  or replacing when the local lookup misses. */
export interface JournalMetric {
  source: JournalDataSource;
  name: string;
  issn?: string;
  eissn?: string;
  publisher?: string;

  // --- JCR metrics (from zsearch_impact_factors; absent on pure OpenAlex) ---
  jif?: number;
  fiveYearJif?: number;
  jci?: number;
  jifQuartile?: string;
  jifRank?: number;
  totalCites?: number;
  totalArticles?: number;

  // --- CAS quartile (from zsearch_cass_quartiles; absent on pure OpenAlex) ---
  cassQuartile?: number;
  cassCategory?: string;
  cassCategoryEn?: string;
  cassIsTop?: boolean;
  cassMinorCategories?: JournalMinorCategory[];

  // --- Risk flags (from zsearch_journal_warnings / zsearch_bealls_journals) ---
  warningLevel?: string;
  warningReason?: string;
  isPredatory?: boolean;
  predatoryCategory?: string;

  // --- OpenAlex supplementary (academic indices + publishing metadata) ---
  openalexWorksCount?: number;
  openalexH5Index?: number;
  hIndex?: number;
  i10Index?: number;
  twoYearMeanCitedness?: number;
  homepageUrl?: string;
  countryCode?: string;
  apcUsd?: number;
  isOpenAccess?: boolean;
  isInDoaj?: boolean;
  firstPublicationYear?: number;
  /** Top research topics the journal publishes — its "scope". */
  topics?: JournalTopic[];
}

/** Compact list item (modes 'discover' and 'library'). */
export interface JournalListItem {
  source: JournalDataSource;
  name: string;
  issn?: string;

  // Quality signals (from local tables when matched).
  jif?: number;
  jifQuartile?: string;
  cassQuartile?: number;
  cassIsTop?: boolean;
  warningLevel?: string;
  isPredatory?: boolean;

  // OpenAlex metrics (mode 'discover').
  worksCount?: number;
  h5Index?: number;

  // In-library paper count (mode 'library').
  libraryCount?: number;
}

export type JournalSearchMode = "metric" | "discover" | "library";

export type JournalSortBy = "relevance" | "jif" | "works" | "h5" | "library";

/** Bridge request payload (iframe → main). */
export interface JournalSearchPayload {
  mode: JournalSearchMode;
  /** Journal name or ISSN (modes 'metric' / 'discover'). Ignored in 'library'. */
  query?: string;
  limit?: number;
  sortBy?: JournalSortBy;
}

/** Bridge response (main → iframe). */
export interface JournalSearchResult {
  mode: JournalSearchMode;
  /** mode 'metric' only. */
  metric?: JournalMetric | null;
  /** modes 'discover' / 'library'. */
  list?: JournalListItem[];
  /** Total count reported by OpenAlex (mode 'discover'). */
  total?: number;
  /** 服务侧错误（如 OpenAlex 断网）——上抛供 UI 区分「失败」与「无结果」，
   *  不再吞成空列表谎报（2026-09-25 审计 P1-8）。 */
  error?: string;
}
