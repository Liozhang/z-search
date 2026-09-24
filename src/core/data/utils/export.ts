/**
 * Generic table export for datasource stores — JSON or CSV string.
 *
 * Extracted from JCRStore / CASSStore / WarningListStore, whose exportData
 * methods were byte-identical modulo the table name and year column. Pure
 * helper (no class hierarchy) — callers pass their own tableName / yearColumn.
 *
 * @module core/data/utils/export
 */

import { queryPlain } from "../queryPlain";
import { csvEscape } from "./normalize";

export async function exportTable(opts: {
  tableName: string;
  /** Column used when building a bound `col = ?` condition from opts.year. */
  yearColumn?: string;
  year?: number;
  format?: "json" | "csv";
  /** C-1: bound WHERE fragment from utils/filters (structured filters). */
  where?: { sql: string; params: (string | number)[] } | null;
}): Promise<{
  format: "json" | "csv";
  year?: number;
  count: number;
  content: string;
  columns: string[];
}> {
  const format = opts.format ?? "json";
  // C-1: year is bound as a parameter (previously interpolated raw); filters
  // arrive pre-bound from utils/filters. Both combine with AND.
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  if (opts.year !== undefined && opts.yearColumn) {
    conditions.push(`"${opts.yearColumn}" = ?`);
    params.push(opts.year);
  }
  if (opts.where) {
    conditions.push(`(${opts.where.sql})`);
    params.push(...opts.where.params);
  }
  // Safety cap: these are fixed-size reference-data exports (JCR/CASS/Bealls),
  // not user-library content. The limit guards against a pathological table
  // size without truncating any realistic reference dataset.
  const EXPORT_ROW_CAP = 100000;
  const baseSql =
    conditions.length > 0
      ? `SELECT * FROM ${opts.tableName} WHERE ${conditions.join(" AND ")}`
      : `SELECT * FROM ${opts.tableName}`;
  const sql = `${baseSql} LIMIT ${EXPORT_ROW_CAP}`;
  const rows = await queryPlain(sql, params);

  if (format === "json") {
    return {
      format: "json",
      year: opts.year,
      count: rows.length,
      content: JSON.stringify({ year: opts.year, data: rows }),
      columns: Object.keys(rows[0] ?? {}),
    };
  }
  // CSV
  const columns = Object.keys(rows[0] ?? {});
  const header = columns.join(",");
  const lines = rows.map((r) => columns.map((c) => csvEscape(r[c])).join(","));
  return {
    format: "csv",
    year: opts.year,
    count: rows.length,
    content: [header, ...lines].join("\n"),
    columns,
  };
}
