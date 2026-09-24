/**
 * Shared types for Literature Search Dashboard.
 *
 * Re-exports ArticleResult / ImportResult from src/types/literatureSearch
 * (shared between React iframe and Zotero main-script bridge).
 *
 * @module react/components/Hub/search/LiteratureSearch/types
 */

export type {
  ArticleResult,
  ImportResult,
  FulltextResult,
} from "../../../../../types/literatureSearch";

export const AVAILABLE_SOURCES: { value: string; labelKey: string }[] = [
  { value: "openalex", labelKey: "lit-source-openalex" },
  { value: "semantic-scholar", labelKey: "lit-source-semantic-scholar" },
  { value: "crossref", labelKey: "lit-source-crossref" },
  { value: "arxiv", labelKey: "lit-source-arxiv" },
  { value: "biorxiv", labelKey: "lit-source-biorxiv" },
  { value: "medrxiv", labelKey: "lit-source-medrxiv" },
  { value: "doaj", labelKey: "lit-source-doaj" },
  { value: "zenodo", labelKey: "lit-source-zenodo" },
  { value: "hal", labelKey: "lit-source-hal" },
  { value: "core", labelKey: "lit-source-core" },
  { value: "europe-pmc", labelKey: "lit-source-europe-pmc" },
  { value: "pubmed", labelKey: "lit-source-pubmed" },
  { value: "github", labelKey: "lit-source-github" },
];

export const SORT_OPTIONS: { value: string; labelKey: string }[] = [
  { value: "relevance", labelKey: "lit-sort-relevance" },
  { value: "published", labelKey: "lit-sort-published" },
  { value: "cited", labelKey: "lit-sort-cited" },
];
