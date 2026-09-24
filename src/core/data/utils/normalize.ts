/**
 * Shared normalization helpers for datasource stores (JCR/CASS/Warning/Bealls).
 *
 * Extracted from per-module duplicates to ensure consistent formatting across
 * all journal/publisher data sources.
 */

/** Normalize ISSN: strip hyphens and whitespace, uppercase. */
export function normalizeISSN(issn: string): string {
  return issn.replace(/[-\s]/g, "").toUpperCase();
}

/** Normalize journal name: trim, collapse whitespace, uppercase. */
export function normalizeJournalName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toUpperCase();
}

/** CSV escape helper: quote/escape per RFC 4180 when value contains comma, quote, or newline. */
export function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
