/**
 * Generic CRUD utilities for Leadero datasource tables.
 *
 * All functions accept an optional `tx` (Zotero transaction) — when passed,
 * the operation participates in the caller's transaction; when omitted,
 * a fresh transaction is created.
 *
 * IN-clause batching (SQLite ≤ 999 params) is handled internally; callers
 * pass arbitrary-length arrays without chunking.
 *
 * Zotero 的 db.js 拒绝把 NULL 绑进 SELECT 的括号占位符（`IN (?, ...)` 与
 * row-value IN）：`col = ?` 会被改写成 `IS NULL`（安全），括号里的 `?` 遇到
 * NULL 参数直接抛。本模块的 SELECT 都在绑参前过滤掉含 NULL 的键行——新增查询
 * 时守住这条线，别把可空列直接塞进括号占位符。
 *
 * @module core/data/utils/crud
 */

import { queryPlain, getTableColumnNames } from "../queryPlain";
// 单一真源：此前这里私藏一份 `const SAFE_BATCH_SIZE = 900`，与 constants.ts 同名
// 同值但互不约束——改一处漏一处不会报错（审计双真相源条款）。
import { SAFE_BATCH_SIZE } from "../../../utils/constants";

// --- Result types ---

export interface InsertResult {
  status: "inserted" | "already-exists";
  id?: number;
  existingId?: number;
}

export interface UpdateResult {
  status: "updated" | "noop" | "not-found" | "older-overwrite-warning";
  before?: Record<string, unknown>;
}

export interface DeleteResult {
  status: "deleted" | "not-found";
  before?: Record<string, unknown>;
}

export interface ConflictReport {
  insertCount: number;
  updateCount: number;
  noopCount: number;
  olderOverwrites: Array<{
    existing: Record<string, unknown>;
    incoming: Record<string, unknown>;
  }>;
}

// --- Helpers ---

async function queryByKey(
  tableName: string,
  keyColumns: string[],
  keyValues: unknown[],
): Promise<Record<string, unknown> | null> {
  const where = keyColumns.map((c) => `${c} = ?`).join(" AND ");
  const rows = await queryPlain(
    `SELECT * FROM ${tableName} WHERE ${where} LIMIT 1`,
    keyValues,
  );
  return rows[0] ?? null;
}

// --- insertRecord ---

export async function insertRecord(
  opts: {
    tableName: string;
    columns: string[];
    record: Record<string, unknown>;
    keyColumns: string[];
    yearColumn?: string;
  },
  tx?: any,
): Promise<InsertResult> {
  const { tableName, columns, record, keyColumns } = opts;
  if (keyColumns.length === 0) {
    throw new Error("insertRecord: keyColumns required");
  }

  const keyValues = keyColumns.map((c) => record[c]);
  const existing = await queryByKey(tableName, keyColumns, keyValues);
  if (existing) {
    return { status: "already-exists", existingId: existing.id as number };
  }

  const colList = columns.join(", ");
  const placeholders = columns.map(() => "?").join(", ");
  const values = columns.map((c) => record[c] ?? null);

  // Zotero.DB.queryAsync(INSERT) does NOT return lastInsertRowID reliably
  // (returns undefined across Zotero 7/8/9). Must explicitly SELECT last_insert_rowid()
  // within the same transaction to obtain the new row's id.
  const doInsert = async (): Promise<number> => {
    await Zotero.DB.queryAsync(
      `INSERT INTO ${tableName} (${colList}) VALUES (${placeholders})`,
      values,
    );
    const row = await Zotero.DB.queryAsync(`SELECT last_insert_rowid() AS id`);
    return Number(row[0]?.id ?? 0);
  };

  let newId: number;
  if (tx) {
    newId = await doInsert();
  } else {
    newId = await Zotero.DB.executeTransaction(doInsert);
  }

  return { status: "inserted", id: newId };
}

// --- updateRecord ---

export async function updateRecord(
  opts: {
    tableName: string;
    keyColumns: string[];
    keyValues: unknown[];
    changes: Record<string, unknown>;
    yearColumn?: string;
  },
  tx?: any,
): Promise<UpdateResult> {
  const { tableName, keyColumns, keyValues, changes } = opts;

  const existing = await queryByKey(tableName, keyColumns, keyValues);
  if (!existing) {
    return { status: "not-found" };
  }

  // noop detection: every change value matches existing value
  let allSame = true;
  for (const [col, val] of Object.entries(changes)) {
    if (existing[col] !== val) {
      allSame = false;
      break;
    }
  }
  if (allSame && Object.keys(changes).length > 0) {
    return { status: "noop", before: existing };
  }

  const changeKeys = Object.keys(changes);
  if (changeKeys.length === 0) {
    return { status: "noop", before: existing };
  }

  // SET clause positions take column NAMES interpolated into SQL (values stay
  // bound). `changes` comes straight from LLM tool args (write-jcr/cass/
  // bealls/warning), so a crafted key like "jif = 999 --" would inject SQL.
  // Whitelist keys against the live table schema before interpolating.
  const tableCols = new Set(await getTableColumnNames(tableName));
  const unknownCols = changeKeys.filter((c) => !tableCols.has(c));
  if (unknownCols.length > 0) {
    throw new Error(
      `updateRecord: unknown columns for ${tableName}: ${unknownCols.join(", ")}`,
    );
  }

  const setClause = changeKeys.map((c) => `${c} = ?`).join(", ");
  const setValues = Object.values(changes);
  const whereClause = keyColumns.map((c) => `${c} = ?`).join(" AND ");

  const doUpdate = async () => {
    await Zotero.DB.queryAsync(
      `UPDATE ${tableName} SET ${setClause} WHERE ${whereClause}`,
      [...setValues, ...keyValues],
    );
  };

  if (tx) {
    await doUpdate();
  } else {
    await Zotero.DB.executeTransaction(doUpdate);
  }

  return { status: "updated", before: existing };
}

// --- deleteRecord ---

export async function deleteRecord(
  opts: {
    tableName: string;
    keyColumns: string[];
    keyValues: unknown[];
  },
  tx?: any,
): Promise<DeleteResult> {
  const { tableName, keyColumns, keyValues } = opts;

  const existing = await queryByKey(tableName, keyColumns, keyValues);
  if (!existing) {
    return { status: "not-found" };
  }

  const whereClause = keyColumns.map((c) => `${c} = ?`).join(" AND ");
  const doDelete = async () => {
    await Zotero.DB.queryAsync(
      `DELETE FROM ${tableName} WHERE ${whereClause}`,
      keyValues,
    );
  };

  if (tx) {
    await doDelete();
  } else {
    await Zotero.DB.executeTransaction(doDelete);
  }

  return { status: "deleted", before: existing };
}

// --- dryRunImport ---

/**
 * Classify incoming rows against existing data into 4 buckets.
 *
 * - insertCount: key not in DB → would INSERT
 * - updateCount: key in DB, content differs, year >= existing → would UPDATE
 * - noopCount: key in DB, content identical → would skip
 * - olderOverwrites[]: key in DB but incoming year < existing year → dangerous, must ask user
 *
 * IN-clause batching: rows split internally into chunks of SAFE_BATCH_SIZE
 * per keyColumn to avoid SQLite's 999-param limit.
 *
 * Note: SQLite row-value IN syntax `(c1, c2) IN ((?,?),...)` requires SQLite 3.15+.
 * Rows whose key values contain NULL are never queried (NULL can't match under
 * SQLite, and Zotero's db.js refuses to bind NULL behind a parenthesized
 * placeholder in a SELECT — see importRows for the full story).
 */
export async function dryRunImport(opts: {
  tableName: string;
  keyColumns: string[];
  yearColumn?: string;
  rows: Array<Record<string, unknown>>;
}): Promise<ConflictReport> {
  const { tableName, keyColumns, yearColumn, rows } = opts;
  if (rows.length === 0) {
    return {
      insertCount: 0,
      updateCount: 0,
      noopCount: 0,
      olderOverwrites: [],
    };
  }

  // Index existing rows by composite key string (joined with NUL to avoid key collision)
  const existingByKey = new Map<string, Record<string, unknown>>();
  // 2026-09-10（E-05）：原按**行数**分块（每块 SAFE_BATCH_SIZE 行），但每行贡献
  // keyColumns.length 个占位符 —— 两列复合键时实际是 1800 个绑定参数，越过 999
  // 红线（>499 行的 JCR/CASS/warning 导入会在 dryRun 冲突预检中途抛错；同一文件的
  // importRows:340 却是对的）。此处与 importRows 同款按列数折算。
  const dryRunChunkSize = Math.max(
    1,
    Math.floor(SAFE_BATCH_SIZE / Math.max(1, keyColumns.length)),
  );
  for (let i = 0; i < rows.length; i += dryRunChunkSize) {
    const batch = rows.slice(i, i + dryRunChunkSize);
    // 键值含 NULL/undefined 的行不可能命中既有行——NULL 在 SQLite 的 `=` 与
    // row-value IN 比较里恒为 unknown——而且绝不能绑给 SELECT 的括号占位符：
    // Zotero 的 db.js parseQueryAndParams 会因此直接抛错（详见 importRows 的
    // E-07 注释）。这些行最终归入 insert 桶，与上面的过滤一致。
    const checkable = batch.filter((r) =>
      keyColumns.every((c) => r[c] !== null && r[c] !== undefined),
    );
    if (checkable.length === 0) continue;
    // Composite row-value IN: SELECT * WHERE (k1, k2) IN ((?,?),...)
    const placeholders = checkable
      .map(() => `(${keyColumns.map(() => "?").join(", ")})`)
      .join(", ");
    const params: unknown[] = [];
    for (const r of checkable) {
      for (const c of keyColumns) params.push(r[c]);
    }
    const keyCols = keyColumns.join(", ");
    const matched = await queryPlain(
      `SELECT * FROM ${tableName} WHERE (${keyCols}) IN (${placeholders})`,
      params,
    );
    for (const row of matched) {
      // 键列按 schema 均为 NOT NULL；万一库里真有 NULL 键值，该行不可能与任何
      // 输入行冲突，不入索引。
      if (keyColumns.some((c) => row[c] === null || row[c] === undefined)) {
        continue;
      }
      const k = keyColumns.map((c) => String(row[c])).join("\u0000");
      existingByKey.set(k, row);
    }
  }

  const report: ConflictReport = {
    insertCount: 0,
    updateCount: 0,
    noopCount: 0,
    olderOverwrites: [],
  };

  for (const incoming of rows) {
    const k = keyColumns.map((c) => String(incoming[c])).join("\u0000");
    const existing = existingByKey.get(k);
    if (!existing) {
      report.insertCount += 1;
      continue;
    }

    // Older-overwrite: incoming year < existing year (same business key, different year row)
    if (yearColumn) {
      const existingYear = Number(existing[yearColumn]);
      const incomingYear = Number(incoming[yearColumn]);
      // Same keyColumns but yearColumn differs → would create new row (insert), not overwrite.
      // Older-overwrite only applies when yearColumn is NOT in keyColumns
      // (i.e., key is ISSN only, yearColumn is data column).
      if (!keyColumns.includes(yearColumn) && incomingYear < existingYear) {
        report.olderOverwrites.push({ existing, incoming });
        continue;
      }
    }

    // Content comparison: every column of incoming row
    let allSame = true;
    for (const col of Object.keys(incoming)) {
      if (incoming[col] !== existing[col]) {
        allSame = false;
        break;
      }
    }
    if (allSame) {
      report.noopCount += 1;
    } else {
      report.updateCount += 1;
    }
  }

  return report;
}

// --- importRows ---

/**
 * 统计 batch 里有多少行已经存在于库——即 INSERT OR IGNORE 真正会跳过的行数。
 *
 * 语义按 INSERT OR IGNORE 逐行复刻：行被任一 UNIQUE 键集合命中就跳过；同一
 * 个键集合在库里已有行、或被本批次里先插入的行占用，都算已存在。
 *
 * 2026-09-23（E-07）：Zotero 的 db.js parseQueryAndParams 拒绝把 NULL 绑进
 * SELECT 的括号占位符——`col = ?` 会被改写成 `IS NULL`（安全），但 `(a,b)
 * IN ((?,?),...)` 这种括号里的 `?` 遇到 NULL 参数会直接抛
 * "NULL cannot be used for parenthesized placeholders in SELECT queries"。
 * 原 importRows 用"全部列"当冲突面，JCR 17 列里 15 列可空，每次启动导入第一
 * 个分块就炸、整个事务回滚，四个自带数据集一行都落不了库。
 * NULL 在 SQLite 的 UNIQUE 约束和 `=` 比较里也永远不可能命中，所以这里按
 * 键集合逐组过滤：该组取值全非空的行才进该组的 IN 列表。
 */
async function countExistingKeys(
  tableName: string,
  batch: Array<Record<string, unknown>>,
  keySets: string[][],
): Promise<number> {
  // 每个键集合只检查它自己取值全非空的行
  const checkable = keySets
    .map((ks) => ({
      ks,
      rows: batch.filter((r) =>
        ks.every((c) => r[c] !== null && r[c] !== undefined),
      ),
    }))
    .filter((x) => x.rows.length > 0);
  if (checkable.length === 0) return 0;

  const selectCols = [...new Set(keySets.flat())];
  const orTerms: string[] = [];
  const params: unknown[] = [];
  for (const { ks, rows } of checkable) {
    const tuplePlaceholders = `(${ks.map(() => "?").join(", ")})`;
    orTerms.push(
      `(${ks.join(", ")}) IN (${rows.map(() => tuplePlaceholders).join(", ")})`,
    );
    for (const r of rows) {
      for (const c of ks) params.push(r[c]);
    }
  }
  const found = (await Zotero.DB.queryAsync(
    `SELECT ${selectCols.join(", ")} FROM ${tableName} WHERE ${orTerms.join(" OR ")}`,
    params,
  )) as Array<Record<string, unknown>> | undefined;

  // 命中的库行 → 各键集合的键串集合（用 NUL 连接，与 dryRunImport 同约定）
  const occupied = new Set<string>();
  for (const row of found ?? []) {
    for (const ks of keySets) {
      if (ks.some((c) => row[c] === null || row[c] === undefined)) continue;
      occupied.add(ks.map((c) => String(row[c])).join("\u0000"));
    }
  }

  // 按 INSERT OR IGNORE 的顺序逐行判：已存在的行跳过；将插入的行其键集合
  // 立即占用，批次内重复键的后续行也会被正确计成跳过。
  const keyOf = (r: Record<string, unknown>, ks: string[]) =>
    ks.map((c) => String(r[c])).join("\u0000");
  let existingCount = 0;
  for (const r of batch) {
    let isExisting = false;
    for (const ks of keySets) {
      if (ks.some((c) => r[c] === null || r[c] === undefined)) continue;
      if (occupied.has(keyOf(r, ks))) {
        isExisting = true;
        break;
      }
    }
    if (isExisting) {
      existingCount += 1;
      continue;
    }
    for (const ks of keySets) {
      if (ks.some((c) => r[c] === null || r[c] === undefined)) continue;
      occupied.add(keyOf(r, ks));
    }
  }
  return existingCount;
}

/**
 * Bulk-insert rows atomically. IN-clause 999 limit handled by chunking
 * based on columnCount.
 *
 * Modes:
 *   - 'insert-or-ignore': INSERT OR IGNORE, skip conflicts
 *   - 'upsert': INSERT ... ON CONFLICT(...) DO UPDATE (requires UNIQUE constraint)
 *
 * Failure rolls back all rows in this call.
 *
 * 冲突键必填（原来 `opts.conflictColumns ?? columns` 的默认值就是 E-07 的触发点，
 * 见 countExistingKeys）：'upsert' 用 conflictColumns 作 ON CONFLICT 目标；
 * 'insert-or-ignore' 用 conflictKeys 声明表上**全部** UNIQUE 键集合——行被任一
 * 约束违反都会被跳过，预检少查一条，inserted/skipped 就会失真。
 */
export async function importRows(
  opts: {
    tableName: string;
    columns: string[];
    rows: Array<Record<string, unknown>>;
    mode: "insert-or-ignore" | "upsert";
    conflictColumns?: string[]; // 'upsert' 的 ON CONFLICT 目标
    conflictKeys?: string[][]; // 'insert-or-ignore'：表上全部 UNIQUE 键集合
  },
  tx?: any,
): Promise<{ inserted: number; updated: number; skipped: number }> {
  const { tableName, columns, rows, mode } = opts;
  if (rows.length === 0) {
    return { inserted: 0, updated: 0, skipped: 0 };
  }

  if (mode !== "insert-or-ignore" && mode !== "upsert") {
    throw new Error(`importRows: unknown mode ${mode}`);
  }
  if (mode === "upsert" && !opts.conflictColumns?.length) {
    throw new Error(`importRows: ${tableName} upsert requires conflictColumns`);
  }
  const keySets: string[][] = opts.conflictKeys?.length
    ? opts.conflictKeys
    : opts.conflictColumns?.length
      ? [opts.conflictColumns]
      : [];
  if (keySets.length === 0) {
    throw new Error(
      `importRows: ${tableName} insert-or-ignore requires conflictKeys ` +
        `(every UNIQUE key set on the table)`,
    );
  }

  // 分块同时受两条语句的参数数约束：INSERT 每行 columns.length 个，冲突预检
  // 每行 keySets 全部列数之和个。取更紧的那个，保证两条都在 SAFE_BATCH_SIZE 内。
  const keyParamsPerRow = keySets.reduce((n, ks) => n + ks.length, 0);
  const paramsPerRow = Math.max(columns.length, keyParamsPerRow);
  const chunkSize = Math.max(1, Math.floor(SAFE_BATCH_SIZE / paramsPerRow));
  const colList = columns.join(", ");

  const doImport = async () => {
    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    for (let i = 0; i < rows.length; i += chunkSize) {
      const batch = rows.slice(i, i + chunkSize);
      const placeholders = batch
        .map(() => `(${columns.map(() => "?").join(", ")})`)
        .join(", ");
      const params: unknown[] = [];
      for (const r of batch) {
        for (const c of columns) params.push(r[c] ?? null);
      }

      // 2026-09-10（E-06）：原用「插入前后各一次全表 COUNT(*)」求 delta，upsert
      // 模式下 ON CONFLICT DO UPDATE 不改行数，于是更新全被计成 skipped；
      // 且每块两次全表扫描。改为按冲突键做一次索引化存在性查询，语义与
      // INSERT OR IGNORE 逐行一致（见 countExistingKeys）。
      const existingCount = await countExistingKeys(tableName, batch, keySets);

      let sql: string;
      if (mode === "insert-or-ignore") {
        sql = `INSERT OR IGNORE INTO ${tableName} (${colList}) VALUES ${placeholders}`;
      } else {
        const conflictCols = opts.conflictColumns!;
        const updateSet = columns
          .filter((c) => !conflictCols.includes(c))
          .map((c) => `${c} = excluded.${c}`)
          .join(", ");
        sql = `INSERT INTO ${tableName} (${colList}) VALUES ${placeholders}
               ON CONFLICT(${conflictCols.join(", ")}) DO UPDATE SET ${updateSet}`;
      }

      await Zotero.DB.queryAsync(sql, params);

      if (mode === "upsert") {
        updated += existingCount;
        inserted += batch.length - existingCount;
      } else {
        // insert-or-ignore：既有键被 IGNORE 掉，不计入 inserted
        inserted += batch.length - existingCount;
        skipped += existingCount;
      }
    }

    return { inserted, updated, skipped };
  };

  if (tx) {
    return doImport();
  }
  return Zotero.DB.executeTransaction(doImport);
}

// --- clearTable ---

/**
 * Clear rows from a table. Caller is responsible for taking a snapshot first
 * (writeSnapshot) and writing audit log after — this function only does the DELETE.
 *
 * C-1: scoping is a BuiltWhere (bound parameters) produced by utils/filters —
 * raw SQL strings are no longer accepted on this path.
 *
 * @param where Optional bound WHERE fragment. Use undefined to clear the
 *   entire table.
 */
export async function clearTable(
  tableName: string,
  where?: { sql: string; params: (string | number)[] } | null,
  tx?: any,
): Promise<{ deleted: number }> {
  const whereSql = where ? `WHERE ${where.sql}` : "";
  const params = where?.params ?? [];

  const doClear = async () => {
    // Count rows before delete. SQLite changes() is unreliable across
    // Zotero's wrapped connection, so we compute the delta explicitly.
    const beforeRow = await Zotero.DB.queryAsync(
      `SELECT COUNT(*) AS c FROM ${tableName} ${whereSql}`,
      params,
    );
    const beforeCount = Number(beforeRow[0]?.c ?? 0);

    await Zotero.DB.queryAsync(`DELETE FROM ${tableName} ${whereSql}`, params);

    return { deleted: beforeCount };
  };

  if (tx) {
    return doClear();
  }
  return Zotero.DB.executeTransaction(doClear);
}
