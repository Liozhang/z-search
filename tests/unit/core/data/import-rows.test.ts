/**
 * import-rows — 冲突预检的 E-07 回归用例。
 *
 * 背景（2026-09-23）：JCR/CASS/warning/bealls 四个自带数据集的启动导入全部失败，
 * 报 "NULL cannot be used for parenthesized placeholders in SELECT queries"，
 * 每个 0 行落库、每次重启重试再失败。原因在 crud.ts importRows 的存在性预检：
 * 冲突键取 `opts.conflictColumns ?? columns`，没传就退化成"全部列"——JCR 17 列里
 * 15 列可空，NULL 被绑进 SELECT 的括号占位符，Zotero 的 db.js
 * parseQueryAndParams 直接抛错回滚整个事务。
 *
 * 本文件用 FakeDB 复刻 db.js 的两条相关行为，守住修复：
 *   1. NULL 绑到 SELECT 的括号占位符 → 抛错（`col = ?` 不在其列，那是被改写成
 *      `IS NULL`；非 SELECT 语句则被硬写成 NULL 字面量，都不抛）；
 *   2. INSERT OR IGNORE 按**全部** UNIQUE 键集合判冲突——这正是预检要复刻的语义，
 *      漏查任何一个键集合，inserted/skipped 就会失真。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { importRows, dryRunImport } from "../../../../src/core/data/utils/crud";
import { SAFE_BATCH_SIZE } from "../../../../src/utils/constants";

type Row = Record<string, unknown>;

interface Table {
  columns: string[];
  uniques: string[][];
  rows: Row[];
}

/** 把一条行记录包装成 mozIStorageRow 的样子（queryPlain 的 onRow 路径要用）。 */
function storageRow(row: Row) {
  const values = Object.values(row);
  return {
    getResultByIndex: (i: number) => values[i],
    getResultByName: (name: string) => {
      if (!(name in row)) throw new Error(`DB column '${name}' not found`);
      return row[name];
    },
  };
}

function literal(token: string): unknown {
  if (token === "NULL") return null;
  if (/^'.*'$/.test(token)) return token.slice(1, -1);
  const n = Number(token);
  return Number.isNaN(n) ? token : n;
}

/** 从 "(?, ?), (?, ?)" 里切出各元组并绑定参数（按出现顺序）。 */
function bindTuples(
  text: string,
  params: unknown[],
  cursor = { i: 0 },
): unknown[][] {
  const out: unknown[][] = [];
  for (const m of text.matchAll(/\(([^)]*)\)/g)) {
    out.push(
      m[1]
        .split(", ")
        .map((tok) =>
          tok === "?" ? (params[cursor.i++] ?? null) : literal(tok),
        ),
    );
  }
  return out;
}

function norm(sql: string): string {
  return sql.trim().replace(/\s+/g, " ");
}

/**
 * 内存版 Zotero.DB：只实现本模块会生成的两种语句，外加 PRAGMA table_info
 * （queryPlain 解析 SELECT * 的列名用）。
 */
class FakeDB {
  static tables = new Map<string, Table>();
  static selectCalls: Array<{ sql: string; params: unknown[] }> = [];

  static reset(): void {
    this.tables.clear();
    this.selectCalls = [];
  }

  static createTable(name: string, uniques: string[][]): void {
    this.tables.set(name, {
      columns: [...new Set(uniques.flat())],
      uniques,
      rows: [],
    });
  }

  static rowsOf(name: string): Row[] {
    return this.tables.get(name)?.rows ?? [];
  }

  /** db.js parseQueryAndParams 的 NULL 规则（zotero/zotero db.js:230-242）。 */
  private static guardNullParams(sql: string, params: unknown[]): void {
    if (params.length === 0) return;
    // 非 SELECT：db.js 会把 `?` 硬替换成 NULL 字面量，不抛
    if (!/^select/i.test(sql.trim())) return;
    const placeholders = [...sql.matchAll(/\s*[=,(]\s*\?/g)];
    for (let i = 0; i < params.length; i++) {
      if (params[i] === undefined) {
        throw new Error(`Parameter ${i} is undefined [QUERY: ${sql}]`);
      }
      if (params[i] !== null) continue;
      const m = placeholders[i];
      if (!m) {
        throw new Error(
          "Null parameter provided for a query without placeholders",
        );
      }
      // 占位符紧跟 `=` 的会被改写成 IS NULL（安全）；括号里的直接拒绝
      if (!m[0].includes("=")) {
        throw new Error(
          "NULL cannot be used for parenthesized placeholders in SELECT queries" +
            ` [QUERY: ${sql}]`,
        );
      }
    }
  }

  static async queryAsync(
    sql: string,
    params?: unknown[],
    options?: { onRow?: (row: unknown, cancel: () => void) => void },
  ): Promise<unknown> {
    const bound = params ?? [];
    this.guardNullParams(sql, bound);
    const s = norm(sql);

    if (/^pragma table_info\(/i.test(s)) {
      const table = s.match(/pragma table_info\((\w+)\)/i)?.[1];
      const cols = this.tables.get(table!)?.columns ?? [];
      const rows = cols.map((name, i) => ({ ...storageRow({ cid: i, name }) }));
      for (const r of rows) options?.onRow?.(r, () => {});
      return;
    }

    if (/^insert or ignore into /i.test(s)) {
      const m = s.match(
        /^insert or ignore into (\w+) \(([^)]+)\) values (.+)$/i,
      );
      if (!m) throw new Error(`FakeDB: unparsed INSERT: ${sql}`);
      const table = this.tables.get(m[1]);
      if (!table) throw new Error(`FakeDB: unknown table ${m[1]}`);
      const cols = m[2].split(", ");
      for (const tuple of bindTuples(m[3], bound)) {
        const row: Row = {};
        cols.forEach((c, i) => {
          row[c] = tuple[i] ?? null;
        });
        // INSERT OR IGNORE：任一 UNIQUE 键集合全部命中既有行就跳过该行
        const conflict = table.uniques.some(
          (ks) =>
            ks.every((c) => row[c] !== null && row[c] !== undefined) &&
            table.rows.some((r) =>
              ks.every((c) => String(r[c]) === String(row[c])),
            ),
        );
        if (!conflict) table.rows.push(row);
      }
      return;
    }

    if (/^select /i.test(s)) {
      this.selectCalls.push({ sql, params: bound });
      const m = s.match(/^select (.+) from (\w+) where (.+)$/i);
      if (!m) throw new Error(`FakeDB: unparsed SELECT: ${sql}`);
      const table = this.tables.get(m[2]);
      if (!table) throw new Error(`FakeDB: unknown table ${m[2]}`);
      const cols = m[1].split(", ");
      const cursor = { i: 0 };
      const terms = m[3].split(" or ").map((t) => {
        // `col = ?`：db.js 会把 NULL 改写成 IS NULL，所以这里必须真的判等
        const simple = t.match(/^(\w+) = \?$/i);
        if (simple) {
          const value = bound[cursor.i++];
          const col = simple[1];
          return (r: Row) => String(r[col]) === String(value);
        }
        const tm = t.match(/^\(([^)]+)\) in \((.+)\)$/i);
        if (!tm) throw new Error(`FakeDB: unparsed term: ${t}`);
        const ks = tm[1].split(", ");
        const tuples = bindTuples(tm[2], bound, cursor);
        return (r: Row) =>
          tuples.some((tuple) =>
            ks.every((c, i) => String(r[c]) === String(tuple[i])),
          );
      });
      const matched = table.rows
        .filter((r) => terms.some((matches) => matches(r)))
        .map((r) => {
          const o: Row = {};
          for (const c of cols) o[c] = r[c];
          return o;
        });
      if (options?.onRow) {
        for (const row of matched) options.onRow(storageRow(row), () => {});
        return;
      }
      return matched;
    }

    throw new Error(`FakeDB: unsupported SQL: ${sql}`);
  }

  static async executeTransaction(
    fn: () => Promise<unknown>,
  ): Promise<unknown> {
    return fn();
  }
}

// ── zsearch_impact_factors：17 列、两条 UNIQUE（见 JCRSchema） ──────────────

const TABLE = "zsearch_impact_factors";
const COLUMNS = [
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
];
const KEYS = [
  ["jcr_year", "journal_name"],
  ["jcr_year", "issn"],
];

function jcrRow(overrides: Row = {}): Row {
  return {
    jcr_year: 2024,
    journal_name: "NATURE",
    abbreviated_name: "NAT",
    publisher: "NPG",
    issn: "0028-0836",
    eissn: "1476-4687",
    total_cites: 100,
    total_articles: 10,
    citable_items: 8,
    cited_half_life: 5,
    citing_half_life: 6,
    jif: 50.5,
    five_year_jif: 55.5,
    jif_without_self: 49.5,
    jci: 1.2,
    jif_quartile: "Q1",
    jif_rank: 1,
    ...overrides,
  };
}

function noNullInSelects(): boolean {
  return FakeDB.selectCalls.every((c) => !c.params.some((p) => p === null));
}

beforeEach(() => {
  FakeDB.reset();
  FakeDB.createTable(TABLE, KEYS);
  (globalThis as any).Zotero = {
    DB: FakeDB,
    debug: () => {},
    Prefs: { get: () => false },
  };
});

describe("importRows — 冲突预检", () => {
  it("可空列为 NULL 的行能正常入库（E-07 回归）", async () => {
    const rows = [
      jcrRow({ journal_name: "A", issn: "0001", cited_half_life: null }),
      jcrRow({ journal_name: "B", issn: "0002", jif: null, jci: null }),
      jcrRow({
        journal_name: "C",
        issn: "0003",
        eissn: null,
        publisher: null,
      }),
    ];
    const result = await importRows({
      tableName: TABLE,
      columns: COLUMNS,
      rows,
      mode: "insert-or-ignore",
      conflictKeys: KEYS,
    });
    expect(result).toEqual({ inserted: 3, updated: 0, skipped: 0 });
    expect(FakeDB.rowsOf(TABLE)).toHaveLength(3);
    expect(noNullInSelects()).toBe(true);
  });

  it("两条 UNIQUE 任一命中的行都计成 skipped", async () => {
    await importRows({
      tableName: TABLE,
      columns: COLUMNS,
      rows: [jcrRow()],
      mode: "insert-or-ignore",
      conflictKeys: KEYS,
    });
    const result = await importRows({
      tableName: TABLE,
      columns: COLUMNS,
      rows: [
        jcrRow(), // 完全相同
        jcrRow({ jif: 1, jci: 1 }), // 键 (jcr_year, journal_name) 相同、内容不同
        jcrRow({ journal_name: "OTHER" }), // 键 (jcr_year, issn) 相同
        jcrRow({ journal_name: "NEW", issn: "9999" }), // 全新行
      ],
      mode: "insert-or-ignore",
      conflictKeys: KEYS,
    });
    expect(result).toEqual({ inserted: 1, updated: 0, skipped: 3 });
    expect(FakeDB.rowsOf(TABLE)).toHaveLength(2);
  });

  it("同一批次内的重复键：第一行插入、后续计 skipped", async () => {
    const result = await importRows({
      tableName: TABLE,
      columns: COLUMNS,
      rows: [jcrRow(), jcrRow(), jcrRow()],
      mode: "insert-or-ignore",
      conflictKeys: KEYS,
    });
    expect(result).toEqual({ inserted: 1, updated: 0, skipped: 2 });
    expect(FakeDB.rowsOf(TABLE)).toHaveLength(1);
  });

  it("跨分块导入：后块里的 NULL 不再炸事务", async () => {
    // chunkSize = floor(SAFE_BATCH_SIZE / 17) = 52；第二批（含 NULL）必被触发
    const chunkSize = Math.max(1, Math.floor(SAFE_BATCH_SIZE / COLUMNS.length));
    const rows: Row[] = [];
    for (let i = 0; i < chunkSize + 8; i++) {
      rows.push(
        jcrRow({
          journal_name: `JOURNAL_${i}`,
          issn: `ISSN_${i}`,
          // 每列可空字段轮着来，保证第二块里有 NULL
          cited_half_life: i % 2 ? null : 1,
          jci: i % 3 ? null : 2,
          five_year_jif: i % 5 ? null : 3,
        }),
      );
    }
    const result = await importRows({
      tableName: TABLE,
      columns: COLUMNS,
      rows,
      mode: "insert-or-ignore",
      conflictKeys: KEYS,
    });
    expect(result).toEqual({
      inserted: rows.length,
      updated: 0,
      skipped: 0,
    });
    expect(FakeDB.rowsOf(TABLE)).toHaveLength(rows.length);
    expect(noNullInSelects()).toBe(true);
  });

  it("不传冲突键时报错，而不是退化成全部列", async () => {
    await expect(
      importRows({
        tableName: TABLE,
        columns: COLUMNS,
        rows: [jcrRow()],
        mode: "insert-or-ignore",
      }),
    ).rejects.toThrow(/conflictKeys/);
  });
});

describe("dryRunImport — NULL 键值", () => {
  it("键值为 NULL 的行归入 insert，且不把 NULL 绑进 SELECT", async () => {
    const report = await dryRunImport({
      tableName: TABLE,
      keyColumns: ["jcr_year", "journal_name"],
      rows: [
        { jcr_year: 2024, journal_name: null },
        { jcr_year: 2024, journal_name: "NATURE" },
      ],
    });
    expect(report.insertCount).toBe(2);
    expect(report.updateCount).toBe(0);
    expect(report.noopCount).toBe(0);
    expect(noNullInSelects()).toBe(true);
  });
});

// ── FakeDB 的 NULL 守卫必须与 db.js 逐字一致，否则上面的回归全是空转 ──────────

describe("FakeDB 复刻的 NULL 规则", () => {
  it("17 列 row-value IN 里出现 NULL → 抛 db.js 同款错误", async () => {
    const tuple = `(${COLUMNS.map(() => "?").join(", ")})`;
    const sql =
      `SELECT 1 FROM ${TABLE} WHERE (${COLUMNS.join(", ")}) ` +
      `IN (${Array.from({ length: 16 }, () => tuple).join(", ")})`;
    const params: unknown[] = [];
    for (let i = 0; i < 16; i++) {
      for (const c of COLUMNS) {
        params.push(i === 11 && c === "jif" ? null : 1);
      }
    }
    await expect(FakeDB.queryAsync(sql, params)).rejects.toThrow(
      /NULL cannot be used for parenthesized placeholders/,
    );
  });

  it("同样的 NULL 放在 `col = ?` 后面不抛（db.js 改写为 IS NULL）", async () => {
    await expect(
      FakeDB.queryAsync(`SELECT 1 FROM ${TABLE} WHERE jif = ?`, [null]),
    ).resolves.toEqual([]);
  });
});
