/**
 * BeallsListStore — Layered query API for Beall's List predatory journal data.
 *
 * Match layers (executed in order, first hit wins):
 *   L1: URL domain match   — Beall's URL domain vs item URL domain (confidence: 1.0)
 *   L2: Exact name match  — normalized uppercase exact compare (confidence: 1.0)
 *   L3: Abbreviation match — Beall's abbr vs item name stripped of stop words (confidence: 0.9)
 *   L4: Keyword overlap   — significant words overlap ratio (confidence: 0.7)
 *
 * @module core/data/BeallsListStore
 */

import { queryPlain } from "./queryPlain";
import {
  insertRecord,
  updateRecord,
  deleteRecord,
  dryRunImport as dryRunImportUtil,
  importRows as importRowsUtil,
  clearTable,
  type ConflictReport,
} from "./utils/crud";
import {
  buildTableWhere,
  type StructuredFilter,
  type FilterLogic,
} from "./utils/filters";
import { normalizeJournalName, csvEscape } from "./utils/normalize";
import { safeDebug } from "../../utils/logger";

// --- Three-table config ---

const TABLE_CONFIG = {
  journals: {
    name: "zsearch_bealls_journals",
    columns: ["journal_name", "journal_url", "category", "extra"],
    keyColumns: ["journal_name", "category"],
  },
  publishers: {
    name: "zsearch_bealls_publishers",
    columns: ["publisher_name", "publisher_url"],
    keyColumns: ["publisher_name"],
  },
  metrics: {
    name: "zsearch_bealls_metrics",
    columns: ["metric_name", "metric_url"],
    keyColumns: ["metric_name"],
  },
} as const;

type BeallsTable = keyof typeof TABLE_CONFIG;

// --- Types ---

export type MatchLayer = "url" | "exact" | "abbr" | "keyword";

export interface BeallsJournalRecord {
  id: number;
  journal_name: string | null;
  journal_url: string | null;
  category: "standalone" | "hijacked";
  extra: string | null;
}

export interface BeallsPublisherRecord {
  id: number;
  publisher_name: string | null;
  publisher_url: string | null;
}

export interface BeallsMetricRecord {
  id: number;
  metric_name: string | null;
  metric_url: string | null;
}

export interface BeallsCheckResult {
  isPredatory: boolean;
  /** Best match layer found */
  bestLayer: MatchLayer | null;
  /** Best confidence score (0-1) */
  confidence: number;
  /** Journal-level matches across all layers */
  journals: Array<BeallsJournalRecord & { layer: MatchLayer }>;
  /** Publisher-level matches */
  publishers: Array<BeallsPublisherRecord & { layer: MatchLayer }>;
  /** Misleading metrics organization matches */
  metrics: Array<BeallsMetricRecord & { layer: MatchLayer }>;
}

// --- Normalization helpers ---

const STOP_WORDS = new Set([
  "THE",
  "OF",
  "AND",
  "FOR",
  "IN",
  "ON",
  "A",
  "AN",
  "TO",
  "DE",
  "LA",
  "LE",
  "LES",
  "DES",
  "DU",
  "ET",
  "EN",
  "UN",
  "UNE",
  "JOURNAL",
  "INTERNATIONAL",
  "ADVANCES",
  "RESEARCH",
  "SCIENCE",
  "STUDIES",
  "REVIEW",
  "REVIEWS",
  "ANNALS",
]);

function extractDomain(url: string): string | null {
  if (!url) return null;
  const u = url.trim().toLowerCase();
  if (!u.startsWith("http")) return null;
  const host = u.replace(/^https?:\/\//, "").split("/")[0];
  // Remove www. prefix
  return host.replace(/^www\./, "");
}

function extractKeywords(name: string): Set<string> {
  const upper = normalizeJournalName(name);
  const words = upper.replace(/[^A-Z0-9\s]/g, " ").split(/\s+/);
  return new Set(words.filter((w) => w.length > 1 && !STOP_WORDS.has(w)));
}

function keywordOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const w of a) {
    if (b.has(w)) overlap++;
  }
  return overlap / Math.min(a.size, b.size);
}

// --- In-memory index (loaded from SQLite on first use) ---

interface JournalEntry {
  id: number;
  name: string | null;
  url: string | null;
  domain: string | null;
  abbr: string | null;
  abbrUpper: string | null;
  keywords: Set<string>;
  category: "standalone" | "hijacked";
  extra: string | null;
}

interface PublisherEntry {
  id: number;
  name: string | null;
  url: string | null;
  domain: string | null;
}

interface MetricEntry {
  id: number;
  name: string | null;
  url: string | null;
  domain: string | null;
}

class BeallsListStore {
  // In-memory indexes
  private journalByDomain = new Map<string, JournalEntry>();
  private journalByName = new Map<string, JournalEntry>();
  private journalByAbbr = new Map<string, JournalEntry>();
  private allJournals: JournalEntry[] = [];

  private publisherByDomain = new Map<string, PublisherEntry>();
  private publisherByName = new Map<string, PublisherEntry>();

  private metricByDomain = new Map<string, MetricEntry>();
  private metricByName = new Map<string, MetricEntry>();

  private indexLoaded = false;

  /**
   * Load all entries from SQLite into memory indexes.
   * Called lazily on first query.
   */
  private async ensureIndex(): Promise<void> {
    if (this.indexLoaded) return;
    this.indexLoaded = true;

    // Clear existing in-memory indexes before rebuilding to prevent
    // duplicate entries when this method is retried after a partial failure,
    // or after any write operation (insert/update/delete) that sets
    // `indexLoaded = false` to invalidate the cache.
    this.journalByDomain.clear();
    this.journalByName.clear();
    this.journalByAbbr.clear();
    this.publisherByName.clear();
    this.publisherByDomain.clear();
    this.metricByName.clear();
    this.metricByDomain.clear();
    this.allJournals = [];

    try {
      // Load journals
      const jRows = await queryPlain(
        `SELECT id, journal_name, journal_url, category, extra FROM zsearch_bealls_journals`,
      );
      for (const row of jRows || []) {
        const entry: JournalEntry = {
          id: row.id,
          name: (row.journal_name as string) || null,
          url: (row.journal_url as string) || null,
          domain: extractDomain(row.journal_url),
          abbr: null,
          abbrUpper: null,
          keywords: extractKeywords(row.journal_name || ""),
          category: (row.category || "standalone") as "standalone" | "hijacked",
          extra: (row.extra as string) || null,
        };

        // Parse abbr from extra field (standalone journals store abbr in extra)
        if (entry.category === "standalone" && entry.extra) {
          entry.abbr = entry.extra;
          entry.abbrUpper = normalizeJournalName(entry.extra);
        }

        if (entry.name) this.journalByName.set(entry.name, entry);
        if (entry.domain) this.journalByDomain.set(entry.domain, entry);
        if (entry.abbrUpper) this.journalByAbbr.set(entry.abbrUpper, entry);
        this.allJournals.push(entry);
      }

      // Load publishers
      const pRows = await queryPlain(
        `SELECT id, publisher_name, publisher_url FROM zsearch_bealls_publishers`,
      );
      for (const row of pRows || []) {
        const entry: PublisherEntry = {
          id: row.id,
          name: (row.publisher_name as string) || null,
          url: (row.publisher_url as string) || null,
          domain: extractDomain(row.publisher_url),
        };
        if (entry.name) this.publisherByName.set(entry.name, entry);
        if (entry.domain) this.publisherByDomain.set(entry.domain, entry);
      }

      // Load misleading metrics organizations
      const mRows = await queryPlain(
        `SELECT id, metric_name, metric_url FROM zsearch_bealls_metrics`,
      );
      for (const row of mRows || []) {
        const entry: MetricEntry = {
          id: row.id,
          name: (row.metric_name as string) || null,
          url: (row.metric_url as string) || null,
          domain: extractDomain(row.metric_url),
        };
        if (entry.name) this.metricByName.set(entry.name, entry);
        if (entry.domain) this.metricByDomain.set(entry.domain, entry);
      }
    } catch (e) {
      safeDebug("[z-search] BeallsListStore: " + e);
      this.indexLoaded = false;
    }
  }

  private toJournalRecord(
    entry: JournalEntry,
    layer: MatchLayer,
  ): BeallsJournalRecord & { layer: MatchLayer } {
    return {
      id: entry.id,
      journal_name: entry.name,
      journal_url: entry.url,
      category: entry.category,
      extra: entry.extra,
      layer,
    };
  }

  private toPublisherRecord(
    entry: PublisherEntry,
    layer: MatchLayer,
  ): BeallsPublisherRecord & { layer: MatchLayer } {
    return {
      id: entry.id,
      publisher_name: entry.name,
      publisher_url: entry.url,
      layer,
    };
  }

  private toMetricRecord(
    entry: MetricEntry,
    layer: MatchLayer,
  ): BeallsMetricRecord & { layer: MatchLayer } {
    return {
      id: entry.id,
      metric_name: entry.name,
      metric_url: entry.url,
      layer,
    };
  }

  // --- L1: URL domain match ---

  private matchByDomain(itemDomain: string): {
    entry: JournalEntry | PublisherEntry | MetricEntry;
    type: "journal" | "publisher" | "metric";
  } | null {
    const journal = this.journalByDomain.get(itemDomain);
    if (journal) return { entry: journal, type: "journal" };
    const publisher = this.publisherByDomain.get(itemDomain);
    if (publisher) return { entry: publisher, type: "publisher" };
    const metric = this.metricByDomain.get(itemDomain);
    if (metric) return { entry: metric, type: "metric" };
    return null;
  }

  // --- L2: Exact name match ---

  private matchByNameExact(name: string): JournalEntry | null {
    return this.journalByName.get(normalizeJournalName(name)) ?? null;
  }

  // --- L3: Abbreviation match ---
  // Beall's abbr (e.g. "AJRJETS") vs item name's stop-word-stripped acronym

  private matchByAbbr(itemName: string): JournalEntry | null {
    const itemKeywords = extractKeywords(itemName);
    if (itemKeywords.size === 0) return null;

    // Build acronym from item keywords
    const acronym = Array.from(itemKeywords)
      .map((w) => w[0])
      .join("");
    const match = this.journalByAbbr.get(acronym);
    if (match) return match;

    // Also try full keyword set comparison
    for (const entry of this.allJournals) {
      if (!entry.abbrUpper) continue;
      const overlap = keywordOverlap(
        itemKeywords,
        extractKeywords(entry.abbrUpper),
      );
      if (overlap >= 1.0) return entry;
    }

    return null;
  }

  // --- L4: Keyword overlap ---

  private matchByKeywords(
    itemName: string,
    threshold: number = 0.6,
  ): JournalEntry | null {
    const itemKw = extractKeywords(itemName);
    if (itemKw.size < 2) return null;

    let bestEntry: JournalEntry | null = null;
    let bestScore = 0;

    for (const entry of this.allJournals) {
      if (!entry.name) continue;
      const score = keywordOverlap(itemKw, entry.keywords);
      if (score > bestScore && score >= threshold) {
        bestScore = score;
        bestEntry = entry;
      }
    }

    return bestEntry;
  }

  // --- Public API ---

  /**
   * Check a Zotero item against Beall's List using layered matching.
   *
   * @param publicationTitle - Zotero item's publicationTitle (journal name)
   * @param publisherName - Zotero item's publisher field
   * @param itemUrl - Zotero item's URL field
   * @returns Check result with best match layer and confidence
   */
  async checkItem(
    publicationTitle: string | null,
    publisherName?: string | null,
    itemUrl?: string | null,
  ): Promise<BeallsCheckResult> {
    const result: BeallsCheckResult = {
      isPredatory: false,
      bestLayer: null,
      confidence: 0,
      journals: [],
      publishers: [],
      metrics: [],
    };

    await this.ensureIndex();

    // L1: URL domain match
    if (itemUrl) {
      const domain = extractDomain(itemUrl);
      if (domain) {
        const hit = this.matchByDomain(domain);
        if (hit) {
          result.isPredatory = true;
          result.bestLayer = "url";
          result.confidence = 1.0;
          if (hit.type === "journal") {
            result.journals.push(
              this.toJournalRecord(hit.entry as JournalEntry, "url"),
            );
          } else if (hit.type === "publisher") {
            result.publishers.push(
              this.toPublisherRecord(hit.entry as PublisherEntry, "url"),
            );
          } else {
            result.metrics.push(
              this.toMetricRecord(hit.entry as MetricEntry, "url"),
            );
          }
          return result;
        }
      }
    }

    // L2: Exact name match
    if (publicationTitle) {
      const jMatch = this.matchByNameExact(publicationTitle);
      if (jMatch) {
        result.isPredatory = true;
        result.bestLayer = "exact";
        result.confidence = 1.0;
        result.journals.push(this.toJournalRecord(jMatch, "exact"));
      }
    }

    // Also check publisher exact match
    if (publisherName && !result.isPredatory) {
      const pMatch = this.publisherByName.get(
        normalizeJournalName(publisherName),
      );
      if (pMatch) {
        result.isPredatory = true;
        result.bestLayer = "exact";
        result.confidence = 1.0;
        result.publishers.push(this.toPublisherRecord(pMatch, "exact"));
      }
    }

    // Also check misleading metrics organization exact match
    // (publicationTitle or publisherName may itself be a misleading metrics provider)
    if (!result.isPredatory) {
      const candidates = [publicationTitle, publisherName].filter(
        Boolean,
      ) as string[];
      for (const candidate of candidates) {
        const mMatch = this.metricByName.get(normalizeJournalName(candidate));
        if (mMatch) {
          result.isPredatory = true;
          result.bestLayer = "exact";
          result.confidence = 1.0;
          result.metrics.push(this.toMetricRecord(mMatch, "exact"));
          break;
        }
      }
    }

    if (result.isPredatory) return result;

    // L3: Abbreviation match (journal names only)
    if (publicationTitle) {
      const abbrMatch = this.matchByAbbr(publicationTitle);
      if (abbrMatch) {
        result.isPredatory = true;
        result.bestLayer = "abbr";
        result.confidence = 0.9;
        result.journals.push(this.toJournalRecord(abbrMatch, "abbr"));
        return result;
      }
    }

    // L4: Keyword overlap (journal names only)
    if (publicationTitle) {
      const kwMatch = this.matchByKeywords(publicationTitle);
      if (kwMatch) {
        result.isPredatory = true;
        result.bestLayer = "keyword";
        result.confidence = 0.7;
        result.journals.push(this.toJournalRecord(kwMatch, "keyword"));
        return result;
      }
    }

    return result;
  }

  /** Insert a single record into one of the three Beall's tables. */
  async insert(table: BeallsTable, record: Record<string, unknown>) {
    const cfg = TABLE_CONFIG[table];
    const result = await insertRecord({
      tableName: cfg.name,
      columns: cfg.columns as unknown as string[],
      record,
      keyColumns: cfg.keyColumns as unknown as string[],
    });
    this.indexLoaded = false;
    return result;
  }

  /** Update by composite key. */
  async updateByKey(
    table: BeallsTable,
    key: Record<string, unknown>,
    changes: Record<string, unknown>,
  ) {
    const cfg = TABLE_CONFIG[table];
    const result = await updateRecord({
      tableName: cfg.name,
      keyColumns: cfg.keyColumns as unknown as string[],
      keyValues: Object.values(key),
      changes,
    });
    this.indexLoaded = false;
    return result;
  }

  /** Delete by composite key. */
  async deleteByKey(table: BeallsTable, key: Record<string, unknown>) {
    const cfg = TABLE_CONFIG[table];
    const result = await deleteRecord({
      tableName: cfg.name,
      keyColumns: cfg.keyColumns as unknown as string[],
      keyValues: Object.values(key),
    });
    this.indexLoaded = false;
    return result;
  }

  /**
   * Clear rows from a single table. C-1: scoping is via structured filters
   * (validated, bound parameters); omit to clear the entire table.
   * (For "clear all three tables" use clearAll.)
   */
  async clear(
    table: BeallsTable,
    filters?: StructuredFilter[],
    filterLogic?: FilterLogic,
  ) {
    const cfg = TABLE_CONFIG[table];
    const where = await buildTableWhere(cfg.name, filters, filterLogic);
    const result = await clearTable(cfg.name, where);
    this.indexLoaded = false;
    return result;
  }

  /**
   * Clear all three Beall's tables. Each table can be scoped independently via
   * its own structured filters; omit all opts to fully clear every table.
   */
  async clearAll(opts?: {
    journalsFilters?: StructuredFilter[];
    publishersFilters?: StructuredFilter[];
    metricsFilters?: StructuredFilter[];
    filterLogic?: FilterLogic;
  }): Promise<{ journals: number; publishers: number; metrics: number }> {
    const [jw, pw, mw] = await Promise.all([
      buildTableWhere(
        "zsearch_bealls_journals",
        opts?.journalsFilters,
        opts?.filterLogic,
      ),
      buildTableWhere(
        "zsearch_bealls_publishers",
        opts?.publishersFilters,
        opts?.filterLogic,
      ),
      buildTableWhere(
        "zsearch_bealls_metrics",
        opts?.metricsFilters,
        opts?.filterLogic,
      ),
    ]);
    const [j, p, m] = await Promise.all([
      clearTable("zsearch_bealls_journals", jw),
      clearTable("zsearch_bealls_publishers", pw),
      clearTable("zsearch_bealls_metrics", mw),
    ]);
    this.indexLoaded = false;
    return { journals: j.deleted, publishers: p.deleted, metrics: m.deleted };
  }

  /** Export current data from a single table. Returns JSON or CSV string. */
  async exportData(
    table: BeallsTable,
    opts?: {
      format?: "json" | "csv";
      filters?: StructuredFilter[];
      filterLogic?: FilterLogic;
    },
  ): Promise<{
    format: "json" | "csv";
    table: BeallsTable;
    count: number;
    content: string;
    columns: string[];
  }> {
    const cfg = TABLE_CONFIG[table];
    const format = opts?.format ?? "json";
    // C-1: bound parameters via structured filters; row cap matches the
    // shared exportTable helper (this path previously had NO cap at all).
    const where = await buildTableWhere(
      cfg.name,
      opts?.filters,
      opts?.filterLogic,
    );
    const EXPORT_ROW_CAP = 100000;
    const sql = where
      ? `SELECT * FROM ${cfg.name} WHERE ${where.sql} LIMIT ${EXPORT_ROW_CAP}`
      : `SELECT * FROM ${cfg.name} LIMIT ${EXPORT_ROW_CAP}`;
    const rows = await queryPlain(sql, where?.params ?? []);

    if (format === "json") {
      return {
        format: "json",
        table,
        count: rows.length,
        content: JSON.stringify(rows),
        columns: Object.keys(rows[0] ?? {}),
      };
    }
    // CSV
    const columns = Object.keys(rows[0] ?? {});
    const header = columns.join(",");
    const lines = rows.map((r) =>
      columns.map((c) => csvEscape(r[c])).join(","),
    );
    return {
      format: "csv",
      table,
      count: rows.length,
      content: [header, ...lines].join("\n"),
      columns,
    };
  }

  /** Dry-run import against a single table: classify rows into insert/update/noop. */
  async dryRunImport(
    table: BeallsTable,
    rows: Array<Record<string, unknown>>,
  ): Promise<ConflictReport> {
    const cfg = TABLE_CONFIG[table];
    return dryRunImportUtil({
      tableName: cfg.name,
      keyColumns: cfg.keyColumns as unknown as string[],
      rows,
    });
  }

  /**
   * Bulk import rows across the three Beall's tables. The `standalone` and
   * `hijacked` segments are merged into the journals table (with category
   * distinguishing them); `publishers` and `misleading` map to their own tables.
   * Uses insert-or-ignore so existing rows are skipped.
   */
  async importRows(rows: {
    standalone?: Array<Record<string, unknown>>;
    publishers?: Array<Record<string, unknown>>;
    hijacked?: Array<Record<string, unknown>>;
    misleading?: Array<Record<string, unknown>>;
  }): Promise<{ journals: number; publishers: number; metrics: number }> {
    // standalone + hijacked → journals table (with category)
    const journals: Array<Record<string, unknown>> = [];
    for (const r of rows.standalone ?? []) {
      journals.push({ ...r, category: "standalone" });
    }
    for (const r of rows.hijacked ?? []) {
      journals.push({ ...r, category: "hijacked" });
    }

    const tasks: Array<Promise<{ inserted: number }>> = [];
    if (journals.length > 0) {
      tasks.push(
        importRowsUtil({
          tableName: "zsearch_bealls_journals",
          columns: ["journal_name", "journal_url", "category", "extra"],
          rows: journals,
          mode: "insert-or-ignore",
          // UNIQUE(journal_name, category)（见 BeallsListSchema）
          conflictKeys: [["journal_name", "category"]],
        }).then((r) => ({ inserted: r.inserted })),
      );
    }
    if ((rows.publishers ?? []).length > 0) {
      tasks.push(
        importRowsUtil({
          tableName: "zsearch_bealls_publishers",
          columns: ["publisher_name", "publisher_url"],
          rows: rows.publishers!,
          mode: "insert-or-ignore",
          // UNIQUE(publisher_name)（见 BeallsListSchema）
          conflictKeys: [["publisher_name"]],
        }).then((r) => ({ inserted: r.inserted })),
      );
    }
    if ((rows.misleading ?? []).length > 0) {
      tasks.push(
        importRowsUtil({
          tableName: "zsearch_bealls_metrics",
          columns: ["metric_name", "metric_url"],
          rows: rows.misleading!,
          mode: "insert-or-ignore",
          // UNIQUE(metric_name)（见 BeallsListSchema）
          conflictKeys: [["metric_name"]],
        }).then((r) => ({ inserted: r.inserted })),
      );
    }
    const results = await Promise.all(tasks);
    this.indexLoaded = false;
    return {
      journals: results[0]?.inserted ?? 0,
      publishers: results[1]?.inserted ?? 0,
      metrics: results[2]?.inserted ?? 0,
    };
  }

  /**
   * Get DB row counts.
   */
  async getCounts(): Promise<{
    journals: number;
    publishers: number;
    metrics: number;
  }> {
    try {
      const [jRows, pRows, mRows] = await Promise.all([
        queryPlain(`SELECT COUNT(*) AS cnt FROM zsearch_bealls_journals`),
        queryPlain(`SELECT COUNT(*) AS cnt FROM zsearch_bealls_publishers`),
        queryPlain(`SELECT COUNT(*) AS cnt FROM zsearch_bealls_metrics`),
      ]);
      return {
        journals: jRows?.[0]?.cnt ?? 0,
        publishers: pRows?.[0]?.cnt ?? 0,
        metrics: mRows?.[0]?.cnt ?? 0,
      };
    } catch (e) {
      safeDebug("[z-search] BeallsListStore: " + e);
      return { journals: 0, publishers: 0, metrics: 0 };
    }
  }
}

export default new BeallsListStore();
