/**
 * WarningListStore — Query API for international journal warning list data.
 *
 * Provides lookup by journal name (normalized uppercase exact match).
 * Returns warning records across all years (2020-2025).
 *
 * @module core/data/WarningListStore
 */

import { SAFE_BATCH_SIZE as BATCH_SIZE } from "../../utils/constants";

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
import { normalizeJournalName } from "./utils/normalize";
import { exportTable } from "./utils/export";
import { safeDebug } from "../../utils/logger";

/** Warning record returned from database */
export interface WarningRecord {
  id: number;
  journal_name: string;
  warning_year: number;
  warning_level: string | null;
  warning_level_en: string | null;
  warning_reason: string | null;
  warning_reason_en: string | null;
}
class WarningListStore {
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
  }

  /**
   * Lookup all warning records for a journal across all years.
   */
  async lookup(journalName: string): Promise<WarningRecord[]> {
    if (!journalName) return [];
    const normalized = normalizeJournalName(journalName);

    try {
      const rows = await queryPlain(
        // 年份倒序：metric 卡取 r[0] 应得最新记录——无排序时取到哪一年
        // 取决于物理行序（审计 P1-7）
        `SELECT * FROM zsearch_journal_warnings WHERE journal_name = ? ORDER BY warning_year DESC`,
        [normalized],
      );
      return (
        rows?.map((row) => ({
          id: row.id,
          journal_name: row.journal_name,
          warning_year: row.warning_year,
          warning_level: row.warning_level ?? null,
          warning_level_en: row.warning_level_en ?? null,
          warning_reason: row.warning_reason ?? null,
          warning_reason_en: row.warning_reason_en ?? null,
        })) ?? []
      );
    } catch (e) {
      safeDebug("[z-search] WarningListStore: " + e);
      return [];
    }
  }

  /**
   * Check if a journal has any warning record.
   *
   * F-38（回退审计 2026-09-11，P1）：DB 故障返回 `null`（状态未知）而非
   * `false`——fail-open 曾把"查不了预警名单"报告成"该期刊不在名单上"，
   * predatory journal 可能被呈现为安全。调用方对 null 应显示
   * "预警状态未知"而非当作通过。
   */
  async isWarning(journalName: string): Promise<boolean | null> {
    if (!journalName) return false;
    const normalized = normalizeJournalName(journalName);

    try {
      const rows = await queryPlain(
        `SELECT 1 AS found FROM zsearch_journal_warnings WHERE journal_name = ? LIMIT 1`,
        [normalized],
      );
      return rows?.length > 0;
    } catch (e) {
      safeDebug(
        "[z-search] WarningListStore: lookup failed (unknown state): " + e,
      );
      return null;
    }
  }

  /**
   * Batch lookup warnings by journal names. Used for prefetching.
   * Returns Map<normalizedUppercaseName, WarningRecord> (latest year per journal).
   */
  async batchLookupWarnings(
    names: string[],
  ): Promise<Map<string, WarningRecord>> {
    if (names.length === 0) return new Map();

    const result = new Map<string, WarningRecord>();
    const uniqueUpper = [...new Set(names.map((n) => normalizeJournalName(n)))];

    for (let i = 0; i < uniqueUpper.length; i += BATCH_SIZE) {
      const batch = uniqueUpper.slice(i, i + BATCH_SIZE);
      const placeholders = batch.map(() => "?").join(",");
      const rows = await queryPlain(
        `SELECT * FROM zsearch_journal_warnings
         WHERE journal_name IN (${placeholders})
         ORDER BY warning_year DESC`,
        [...batch],
      );
      for (const row of rows) {
        if (row.journal_name && !result.has(row.journal_name.toUpperCase())) {
          result.set(row.journal_name.toUpperCase(), {
            id: row.id,
            journal_name: row.journal_name,
            warning_year: row.warning_year,
            warning_level: row.warning_level ?? null,
            warning_level_en: row.warning_level_en ?? null,
            warning_reason: row.warning_reason ?? null,
            warning_reason_en: row.warning_reason_en ?? null,
          });
        }
      }
    }

    return result;
  }

  /**
   * Get the total number of warning records.
   */
  async getCount(): Promise<number> {
    try {
      const rows = await queryPlain(
        `SELECT COUNT(*) AS cnt FROM zsearch_journal_warnings`,
      );
      return rows?.[0]?.cnt ?? 0;
    } catch (e) {
      safeDebug("[z-search] WarningListStore: " + e);
      return 0;
    }
  }

  /** Insert a single record. Returns inserted or already-exists. */
  async insert(
    record: Partial<WarningRecord> &
      Pick<WarningRecord, "journal_name" | "warning_year">,
  ): Promise<InsertResult> {
    return insertRecord({
      tableName: "zsearch_journal_warnings",
      columns: [
        "journal_name",
        "warning_year",
        "warning_level",
        "warning_level_en",
        "warning_reason",
        "warning_reason_en",
      ],
      record,
      keyColumns: ["journal_name", "warning_year"],
      yearColumn: "warning_year",
    });
  }

  /** Update by composite key. */
  async updateByKey(
    key: { journal_name: string; warning_year: number },
    changes: Partial<WarningRecord>,
  ): Promise<UpdateResult> {
    return updateRecord({
      tableName: "zsearch_journal_warnings",
      keyColumns: ["journal_name", "warning_year"],
      keyValues: [key.journal_name, key.warning_year],
      changes,
      yearColumn: "warning_year",
    });
  }

  /** Delete by composite key. */
  async deleteByKey(key: {
    journal_name: string;
    warning_year: number;
  }): Promise<DeleteResult> {
    return deleteRecord({
      tableName: "zsearch_journal_warnings",
      keyColumns: ["journal_name", "warning_year"],
      keyValues: [key.journal_name, key.warning_year],
    });
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
      "zsearch_journal_warnings",
      filters,
      filterLogic,
    );
    return clearTable("zsearch_journal_warnings", where);
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
      "zsearch_journal_warnings",
      opts?.filters,
      opts?.filterLogic,
    );
    return exportTable({
      tableName: "zsearch_journal_warnings",
      yearColumn: "warning_year",
      year: opts?.year,
      format: opts?.format,
      where,
    });
  }

  /** Dry-run import: classify rows into insert/update/noop/older-overwrite. */
  async dryRunImport(
    rows: Array<Partial<WarningRecord>>,
  ): Promise<ConflictReport> {
    return dryRunImportUtil({
      tableName: "zsearch_journal_warnings",
      keyColumns: ["journal_name", "warning_year"],
      yearColumn: "warning_year",
      rows: rows as Array<Record<string, unknown>>,
    });
  }

  /** Bulk import rows. Replaces the old importData signature. */
  async importRows(
    rows: Array<Partial<WarningRecord>>,
  ): Promise<{ inserted: number; updated: number; skipped: number }> {
    return importRowsUtil({
      tableName: "zsearch_journal_warnings",
      columns: [
        "journal_name",
        "warning_year",
        "warning_level",
        "warning_level_en",
        "warning_reason",
        "warning_reason_en",
      ],
      rows: rows as Array<Record<string, unknown>>,
      mode: "insert-or-ignore",
      // UNIQUE(journal_name, warning_year)（见 WarningListSchema）
      conflictKeys: [["journal_name", "warning_year"]],
    });
  }
}
export default new WarningListStore();
