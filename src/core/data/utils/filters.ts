/**
 * Structured table filters — the ONLY sanctioned way to scope datasource
 * clear/export operations (C-1).
 *
 * History: these tools previously accepted a raw `whereClause` SQL string
 * (LLM-controlled) that was interpolated directly into statements against
 * Zotero's MAIN database — a SQL-injection path with zero approval gating.
 * This module replaces that contract with `{field, op, value}[]` filters:
 *
 *   - field must match /^[a-zA-Z_][a-zA-Z0-9_]*$/ AND be a real column of
 *     the target table (PRAGMA table_info, cached by queryPlain)
 *   - op is a fixed enum mapped to SQL fragments
 *   - values are ALWAYS bound parameters (`?`) — never interpolated
 *
 * @module core/data/utils/filters
 */

export type FilterOp = "eq" | "ne" | "gt" | "lt" | "ge" | "le" | "like" | "in";
export type FilterLogic = "and" | "or";

import { assertParamBudget } from "../../../utils/sqlBatch";

export interface StructuredFilter {
  field: string;
  op: FilterOp;
  value: string | number | (string | number)[];
}

/** Parameterized WHERE fragment produced by buildWhereFromFilters. */
export interface BuiltWhere {
  sql: string;
  params: (string | number)[];
}

const OP_SQL: Record<FilterOp, string> = {
  eq: "=",
  ne: "!=",
  gt: ">",
  lt: "<",
  ge: ">=",
  le: "<=",
  like: "LIKE",
  in: "IN",
};

const FIELD_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Compile structured filters into a bound-parameter WHERE fragment.
 * Returns null when filters is empty/absent (= whole table).
 * Throws Error on any invalid field/op/value — callers surface it as a
 * structured tool error; nothing is ever silently coerced.
 */
export function buildWhereFromFilters(
  filters: StructuredFilter[] | undefined | null,
  allowedColumns: readonly string[],
  logic: FilterLogic = "and",
): BuiltWhere | null {
  if (!filters || !Array.isArray(filters) || filters.length === 0) return null;

  const cols = new Set(allowedColumns);
  const parts: string[] = [];
  const params: (string | number)[] = [];

  for (const f of filters) {
    if (!f || typeof f.field !== "string" || !FIELD_RE.test(f.field)) {
      throw new Error(`Invalid filter field: ${JSON.stringify(f?.field)}`);
    }
    if (!cols.has(f.field)) {
      throw new Error(
        `Filter field not a column of this table: ${f.field} (allowed: ${[...cols].join(", ")})`,
      );
    }
    const opSql = OP_SQL[f?.op as FilterOp];
    if (!opSql) {
      throw new Error(`Invalid filter op: ${JSON.stringify(f?.op)}`);
    }

    if (f.op === "in") {
      if (
        !Array.isArray(f.value) ||
        f.value.length === 0 ||
        !f.value.every((v) => typeof v === "string" || typeof v === "number")
      ) {
        throw new Error(
          'Filter op "in" requires a non-empty array of strings/numbers',
        );
      }
      // 2026-09-10（审计 G-05）：`in` 取值只校验了类型，没有校验**个数**。
      // 这条构建器是数据源 clear/query 路径的共用件，调用方（含 agent）可以传
      // 任意长的数组——超过 999 个取值时下游 SQL 会以底层报错失败。
      assertParamBudget(
        f.value.length + params.length,
        `filters 的 "${f.field}" IN 条件`,
      );
      parts.push(`"${f.field}" IN (${f.value.map(() => "?").join(",")})`);
      params.push(...f.value);
    } else {
      if (typeof f.value !== "string" && typeof f.value !== "number") {
        throw new Error(
          `Filter op "${f.op}" requires a string or number value`,
        );
      }
      parts.push(`"${f.field}" ${opSql} ?`);
      params.push(f.value);
    }
  }

  return { sql: parts.join(` ${logic === "or" ? "OR" : "AND"} `), params };
}

/**
 * Build a WHERE fragment validated against the actual columns of `tableName`
 * (PRAGMA table_info via queryPlain's cache). Import dynamically to avoid a
 * module cycle (queryPlain ↔ filters).
 */
export async function buildTableWhere(
  tableName: string,
  filters: StructuredFilter[] | undefined | null,
  logic: FilterLogic = "and",
): Promise<BuiltWhere | null> {
  if (!filters || filters.length === 0) return null;
  const { getTableColumnNames } = await import("../queryPlain");
  const columns = await getTableColumnNames(tableName);
  return buildWhereFromFilters(filters, columns, logic);
}
