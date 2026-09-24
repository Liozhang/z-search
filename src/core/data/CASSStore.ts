/**
 * CASSStore — Query API for CAS (Chinese Academy of Sciences) journal quartile data.
 *
 * Provides lookup by ISSN/eISSN (exact) and journal name.
 * Default queries use the latest available year.
 *
 * @module core/data/CASSStore
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

/** Minor category entry parsed from JSON */
export interface CASSMinorCategory {
  /** English subject name */
  n: string;
  /** Chinese subject name */
  nc: string;
  /** Quartile 1-4 */
  q: number;
  /** Rank within subject */
  r: number | null;
  /** Total journals in subject */
  t: number | null;
}

/** CASS record returned from database */
export interface CASSRecord {
  id: number;
  cass_year: number;
  journal_name: string;
  issn: string | null;
  eissn: string | null;
  is_review: boolean;
  is_oa: boolean;
  wos_category: string | null;
  major_category: string;
  major_category_en: string | null;
  major_quartile: number;
  major_rank: number | null;
  major_total: number | null;
  is_top: boolean;
  minor_categories: CASSMinorCategory[];
}

/** Compact data for batch prefetch (avoids parsing JSON for every item) */
export interface CASSQuartileInfo {
  quartile: number;
  category: string;
  categoryEn: string | null;
  isTop: boolean;
}
/**
 * Parse minor categories JSON string into typed array.
 */
function parseMinorCategories(json: string | null): CASSMinorCategory[] {
  if (!json) return [];
  try {
    const raw: Array<{
      n?: string;
      nc?: string;
      q?: number;
      r?: number;
      t?: number;
    }> = JSON.parse(json);
    return raw.map((entry) => ({
      n: entry.n ?? "",
      nc: entry.nc ?? "",
      q: entry.q ?? 0,
      r: entry.r ?? null,
      t: entry.t ?? null,
    }));
  } catch (e) {
    safeDebug("[z-search] CASSStore: " + e);
    return [];
  }
}

class CASSStore {
  private initialized = false;
  private _latestYear: number | null = null;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
  }

  /**
   * Get the latest CASS year available in the database.
   * Result is cached per-instance; invalidate via resetLatestYear().
   */
  async getLatestYear(): Promise<number | null> {
    if (this._latestYear !== null) return this._latestYear;
    try {
      const rows = await queryPlain(
        `SELECT MAX(cass_year) AS max_year FROM zsearch_cass_quartiles`,
      );
      this._latestYear = rows?.[0]?.max_year ?? null;
      return this._latestYear;
    } catch (e) {
      safeDebug("[z-search] CASSStore: " + e);
      return null;
    }
  }

  /** Invalidate cached year (e.g. after data reimport). */
  resetLatestYear(): void {
    this._latestYear = null;
  }

  /**
   * Combined lookup: ISSN → eISSN → journal name. Primary entry point.
   */
  async lookup(options: {
    issn?: string;
    eissn?: string;
    journalName?: string;
    year?: number;
  }): Promise<CASSRecord | null> {
    const targetYear = options.year ?? (await this.getLatestYear());
    if (!targetYear) return null;

    if (options.issn) {
      const normalized = normalizeISSN(options.issn);
      const rows = await queryPlain(
        `SELECT * FROM zsearch_cass_quartiles
         WHERE cass_year = ? AND issn = ?
         LIMIT 1`,
        [targetYear, normalized],
      );
      if (rows?.[0]) return this.toRecord(rows[0]);
    }

    if (options.eissn) {
      const normalized = normalizeISSN(options.eissn);
      const rows = await queryPlain(
        `SELECT * FROM zsearch_cass_quartiles
         WHERE cass_year = ? AND eissn = ?
         LIMIT 1`,
        [targetYear, normalized],
      );
      if (rows?.[0]) return this.toRecord(rows[0]);
    }

    if (options.journalName) {
      const normalized = normalizeJournalName(options.journalName);
      const rows = await queryPlain(
        `SELECT * FROM zsearch_cass_quartiles
         WHERE cass_year = ? AND journal_name = ?
         LIMIT 1`,
        [targetYear, normalized],
      );
      if (rows?.[0]) return this.toRecord(rows[0]);
    }

    return null;
  }

  /**
   * Batch lookup quartiles by journal names. Used for prefetching before scoring.
   * Returns Map<normalizedUppercaseName, CASSQuartileInfo>.
   */
  async batchLookupQuartiles(
    names: string[],
    year?: number,
  ): Promise<Map<string, CASSQuartileInfo>> {
    const targetYear = year ?? (await this.getLatestYear());
    if (!targetYear || names.length === 0) return new Map();

    const result = new Map<string, CASSQuartileInfo>();
    const uniqueUpper = [...new Set(names.map((n) => normalizeJournalName(n)))];

    for (let i = 0; i < uniqueUpper.length; i += BATCH_SIZE) {
      const batch = uniqueUpper.slice(i, i + BATCH_SIZE);
      const placeholders = batch.map(() => "?").join(",");
      const rows = await queryPlain(
        `SELECT journal_name, major_quartile, major_category, major_category_en, is_top
         FROM zsearch_cass_quartiles
         WHERE cass_year = ? AND journal_name IN (${placeholders})`,
        [targetYear, ...batch],
      );
      for (const row of rows) {
        if (row.journal_name && row.major_quartile) {
          result.set(row.journal_name.toUpperCase(), {
            quartile: row.major_quartile as number,
            category: row.major_category ?? "",
            categoryEn: row.major_category_en ?? null,
            isTop: row.is_top === 1,
          });
        }
      }
    }

    return result;
  }

  /**
   * Batch lookup full CASS records by ISSN/eISSN. Each DB record is keyed by
   * BOTH its normalized issn and eissn. Returns Map<normalizedIssn, CASSRecord>.
   * Used by literature search enrichment.
   */
  async batchLookupByIssn(
    issns: string[],
    year?: number,
  ): Promise<Map<string, CASSRecord>> {
    const result = new Map<string, CASSRecord>();
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
        `SELECT * FROM zsearch_cass_quartiles
         WHERE cass_year = ? AND (issn IN (${placeholders}) OR eissn IN (${placeholders}))`,
        [targetYear, ...batch, ...batch],
      );
      for (const row of rows) {
        const rec = this.toRecord(row);
        if (rec.issn) result.set(normalizeISSN(rec.issn), rec);
        if (rec.eissn) result.set(normalizeISSN(rec.eissn), rec);
      }
    }
    return result;
  }

  /**
   * Get the total number of CASS records for a given year.
   */
  async getCount(year?: number): Promise<number> {
    try {
      const targetYear = year ?? (await this.getLatestYear());
      if (!targetYear) return 0;
      const rows = await queryPlain(
        `SELECT COUNT(*) AS cnt FROM zsearch_cass_quartiles WHERE cass_year = ?`,
        [targetYear],
      );
      return rows?.[0]?.cnt ?? 0;
    } catch (e) {
      safeDebug("[z-search] CASSStore: " + e);
      return 0;
    }
  }

  /**
   * Check if CASS data exists for a given year.
   */
  async hasData(year?: number): Promise<boolean> {
    return (await this.getCount(year)) > 0;
  }

  /** Insert a single record. Returns inserted or already-exists. */
  async insert(
    record: Partial<CASSRecord> &
      Pick<
        CASSRecord,
        "cass_year" | "journal_name" | "major_category" | "major_quartile"
      >,
  ): Promise<InsertResult> {
    const result = await insertRecord({
      tableName: "zsearch_cass_quartiles",
      columns: [
        "cass_year",
        "journal_name",
        "issn",
        "eissn",
        "is_review",
        "is_oa",
        "wos_category",
        "major_category",
        "major_category_en",
        "major_quartile",
        "major_rank",
        "major_total",
        "is_top",
        "minor_categories",
      ],
      record,
      keyColumns: ["cass_year", "journal_name"],
      yearColumn: "cass_year",
    });
    this.resetLatestYear();
    return result;
  }

  /** Update by composite key. */
  async updateByKey(
    key: { cass_year: number; journal_name: string },
    changes: Partial<CASSRecord>,
  ): Promise<UpdateResult> {
    const result = await updateRecord({
      tableName: "zsearch_cass_quartiles",
      keyColumns: ["cass_year", "journal_name"],
      keyValues: [key.cass_year, key.journal_name],
      changes,
      yearColumn: "cass_year",
    });
    this.resetLatestYear();
    return result;
  }

  /** Delete by composite key. */
  async deleteByKey(key: {
    cass_year: number;
    journal_name: string;
  }): Promise<DeleteResult> {
    const result = await deleteRecord({
      tableName: "zsearch_cass_quartiles",
      keyColumns: ["cass_year", "journal_name"],
      keyValues: [key.cass_year, key.journal_name],
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
      "zsearch_cass_quartiles",
      filters,
      filterLogic,
    );
    const result = await clearTable("zsearch_cass_quartiles", where);
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
      "zsearch_cass_quartiles",
      opts?.filters,
      opts?.filterLogic,
    );
    return exportTable({
      tableName: "zsearch_cass_quartiles",
      yearColumn: "cass_year",
      year: opts?.year,
      format: opts?.format,
      where,
    });
  }

  /** Dry-run import: classify rows into insert/update/noop/older-overwrite. */
  async dryRunImport(
    rows: Array<Partial<CASSRecord>>,
  ): Promise<ConflictReport> {
    return dryRunImportUtil({
      tableName: "zsearch_cass_quartiles",
      keyColumns: ["cass_year", "journal_name"],
      yearColumn: "cass_year",
      rows: rows as Array<Record<string, unknown>>,
    });
  }

  /** Bulk import rows. Replaces the old importData signature. */
  async importRows(
    rows: Array<Partial<CASSRecord>>,
  ): Promise<{ inserted: number; updated: number; skipped: number }> {
    const result = await importRowsUtil({
      tableName: "zsearch_cass_quartiles",
      columns: [
        "cass_year",
        "journal_name",
        "issn",
        "eissn",
        "is_review",
        "is_oa",
        "wos_category",
        "major_category",
        "major_category_en",
        "major_quartile",
        "major_rank",
        "major_total",
        "is_top",
        "minor_categories",
      ],
      rows: rows as Array<Record<string, unknown>>,
      mode: "insert-or-ignore",
      // UNIQUE(cass_year, journal_name) + 部分唯一索引
      // idx_cass_quartiles_year_issn(cass_year, issn) WHERE issn IS NOT NULL
      // （见 CASSSchema）。两个键集合都要查，预检才对得上 INSERT OR IGNORE。
      conflictKeys: [
        ["cass_year", "journal_name"],
        ["cass_year", "issn"],
      ],
    });
    this.resetLatestYear();
    return result;
  }

  /** Convert a raw DB row to a typed CASSRecord */
  private toRecord(row: any): CASSRecord {
    return {
      id: row.id,
      cass_year: row.cass_year,
      journal_name: row.journal_name,
      issn: row.issn ?? null,
      eissn: row.eissn ?? null,
      is_review: row.is_review === 1,
      is_oa: row.is_oa === 1,
      wos_category: row.wos_category ?? null,
      major_category: row.major_category,
      major_category_en: row.major_category_en ?? null,
      major_quartile: row.major_quartile,
      major_rank: row.major_rank ?? null,
      major_total: row.major_total ?? null,
      is_top: row.is_top === 1,
      minor_categories: parseMinorCategories(row.minor_categories),
    };
  }
}
export default new CASSStore();
