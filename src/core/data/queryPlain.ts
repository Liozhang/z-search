/**
 * Shared queryPlain — Execute parameterized SQL and return rows as plain objects.
 *
 * Resolves column names from the SELECT clause or PRAGMA table_info,
 * then builds objects from Zotero.DB.queryAsync row results.
 *
 * @module core/data/queryPlain
 */

import { safeDebug } from "../../utils/logger";

const _tableColumnsCache = new Map<string, string[]>();

const VALID_TABLE_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function invalidateColumnCache(tableName?: string): void {
  if (tableName) {
    _tableColumnsCache.delete(tableName);
  } else {
    _tableColumnsCache.clear();
  }
}

async function getTableColumns(tableName: string): Promise<string[]> {
  if (!VALID_TABLE_NAME.test(tableName)) {
    throw new Error(`queryPlain: invalid table name: ${tableName}`);
  }

  const cached = _tableColumnsCache.get(tableName);
  if (cached) return cached;

  const cols: string[] = [];
  await Zotero.DB.queryAsync(`PRAGMA table_info(${tableName})`, undefined, {
    onRow: (row: any) => {
      try {
        const name = row.getResultByIndex(1);
        if (typeof name === "string") cols.push(name);
      } catch (e) {
        safeDebug("[z-search] queryPlain: " + e); /* skip */
      }
    },
  });
  _tableColumnsCache.set(tableName, cols);
  return cols;
}

/**
 * Public column-name accessor (PRAGMA table_info, cached) — used by
 * utils/filters to whitelist structured-filter fields per table.
 */
export async function getTableColumnNames(
  tableName: string,
): Promise<string[]> {
  return getTableColumns(tableName);
}

function parseSelectColumns(colPart: string): string[] {
  return colPart.split(",").map((c) => {
    const trimmed = c.trim();
    const asMatch = trimmed.match(/(?:\bAS\s+)?(\w+)\s*$/i);
    return asMatch ? asMatch[1] : trimmed;
  });
}

export async function queryPlain(sql: string, params?: any[]): Promise<any[]> {
  let columns: string[] = [];
  const selectMatch = sql.trim().match(/^SELECT\s+(.+?)\s+FROM\s+(\w+)/i);
  if (selectMatch) {
    const colPart = selectMatch[1].trim();
    const tableName = selectMatch[2].trim();
    if (colPart !== "*") {
      columns = parseSelectColumns(colPart);
    } else {
      columns = await getTableColumns(tableName);
    }
  }

  if (columns.length === 0) {
    throw new Error(
      `queryPlain: unable to resolve columns for: ${sql.slice(0, 80)}`,
    );
  }

  const rows: any[] = [];
  await Zotero.DB.queryAsync(sql, params, {
    onRow: (row: any) => {
      const obj: any = {};
      for (let i = 0; i < columns.length; i++) {
        try {
          obj[columns[i]] = row.getResultByIndex(i);
        } catch (e) {
          safeDebug("[z-search] queryPlain: " + e);
          try {
            obj[columns[i]] = row.getResultByName(columns[i]);
          } catch (e) {
            safeDebug("[z-search] queryPlain: " + e); /* skip */
          }
        }
      }
      rows.push(obj);
    },
  });
  return rows;
}
