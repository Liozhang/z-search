/** Shared types and helpers for academic-search handlers. */

import { getPrefDynamic } from "../../../utils/prefs";

/**
 * Check whether a search source is usable in the current configuration.
 *
 * Sources that require an API key for meaningful rate limits return false
 * when the key is missing, so callers can skip them entirely instead of
 * issuing requests that are guaranteed to 429 / return empty.
 */
export function isSourceAvailable(source: string): boolean {
  switch (source) {
    case "semantic-scholar":
      return !!getPrefDynamic("apis.semanticScholar.apiKey");
    case "core":
      return !!getPrefDynamic("apis.core.apiKey");
    case "dimensions":
      return !!getPrefDynamic("apis.dimensions.apiKey");
    default:
      return true;
  }
}

/**
 * Identifier type accepted by importArticle. */
export type IdentifierType =
  "doi" | "arxiv" | "pmid" | "isbn" | "url" | "title";

/** Filters shared by per-source search handlers. */
export interface SearchFilters {
  author?: string;
  journal?: string;
  sort?: string;
  /** Restrict results to review/survey papers (sources supporting type filters only). */
  reviewOnly?: boolean;
}

/** Strip JATS XML tags from CrossRef abstracts. */
export function stripJatsXml(text: string): string {
  return text
    .replace(/<jats:[^>]+>/g, "")
    .replace(/<\/jats:[^>]+>/g, "")
    .replace(/<[^>]+>/g, "")
    .trim();
}

/** Auto-detect identifier type from string pattern. */
export function detectIdentifierType(id: string): IdentifierType {
  if (/^10\.\d{4,}\/.+/.test(id)) return "doi";
  if (/^https?:\/\/doi\.org\//i.test(id)) return "doi";
  if (/^\d{4}\.\d{4,5}(v\d+)?$/.test(id)) return "arxiv";
  if (/^https?:\/\/arxiv\.org\//i.test(id)) return "arxiv";
  if (/^\d{1,8}$/.test(id) && id.length <= 8) return "pmid";
  if (/^(?:\d{9}[\dXx]|\d{13})$/.test(id.replace(/[-\s]/g, ""))) return "isbn";
  if (/^https?:\/\//i.test(id)) return "url";
  return "title";
}

/**
 * Merge supplementary article info into target. Pure helper used by
 * deduplicateArticles — exported so the merge logic can be unit-tested.
 */
export function mergeArticleInfo(target: any, source: any): void {
  // Title: keep the longer one
  if (source.title && source.title.length > (target.title || "").length) {
    target.title = source.title;
  }
  // Abstract: keep the longer one
  if (
    source.abstract &&
    source.abstract.length > (target.abstract || "").length
  ) {
    target.abstract = source.abstract;
  }
  // Authors: union (merge unique authors)
  if (source.authors) {
    if (!target.authors) target.authors = source.authors;
    else {
      const existing = new Set(
        String(target.authors)
          .split(/[;,]/)
          .map((a: string) => a.trim().toLowerCase()),
      );
      const sourceList = String(source.authors).split(/[;,]/);
      for (const a of sourceList) {
        if (!existing.has(a.trim().toLowerCase())) {
          target.authors += "; " + a.trim();
        }
      }
    }
  }
  // Journal: prefer non-empty
  if (!target.containerTitle && source.containerTitle)
    target.containerTitle = source.containerTitle;
  // Journal name: prefer non-empty, longer name
  if (!target.journalName && source.journalName)
    target.journalName = source.journalName;
  else if (
    source.journalName &&
    source.journalName.length > (target.journalName || "").length
  ) {
    target.journalName = source.journalName;
  }
  // ISSN: prefer non-empty
  if (!target.issn && source.issn) target.issn = source.issn;
  // Volume: prefer non-empty
  if (!target.volume && source.volume) target.volume = source.volume;
  // Issue: prefer non-empty
  if (!target.issue && source.issue) target.issue = source.issue;
  // Pages: prefer non-empty, more detailed
  if (!target.pages && source.pages) target.pages = source.pages;
  else if (source.pages && source.pages.length > (target.pages || "").length) {
    target.pages = source.pages;
  }
  // Publisher: prefer non-empty
  if (!target.publisher && source.publisher)
    target.publisher = source.publisher;
  // Year: prefer earliest
  if (source.year) {
    const targetYear =
      typeof target.year === "string"
        ? parseInt(target.year) || 0
        : target.year;
    const sourceYear =
      typeof source.year === "string"
        ? parseInt(source.year) || 0
        : source.year;
    if (!targetYear || (sourceYear > 0 && sourceYear < targetYear))
      target.year = source.year;
  }
  // Citation count: prefer maximum
  const tc =
    typeof target.citationCount === "number"
      ? target.citationCount
      : parseInt(target.citationCount) || 0;
  const sc =
    typeof source.citationCount === "number"
      ? source.citationCount
      : parseInt(source.citationCount) || 0;
  if (sc > tc) target.citationCount = source.citationCount;
  // URL: prefer PubMed URL
  if (source.url && source.url.includes("pubmed.ncbi.nlm.nih.gov")) {
    target.url = source.url;
  }
  // PDF / OA URLs
  if (!target.pdfUrl && source.pdfUrl) target.pdfUrl = source.pdfUrl;
  if (!target.oaUrl && source.oaUrl) target.oaUrl = source.oaUrl;
  // DOI
  if (!target.doi && source.doi) target.doi = source.doi;
  // Publication type: prefer journal_article
  const pt = (target.publicationType || "")
    .toLowerCase()
    .replace(/[-_\s]/g, "");
  const spt = (source.publicationType || "")
    .toLowerCase()
    .replace(/[-_\s]/g, "");
  if (pt !== "journalarticle" && spt === "journalarticle")
    target.publicationType = source.publicationType;
  // Sources: merge unique
  if (!target.sources) target.sources = [target.source];
  if (!target.sources.includes(source.source))
    target.sources.push(source.source);
  // Sync source string to match sources array (first entry)
  if (target.sources.length > 0 && target.source !== target.sources[0]) {
    target.source = target.sources[0];
  }
}
