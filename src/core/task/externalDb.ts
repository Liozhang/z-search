/**
 * Shared external-database connections for leadero's own sqlite files
 * (zsearch_tasks.sqlite / zsearch_task_contexts.sqlite).
 *
 * Why this exists: `Zotero.DB.queryAsync(sql, params, { db: path })` was used
 * before, but that third-argument option does not exist in Zotero — the only
 * supported options are noParseParams/ignoreDBLock/onRow/noCache, and
 * `_getConnection()` ignores options entirely (db.js:608-643, 1453). Every
 * query silently ran against the user's MAIN zotero.sqlite, creating the
 * plugin's tables there. The supported API for a separate database file is a
 * dedicated `new Zotero.DBConnection(path)` instance (db.js:34; a path with a
 * separator marks it _externalDB). External connections do NOT inherit the
 * foreign_keys pragma (that block runs only for the main DB, db.js:1543+), so
 * each init() must set `PRAGMA foreign_keys=ON` itself.
 *
 * Migration: rows previously written into the main DB by the broken `{db:}`
 * calls are copied into the external file once, then the stray tables are
 * dropped from the main DB.
 */

const connections = new Map<string, any>();

/** Get (and cache) a Zotero.DBConnection for an external sqlite file in the profile dir. */
export function getExternalDb(filename: string): any {
  let conn = connections.get(filename);
  if (!conn) {
    const Zotero = (globalThis as any).Zotero;
    conn = new Zotero.DBConnection(
      PathUtils.join(Zotero.Profile.dir, filename),
    );
    connections.set(filename, conn);
  }
  return conn;
}

/**
 * One-time migration of tables accidentally created in the main zotero.sqlite
 * by the old `{db:}`-option code path. Copies all rows into `conn`, then drops
 * the stray tables. Failure is logged and non-fatal (worst case: migration
 * retries on next startup; INSERT OR REPLACE keeps it idempotent).
 */
export async function migrateTableFromMainDb(
  conn: any,
  table: string,
): Promise<void> {
  const Zotero = (globalThis as any).Zotero;
  let mainRows: any[] | undefined;
  let columns: string[];
  try {
    const exists = await Zotero.DB.queryAsync(
      "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
      [table],
    );
    if (!exists || exists.length === 0) return;
    // Row objects from queryAsync are Proxies keyed by column name and are not
    // enumerable — read the column list explicitly (same schema as external).
    const info = await Zotero.DB.queryAsync(`PRAGMA table_info(${table})`);
    columns = (info || []).map((c: any) => c.name);
    mainRows = await Zotero.DB.queryAsync(
      `SELECT ${columns.join(", ")} FROM ${table}`,
    );
  } catch (e: any) {
    Zotero.logError?.(
      `[leadero] migrateTableFromMainDb(${table}) read failed: ${e}`,
    );
    return;
  }
  if (!mainRows || mainRows.length === 0 || columns.length === 0) {
    await dropMainTable(table);
    return;
  }
  try {
    const colList = columns.join(", ");
    const placeholders = columns.map(() => "?").join(", ");
    for (const row of mainRows) {
      await conn.queryAsync(
        `INSERT OR REPLACE INTO ${table} (${colList}) VALUES (${placeholders})`,
        columns.map((c) => row[c]),
      );
    }
    await dropMainTable(table);
  } catch (e: any) {
    Zotero.logError?.(
      `[leadero] migrateTableFromMainDb(${table}) write failed: ${e}`,
    );
  }
}

async function dropMainTable(table: string): Promise<void> {
  const Zotero = (globalThis as any).Zotero;
  try {
    await Zotero.DB.queryAsync(`DROP TABLE IF EXISTS ${table}`);
  } catch (e: any) {
    Zotero.logError?.(
      `[leadero] migrateTableFromMainDb(${table}) drop failed: ${e}`,
    );
  }
}
