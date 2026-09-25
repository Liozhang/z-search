/**
 * JCRStore — Query API for JCR Impact Factor data.
 *
 * Provides lookup by ISSN/eISSN (exact) and journal name.
 * Default queries use the latest available year.
 *
 * @module core/data/JCRStore
 */

import { SAFE_BATCH_SIZE as BATCH_SIZE } from "../../utils/constants";
import { chunkByParams } from "../../utils/sqlBatch";

import { queryPlain } from "./queryPlain";
import {
  insertRecord,
  updateRecord,
  deleteRecord,
  dryRunImport as dryRunImportUtil,
  importRows as importRowsUtil,
  clearTable,
  type InsertResult,
  type UpdateResult,
  type DeleteResult,
  type ConflictReport,
} from "./utils/crud";
import {
  buildTableWhere,
  type StructuredFilter,
  type FilterLogic,
} from "./utils/filters";
import { normalizeISSN, normalizeJournalName } from "./utils/normalize";
import { exportTable } from "./utils/export";
import { safeDebug } from "../../utils/logger";

/** JCR record returned from database */
export interface JCRRecord {
  id: number;
  jcr_year: number;
  journal_name: string;
  abbreviated_name: string | null;
  publisher: string | null;
  issn: string | null;
  eissn: string | null;
  total_cites: number | null;
  total_articles: number | null;
  citable_items: number | null;
  cited_half_life: number | null;
  citing_half_life: number | null;
  jif: number | null;
  five_year_jif: number | null;
  jif_without_self: number | null;
  jci: number | null;
  jif_quartile: string | null;
  jif_rank: number | null;
}

class JCRStore {
  private initialized = false;
  private _latestYear: number | null = null;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    // Schema is initialized separately by JCRSchema in hooks.ts Phase 1.
    // Store is ready to use once initialize() returns.
    this.initialized = true;
  }

  /**
   * Get the latest JCR year available in the database.
   * Result is cached per-instance; invalidate via resetLatestYear().
   */
  async getLatestYear(): Promise<number | null> {
    if (this._latestYear !== null) return this._latestYear;
    try {
      const rows = await queryPlain(
        `SELECT MAX(jcr_year) AS max_year FROM zsearch_impact_factors`,
      );
      this._latestYear = rows?.[0]?.max_year ?? null;
      return this._latestYear;
    } catch (e) {
      safeDebug("[z-search] JCRStore: " + e);
      return null;
    }
  }

  /** Invalidate cached year (e.g. after data reimport). */
  resetLatestYear(): void {
    this._latestYear = null;
  }

  /**
   * Lookup a journal by normalized ISSN. Uses latest year by default.
   */
  async lookupByISSN(issn: string, year?: number): Promise<JCRRecord | null> {
    if (!issn) return null;
    const normalized = normalizeISSN(issn);
    const targetYear = year ?? (await this.getLatestYear());
    if (!targetYear) return null;

    const rows = await queryPlain(
      `SELECT * FROM zsearch_impact_factors
       WHERE jcr_year = ? AND issn = ?
       LIMIT 1`,
      [targetYear, normalized],
    );
    return rows?.[0] ?? null;
  }

  /**
   * Lookup a journal by normalized eISSN. Uses latest year by default.
   */
  async lookupByEISSN(eissn: string, year?: number): Promise<JCRRecord | null> {
    if (!eissn) return null;
    const normalized = normalizeISSN(eissn);
    const targetYear = year ?? (await this.getLatestYear());
    if (!targetYear) return null;

    const rows = await queryPlain(
      `SELECT * FROM zsearch_impact_factors
       WHERE jcr_year = ? AND eissn = ?
       LIMIT 1`,
      [targetYear, normalized],
    );
    return rows?.[0] ?? null;
  }

  /**
   * Lookup a journal by exact journal name (normalized: case-insensitive +
   * whitespace-collapsed——与 CASS/Warning 的 normalizeJournalName 同口径，
   * 审计 P2-2：双空格/前后空格输入此前只有另两家能命中).
   */
  async lookupByName(
    journalName: string,
    year?: number,
  ): Promise<JCRRecord | null> {
    if (!journalName) return null;
    const targetYear = year ?? (await this.getLatestYear());
    if (!targetYear) return null;

    const rows = await queryPlain(
      `SELECT * FROM zsearch_impact_factors
       WHERE jcr_year = ? AND journal_name = ?
       LIMIT 1`,
      [targetYear, normalizeJournalName(journalName)],
    );
    return rows?.[0] ?? null;
  }

  /**
   * Combined lookup: ISSN → eISSN → journal name. Primary entry point.
   */
  async lookup(options: {
    issn?: string;
    eissn?: string;
    journalName?: string;
    year?: number;
  }): Promise<JCRRecord | null> {
    if (options.issn) {
      const result = await this.lookupByISSN(options.issn, options.year);
      if (result) return result;
    }

    if (options.eissn) {
      const result = await this.lookupByEISSN(options.eissn, options.year);
      if (result) return result;
    }

    if (options.journalName) {
      const result = await this.lookupByName(options.journalName, options.year);
      if (result) return result;
    }

    return null;
  }

  /**
   * Batch lookup quartiles by journal names. Used for prefetching before scoring.
   * Returns Map<normalizedUppercaseName, quartile>.
   */
  async batchLookupQuartiles(
    names: string[],
    year?: number,
  ): Promise<Map<string, string>> {
    const targetYear = year ?? (await this.getLatestYear());
    if (!targetYear || names.length === 0) return new Map();

    const result = new Map<string, string>();
    const uniqueUpper = [...new Set(names.map((n) => n.toUpperCase()))];

    for (let i = 0; i < uniqueUpper.length; i += BATCH_SIZE) {
      const batch = uniqueUpper.slice(i, i + BATCH_SIZE);
      const placeholders = batch.map(() => "?").join(",");
      const rows = await queryPlain(
        `SELECT journal_name, jif_quartile FROM zsearch_impact_factors
         WHERE jcr_year = ? AND journal_name IN (${placeholders})`,
        [targetYear, ...batch],
      );
      for (const row of rows) {
        if (
          row.jif_quartile &&
          row.journal_name &&
          row.jif_quartile !== "N/A" &&
          row.jif_quartile.length <= 2
        ) {
          result.set(row.journal_name.toUpperCase(), row.jif_quartile);
        }
      }
    }

    return result;
  }

  /**
   * Batch lookup full JCR records by ISSN/eISSN. Each DB record is keyed by
   * BOTH its normalized issn and eissn so callers can look up using whichever
   * identifier an article carries. Used by literature search enrichment.
   * Returns Map<normalizedIssn, JCRRecord>.
   */
  async batchLookupByIssn(
    issns: string[],
    year?: number,
  ): Promise<Map<string, JCRRecord>> {
    const result = new Map<string, JCRRecord>();
    if (!issns || issns.length === 0) return result;

    const targetYear = year ?? (await this.getLatestYear());
    if (!targetYear) return result;

    const normalized = [
      ...new Set(issns.map((s) => normalizeISSN(s)).filter(Boolean)),
    ];
    if (normalized.length === 0) return result;

    // 每个 ISSN 在 SQL 里绑两次（issn 一个 IN、eissn 一个 IN），所以一块的
    // 参数数 = 1(year) + 2×chunk。按 SAFE_BATCH_SIZE/2 折算是硬约束：
    // 按元素数（900）切会得到 1801 个绑定参数，超 Zotero SQLite 的 999 上限。
    for (const batch of chunkByParams(normalized, 2)) {
      const placeholders = batch.map(() => "?").join(",");
      const rows = await queryPlain(
        `SELECT * FROM zsearch_impact_factors
         WHERE jcr_year = ? AND (issn IN (${placeholders}) OR eissn IN (${placeholders}))`,
        [targetYear, ...batch, ...batch],
      );
      for (const row of rows) {
        const rec = row as JCRRecord;
        if (rec.issn) result.set(normalizeISSN(rec.issn), rec);
        if (rec.eissn) result.set(normalizeISSN(rec.eissn), rec);
      }
    }
    return result;
  }

  /**
   * Get the total number of JCR records for a given year.
   */
  async getCount(year?: number): Promise<number> {
    try {
      const targetYear = year ?? (await this.getLatestYear());
      if (!targetYear) return 0;
      const rows = await queryPlain(
        `SELECT COUNT(*) AS cnt FROM zsearch_impact_factors WHERE jcr_year = ?`,
        [targetYear],
      );
      return rows?.[0]?.cnt ?? 0;
    } catch (e) {
      safeDebug("[z-search] JCRStore: " + e);
      return 0;
    }
  }

  /**
   * Check if JCR data exists for a given year.
   */
  async hasData(year?: number): Promise<boolean> {
    return (await this.getCount(year)) > 0;
  }

  /** Insert a single record. Returns inserted or already-exists. */
  async insert(
    record: Partial<JCRRecord> & Pick<JCRRecord, "jcr_year" | "journal_name">,
  ): Promise<InsertResult> {
    const result = await insertRecord({
      tableName: "zsearch_impact_factors",
      columns: [
        "jcr_year",
        "journal_name",
        "abbreviated_name",
        "publisher",
        "issn",
        "eissn",
        "total_cites",
        "total_articles",
        "citable_items",
        "cited_half_life",
        "citing_half_life",
        "jif",
        "five_year_jif",
        "jif_without_self",
        "jci",
        "jif_quartile",
        "jif_rank",
      ],
      record,
      keyColumns: ["jcr_year", "journal_name"],
      yearColumn: "jcr_year",
    });
    this.resetLatestYear();
    return result;
  }

  /** Update by composite key. */
  async updateByKey(
    key: { jcr_year: number; journal_name: string },
    changes: Partial<JCRRecord>,
  ): Promise<UpdateResult> {
    const result = await updateRecord({
      tableName: "zsearch_impact_factors",
      keyColumns: ["jcr_year", "journal_name"],
      keyValues: [key.jcr_year, key.journal_name],
      changes,
      yearColumn: "jcr_year",
    });
    this.resetLatestYear();
    return result;
  }

  /** Delete by composite key. */
  async deleteByKey(key: {
    jcr_year: number;
    journal_name: string;
  }): Promise<DeleteResult> {
    const result = await deleteRecord({
      tableName: "zsearch_impact_factors",
      keyColumns: ["jcr_year", "journal_name"],
      keyValues: [key.jcr_year, key.journal_name],
    });
    this.resetLatestYear();
    return result;
  }

  /**
   * Clear rows. C-1: scoping is via structured filters (validated against
   * real columns, bound parameters) — raw SQL strings are no longer accepted.
   */
  async clear(
    filters?: StructuredFilter[],
    filterLogic?: FilterLogic,
  ): Promise<{ deleted: number }> {
    const where = await buildTableWhere(
      "zsearch_impact_factors",
      filters,
      filterLogic,
    );
    const result = await clearTable("zsearch_impact_factors", where);
    this.resetLatestYear();
    return result;
  }

  /** Export current data. Returns JSON or CSV string. */
  async exportData(opts?: {
    year?: number;
    format?: "json" | "csv";
    filters?: StructuredFilter[];
    filterLogic?: FilterLogic;
  }): Promise<{
    format: "json" | "csv";
    year?: number;
    count: number;
    content: string;
    columns: string[];
  }> {
    // C-1: filters compiled to bound parameters; year is bound inside exportTable.
    const where = await buildTableWhere(
      "zsearch_impact_factors",
      opts?.filters,
      opts?.filterLogic,
    );
    return exportTable({
      tableName: "zsearch_impact_factors",
      yearColumn: "jcr_year",
      year: opts?.year,
      format: opts?.format,
      where,
    });
  }

  /** Dry-run import: classify rows into insert/update/noop/older-overwrite. */
  async dryRunImport(rows: Array<Partial<JCRRecord>>): Promise<ConflictReport> {
    return dryRunImportUtil({
      tableName: "zsearch_impact_factors",
      keyColumns: ["jcr_year", "journal_name"],
      yearColumn: "jcr_year",
      rows: rows as Array<Record<string, unknown>>,
    });
  }

  /** Bulk import rows. Replaces the old importData signature. */
  async importRows(
    rows: Array<Partial<JCRRecord>>,
  ): Promise<{ inserted: number; updated: number; skipped: number }> {
    const result = await importRowsUtil({
      tableName: "zsearch_impact_factors",
      columns: [
        "jcr_year",
        "journal_name",
        "abbreviated_name",
        "publisher",
        "issn",
        "eissn",
        "total_cites",
        "total_articles",
        "citable_items",
        "cited_half_life",
        "citing_half_life",
        "jif",
        "five_year_jif",
        "jif_without_self",
        "jci",
        "jif_quartile",
        "jif_rank",
      ],
      rows: rows as Array<Record<string, unknown>>,
      mode: "insert-or-ignore",
      // 表上两条 UNIQUE（见 JCRSchema）：行被任一违反都会被 INSERT OR IGNORE
      // 跳过，预检必须把两个键集合都查一遍，inserted/skipped 才对得上。
      conflictKeys: [
        ["jcr_year", "journal_name"],
        ["jcr_year", "issn"],
      ],
    });
    this.resetLatestYear();
    return result;
  }
}
export default new JCRStore();
