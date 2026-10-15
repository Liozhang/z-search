/**
 * XRStore — Query API for XinRui (新锐) journal quartile data.
 *
 * 新锐分区（2026 年起由原中科院分区表团队接续发布）的查询接口，表结构与查
 * 询口径对齐 CASSStore：ISSN → eISSN → 刊名三级命中，默认取库内最新年份。
 * major_quartile 可空——个别期刊只收编不入区（badge 查询按 IS NOT NULL 过滤）。
 *
 * @module core/data/XRStore
 */

import { SAFE_BATCH_SIZE as BATCH_SIZE } from "../../utils/constants";
import { chunkByParams } from "../../utils/sqlBatch";

import { queryPlain } from "./queryPlain";
import { importRows as importRowsUtil } from "./utils/crud";
import { normalizeISSN, normalizeJournalName } from "./utils/normalize";
import { safeDebug } from "../../utils/logger";
import type { CASSMinorCategory } from "./CASSStore";

/** XR record returned from database */
export interface XRRecord {
  id: number;
  xr_year: number;
  journal_name: string;
  chinese_name: string | null;
  issn: string | null;
  eissn: string | null;
  cn: string | null;
  wos_database: string | null;
  is_under_review: boolean;
  major_category: string;
  major_category_en: string | null;
  major_quartile: number | null;
  is_top: boolean;
  major2_category: string | null;
  major2_category_en: string | null;
  major2_quartile: number | null;
  minor_categories: CASSMinorCategory[];
}

/** Compact data for batch prefetch (avoids parsing JSON for every item) */
export interface XRQuartileInfo {
  quartile: number;
  category: string;
  categoryEn: string | null;
  isTop: boolean;
  isUnderReview: boolean;
}

function parseMinorCategories(json: string | null): CASSMinorCategory[] {
  if (!json) return [];
  try {
    const raw: Array<{
      n?: string;
      nc?: string;
      q?: number;
    }> = JSON.parse(json);
    return raw.map((entry) => ({
      n: entry.n ?? "",
      nc: entry.nc ?? "",
      q: entry.q ?? 0,
      r: null,
      t: null,
    }));
  } catch (e) {
    safeDebug("[z-search] XRStore: " + e);
    return [];
  }
}

class XRStore {
  private initialized = false;
  private _latestYear: number | null = null;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
  }

  /**
   * Get the latest XR year available in the database.
   * Result is cached per-instance; invalidate via resetLatestYear().
   */
  async getLatestYear(): Promise<number | null> {
    if (this._latestYear !== null) return this._latestYear;
    try {
      const rows = await queryPlain(
        `SELECT MAX(xr_year) AS max_year FROM zsearch_xr_quartiles`,
      );
      this._latestYear = rows?.[0]?.max_year ?? null;
      return this._latestYear;
    } catch (e) {
      safeDebug("[z-search] XRStore: " + e);
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
  }): Promise<XRRecord | null> {
    const targetYear = options.year ?? (await this.getLatestYear());
    if (!targetYear) return null;

    if (options.issn) {
      const normalized = normalizeISSN(options.issn);
      const rows = await queryPlain(
        `SELECT * FROM zsearch_xr_quartiles
         WHERE xr_year = ? AND issn = ?
         LIMIT 1`,
        [targetYear, normalized],
      );
      if (rows?.[0]) return this.toRecord(rows[0]);
    }

    if (options.eissn) {
      const normalized = normalizeISSN(options.eissn);
      const rows = await queryPlain(
        `SELECT * FROM zsearch_xr_quartiles
         WHERE xr_year = ? AND eissn = ?
         LIMIT 1`,
        [targetYear, normalized],
      );
      if (rows?.[0]) return this.toRecord(rows[0]);
    }

    if (options.journalName) {
      const normalized = normalizeJournalName(options.journalName);
      const rows = await queryPlain(
        `SELECT * FROM zsearch_xr_quartiles
         WHERE xr_year = ? AND journal_name = ?
         LIMIT 1`,
        [targetYear, normalized],
      );
      if (rows?.[0]) return this.toRecord(rows[0]);
    }

    return null;
  }

  /**
   * Batch lookup quartiles by journal names (badge/discover 行批量补齐).
   * Returns Map<normalizedUppercaseName, XRQuartileInfo>.
   */
  async batchLookupQuartiles(
    names: string[],
    year?: number,
  ): Promise<Map<string, XRQuartileInfo>> {
    const targetYear = year ?? (await this.getLatestYear());
    if (!targetYear || names.length === 0) return new Map();

    const result = new Map<string, XRQuartileInfo>();
    const uniqueUpper = [...new Set(names.map((n) => normalizeJournalName(n)))];

    for (let i = 0; i < uniqueUpper.length; i += BATCH_SIZE) {
      const batch = uniqueUpper.slice(i, i + BATCH_SIZE);
      const placeholders = batch.map(() => "?").join(",");
      const rows = await queryPlain(
        `SELECT journal_name, major_quartile, major_category, major_category_en, is_top, is_under_review
         FROM zsearch_xr_quartiles
         WHERE xr_year = ? AND journal_name IN (${placeholders})`,
        [targetYear, ...batch],
      );
      for (const row of rows) {
        if (row.journal_name && row.major_quartile) {
          result.set(row.journal_name.toUpperCase(), {
            quartile: row.major_quartile as number,
            category: row.major_category ?? "",
            categoryEn: row.major_category_en ?? null,
            isTop: row.is_top === 1,
            isUnderReview: row.is_under_review === 1,
          });
        }
      }
    }

    return result;
  }

  /**
   * Batch lookup full XR records by ISSN/eISSN. Each DB record is keyed by
   * BOTH its normalized issn and eissn. Returns Map<normalizedIssn, XRRecord>.
   */
  async batchLookupByIssn(
    issns: string[],
    year?: number,
  ): Promise<Map<string, XRRecord>> {
    const result = new Map<string, XRRecord>();
    if (!issns || issns.length === 0) return result;

    const targetYear = year ?? (await this.getLatestYear());
    if (!targetYear) return result;

    const normalized = [
      ...new Set(issns.map((s) => normalizeISSN(s)).filter(Boolean)),
    ];
    if (normalized.length === 0) return result;

    // 每个 ISSN 在 SQL 里绑两次（issn 一个 IN、eissn 一个 IN），一块的参数数
    // = 1(year) + 2×chunk，与 JCR/CASS 同一条 999 绑定上限约束。
    for (const batch of chunkByParams(normalized, 2)) {
      const placeholders = batch.map(() => "?").join(",");
      const rows = await queryPlain(
        `SELECT * FROM zsearch_xr_quartiles
         WHERE xr_year = ? AND (issn IN (${placeholders}) OR eissn IN (${placeholders}))`,
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
   * Get the total number of XR records for a given year.
   */
  async getCount(year?: number): Promise<number> {
    try {
      const targetYear = year ?? (await this.getLatestYear());
      if (!targetYear) return 0;
      const rows = await queryPlain(
        `SELECT COUNT(*) AS cnt FROM zsearch_xr_quartiles WHERE xr_year = ?`,
        [targetYear],
      );
      return rows?.[0]?.cnt ?? 0;
    } catch (e) {
      safeDebug("[z-search] XRStore: " + e);
      return 0;
    }
  }

  /**
   * Check if XR data exists for a given year.
   */
  async hasData(year?: number): Promise<boolean> {
    return (await this.getCount(year)) > 0;
  }

  /** Bulk import rows (startup / 期刊页「立即导入」共用). */
  async importRows(
    rows: Array<Partial<XRRecord>>,
  ): Promise<{ inserted: number; updated: number; skipped: number }> {
    const result = await importRowsUtil({
      tableName: "zsearch_xr_quartiles",
      columns: [
        "xr_year",
        "journal_name",
        "chinese_name",
        "issn",
        "eissn",
        "cn",
        "wos_database",
        "is_under_review",
        "major_category",
        "major_category_en",
        "major_quartile",
        "is_top",
        "major2_category",
        "major2_category_en",
        "major2_quartile",
        "minor_categories",
      ],
      rows: rows as Array<Record<string, unknown>>,
      mode: "insert-or-ignore",
      // UNIQUE(xr_year, journal_name) + 部分唯一索引
      // idx_xr_quartiles_year_issn(xr_year, issn) WHERE issn IS NOT NULL
      // （见 XRSchema）。两个键集合都要查，预检才对得上 INSERT OR IGNORE。
      conflictKeys: [
        ["xr_year", "journal_name"],
        ["xr_year", "issn"],
      ],
    });
    this.resetLatestYear();
    return result;
  }

  /** Convert a raw DB row to a typed XRRecord */
  private toRecord(row: any): XRRecord {
    return {
      id: row.id,
      xr_year: row.xr_year,
      journal_name: row.journal_name,
      chinese_name: row.chinese_name ?? null,
      issn: row.issn ?? null,
      eissn: row.eissn ?? null,
      cn: row.cn ?? null,
      wos_database: row.wos_database ?? null,
      is_under_review: row.is_under_review === 1,
      major_category: row.major_category,
      major_category_en: row.major_category_en ?? null,
      major_quartile: row.major_quartile ?? null,
      is_top: row.is_top === 1,
      major2_category: row.major2_category ?? null,
      major2_category_en: row.major2_category_en ?? null,
      major2_quartile: row.major2_quartile ?? null,
      minor_categories: parseMinorCategories(row.minor_categories),
    };
  }
}
export default new XRStore();
