/**
 * BeallsListStore.importRows — 三表串行导入与按表补导的回归用例。
 *
 * 背景（2026-10-11）：此前 Promise.all 三表并发导入撞上 Zotero.DB 的事务
 * 排队机制——executeTransaction 并发调用会等锁，等待超过 30 秒（db.js
 * waitTimeout 默认值）直接抛 TimeoutError。启动高峰期等锁的大表事务集体
 * 超时回滚，只剩最小的 metrics 表落库：实机数据库出现 metrics=53 而
 * journals/publishers 恒空，且「三表全零才补导」的条件把这一缺口永久固化。
 *
 * 本文件守住两条修复：
 *   1. 三表导入严格串行（事务零重叠）——任何一张表的导入失败不影响其余表，
 *      也不再把兄弟事务拖进等锁超时；
 *   2. emptyBeallsSegments 按表报告空表——启动侧据此「哪张空补哪张」，任何
 *      部分导入状态都能在下次启动自愈。
 */
import { describe, it, expect, beforeEach } from "vitest";
import BeallsListStore, {
  emptyBeallsSegments,
} from "../../../../src/core/data/BeallsListStore";

type Row = Record<string, unknown>;

interface Table {
  uniques: string[][];
  rows: Row[];
}

/**
 * 内存版 Zotero.DB：只实现 bealls 三张表导入会生成的两种语句，外加事务
 * 重叠检测（模拟 Zotero「同一时刻只允许一个事务」的约束——重叠即缺陷）。
 */
class FakeDB {
  static tables = new Map<string, Table>();
  static active = 0;
  static maxConcurrent = 0;

  static reset(): void {
    this.tables.clear();
    this.active = 0;
    this.maxConcurrent = 0;
  }

  static createTable(name: string, uniques: string[][]): void {
    this.tables.set(name, { uniques, rows: [] });
  }

  static rowsOf(name: string): Row[] {
    return this.tables.get(name)?.rows ?? [];
  }

  static async queryAsync(
    sql: string,
    params: unknown[] = [],
  ): Promise<unknown> {
    const s = sql.trim().replace(/\s+/g, " ");

    if (/^insert or ignore into /i.test(s)) {
      const m = s.match(
        /^insert or ignore into (\w+) \(([^)]+)\) values (.+)$/i,
      );
      if (!m) throw new Error(`FakeDB: unparsed INSERT: ${sql}`);
      const table = this.tables.get(m[1]);
      if (!table) throw new Error(`FakeDB: unknown table ${m[1]}`);
      const cols = m[2].split(", ");
      let cursor = 0;
      for (const tupleText of m[3].matchAll(/\(([^)]*)\)/g)) {
        const row: Row = {};
        tupleText[1].split(", ").forEach((tok, i) => {
          row[cols[i]] = tok === "?" ? (params[cursor++] ?? null) : tok;
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

    if (/^select count\(\*\) as c from (\w+)\s*$/i.test(s)) {
      const table = this.tables.get(s.match(/from (\w+)\s*$/i)![1]);
      if (!table) throw new Error(`FakeDB: unknown table ${s}`);
      return [{ c: table.rows.length }];
    }

    if (/^delete from (\w+)\s*$/i.test(s)) {
      const table = this.tables.get(s.match(/^delete from (\w+)\s*$/i)![1]);
      if (!table) throw new Error(`FakeDB: unknown table ${s}`);
      table.rows = [];
      return;
    }

    if (/^select /i.test(s)) {
      // 冲突预检：SELECT cols FROM t WHERE (k1, k2) IN ((?, ?), ...) [OR .…
      const m = s.match(/^select (.+) from (\w+) where (.+)$/i);
      if (!m) throw new Error(`FakeDB: unparsed SELECT: ${sql}`);
      const table = this.tables.get(m[2]);
      if (!table) throw new Error(`FakeDB: unknown table ${m[2]}`);
      const cols = m[1].split(", ");
      const cursor = { i: 0 };
      const tuples: unknown[][] = [];
      for (const tm of m[3].matchAll(/\(([^)]*)\)/g)) {
        tuples.push(
          tm[1]
            .split(", ")
            .map((tok) => (tok === "?" ? (params[cursor.i++] ?? null) : tok)),
        );
      }
      // 每个键集合一个 OR 项：这里简化为「行命中任意元组即算存在」——
      // bealls 三表各只有一个键集合，不会出现跨键集合误判。
      const matched = table.rows
        .filter((r) =>
          tuples.some((tuple) =>
            tuple.every((v, i) => String(r[cols[i]]) === String(v)),
          ),
        )
        .map((r) => {
          const o: Row = {};
          for (const c of cols) o[c] = r[c];
          return o;
        });
      return matched;
    }

    throw new Error(`FakeDB: unsupported SQL: ${sql}`);
  }

  static async executeTransaction(
    fn: () => Promise<unknown>,
  ): Promise<unknown> {
    // Zotero.DB 同一时刻只允许一个事务；这里把「并发进入」直接记录为缺陷信号。
    this.active++;
    this.maxConcurrent = Math.max(this.maxConcurrent, this.active);
    try {
      return await fn();
    } finally {
      this.active--;
    }
  }
}

function seg(rows: number, prefix: string): Array<Record<string, unknown>> {
  // 三个表各自取自己需要的列，多余的键在 INSERT 按列取值时被忽略
  return Array.from({ length: rows }, (_, i) => ({
    journal_name: `${prefix}_${i}`,
    journal_url: `https://example.com/${prefix}_${i}`,
    extra: null,
    publisher_name: `${prefix}_${i}`,
    publisher_url: `https://example.com/${prefix}_${i}`,
    metric_name: `${prefix}_${i}`,
    metric_url: `https://example.com/${prefix}_${i}`,
  }));
}

beforeEach(() => {
  FakeDB.reset();
  FakeDB.createTable("zsearch_bealls_journals", [["journal_name", "category"]]);
  FakeDB.createTable("zsearch_bealls_publishers", [["publisher_name"]]);
  FakeDB.createTable("zsearch_bealls_metrics", [["metric_name"]]);
  (globalThis as any).Zotero = {
    DB: FakeDB,
    debug: () => {},
    Prefs: { get: () => false },
  };
});

describe("importRows — 三表串行", () => {
  it("三段全量导入全部落库，事务零重叠", async () => {
    const result = await BeallsListStore.importRows({
      standalone: seg(40, "STD"),
      hijacked: seg(8, "HIJ"),
      publishers: seg(30, "PUB"),
      misleading: seg(5, "MET"),
    });
    expect(result).toEqual({ journals: 48, publishers: 30, metrics: 5 });
    expect(FakeDB.rowsOf("zsearch_bealls_journals")).toHaveLength(48);
    expect(FakeDB.rowsOf("zsearch_bealls_publishers")).toHaveLength(30);
    expect(FakeDB.rowsOf("zsearch_bealls_metrics")).toHaveLength(5);
    expect(FakeDB.maxConcurrent).toBe(1);
  });

  it("standalone 与 hijacked 合并进 journals 表并带 category", async () => {
    await BeallsListStore.importRows({
      standalone: [{ journal_name: "A", journal_url: "http://a", extra: "AA" }],
      hijacked: [{ journal_name: "B", journal_url: "http://b", extra: "orig" }],
    });
    const rows = FakeDB.rowsOf("zsearch_bealls_journals");
    expect(rows).toHaveLength(2);
    const categories = rows.map((r) => r.category).sort();
    expect(categories).toEqual(["hijacked", "standalone"]);
  });

  it("只传部分段：缺省段对应的表完全不写", async () => {
    const result = await BeallsListStore.importRows({
      publishers: seg(10, "PUB"),
    });
    expect(result).toEqual({ journals: 0, publishers: 10, metrics: 0 });
    expect(FakeDB.rowsOf("zsearch_bealls_journals")).toHaveLength(0);
    expect(FakeDB.rowsOf("zsearch_bealls_metrics")).toHaveLength(0);
    expect(FakeDB.maxConcurrent).toBe(1);
  });

  it("某表导入失败：其余表照常落库，最后汇总报错", async () => {
    // journals 表被删掉：它的导入抛错，publishers/metrics 仍应继续并落库
    FakeDB.tables.delete("zsearch_bealls_journals");
    await expect(
      BeallsListStore.importRows({
        standalone: seg(5, "STD"),
        publishers: seg(6, "PUB"),
        misleading: seg(7, "MET"),
      }),
    ).rejects.toThrow(/journals: /);
    expect(FakeDB.rowsOf("zsearch_bealls_publishers")).toHaveLength(6);
    expect(FakeDB.rowsOf("zsearch_bealls_metrics")).toHaveLength(7);
  });
});

describe("clearAll — 单事务原子清除", () => {
  it("三表一次清空，事务零重叠（与 importRows 同一并发约束）", async () => {
    await BeallsListStore.importRows({
      standalone: seg(12, "STD"),
      publishers: seg(9, "PUB"),
      misleading: seg(4, "MET"),
    });
    FakeDB.maxConcurrent = 0;
    const result = await BeallsListStore.clearAll();
    expect(result).toEqual({ journals: 12, publishers: 9, metrics: 4 });
    expect(FakeDB.rowsOf("zsearch_bealls_journals")).toHaveLength(0);
    expect(FakeDB.rowsOf("zsearch_bealls_publishers")).toHaveLength(0);
    expect(FakeDB.rowsOf("zsearch_bealls_metrics")).toHaveLength(0);
    expect(FakeDB.maxConcurrent).toBe(1);
  });
});

describe("emptyBeallsSegments — 按表补导计划", () => {
  it("三表全零 → 三段全补", () => {
    expect(
      emptyBeallsSegments({ journals: 0, publishers: 0, metrics: 0 }),
    ).toEqual(["journals", "publishers", "metrics"]);
  });

  it("实机事故状态（metrics=53 其余为零）→ 只补 journals 与 publishers", () => {
    expect(
      emptyBeallsSegments({ journals: 0, publishers: 0, metrics: 53 }),
    ).toEqual(["journals", "publishers"]);
  });

  it("数据齐全 → 无需补导", () => {
    expect(
      emptyBeallsSegments({ journals: 1425, publishers: 1163, metrics: 53 }),
    ).toEqual([]);
  });
});
