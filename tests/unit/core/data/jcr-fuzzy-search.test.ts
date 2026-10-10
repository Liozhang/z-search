/**
 * JCRStore.searchByNameFuzzy — 模糊搜索分词匹配的回归用例。
 *
 * 背景（2026-10-10 用户报告）：模糊搜索输入不完整单词（"nature bio"）结果
 * 为空。原实现把整串关键词做一个连续包含匹配（LIKE '%NATURE BIO%'），要求
 * 全部词在刊名里连续出现；改为按空白切词逐词包含（AND）后，任意词都可以
 * 只是前缀，且词序无关。
 *
 * 无真 SQLite 依赖（与 import-rows.test.ts 同思路）：FakeDB 复刻本查询会
 * 用到的 LIKE 语义（ASCII 不区分大小写、ESCAPE '\' 字面量转义 %/_/反斜杠、
 * ORDER BY jif IS NULL, jif DESC、LIMIT、onRow 行回调），SQL 本身的语义由
 * 实机探针（tests/zotero/journal-fuzzy-probe.spec.js）在真实 Zotero 里验证。
 */
import { describe, it, expect, beforeEach } from "vitest";
import JCRStore from "../../../../src/core/data/JCRStore";

type Row = Record<string, unknown>;

/** 把 SQL LIKE 模式转成 JS 正则——复刻 SQLite 默认：ASCII 不区分大小写，
 *  ESCAPE '\' 下 \% \_ \\ 按字面量、裸 % 任意串、裸 _ 单字符。 */
function likeToRegex(pattern: string): RegExp {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\" && i + 1 < pattern.length) {
      re += pattern[i + 1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      i++;
    } else if (c === "%") {
      re += "[\\s\\S]*";
    } else if (c === "_") {
      re += "[\\s\\S]";
    } else {
      re += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`, "i");
}

interface Table {
  columns: string[];
  rows: Row[];
}

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

class FakeDB {
  static tables = new Map<string, Table>();

  static reset(): void {
    this.tables.clear();
  }

  static createTable(name: string, columns: string[]): void {
    this.tables.set(name, { columns, rows: [] });
  }

  static insert(name: string, row: Row): void {
    this.tables.get(name)?.rows.push(row);
  }

  static async queryAsync(
    sql: string,
    params?: unknown[],
    options?: { onRow?: (row: unknown, cancel: () => void) => void },
  ): Promise<unknown> {
    const bound = params ?? [];
    const s = sql.trim().replace(/\s+/g, " ");

    if (/^pragma table_info\(/i.test(s)) {
      const table = s.match(/pragma table_info\((\w+)\)/i)?.[1];
      const cols = this.tables.get(table!)?.columns ?? [];
      cols.forEach((name, cid) =>
        options?.onRow?.(storageRow({ cid, name }), () => {}),
      );
      return;
    }

    if (/^select max\(/i.test(s)) {
      const table = this.tables.get(s.match(/from (\w+)/i)![1]);
      const col = s.match(/max\((\w+)\)/i)![1];
      const max = Math.max(
        ...(table?.rows.map((r) => Number(r[col])) ?? [NaN]),
      );
      options?.onRow?.(storageRow({ max_year: max }), () => {});
      return;
    }

    // searchByNameFuzzy 的形态：
    // SELECT * FROM t WHERE jcr_year = ? AND (journal_name LIKE ? ESCAPE '\' [AND ...]) ORDER BY jif IS NULL, jif DESC LIMIT ?
    const m = s.match(
      /^select \* from (\w+) where jcr_year = \? and \((.+)\) order by jif is null, jif desc limit \?$/i,
    );
    if (m) {
      const table = this.tables.get(m[1]);
      if (!table) throw new Error(`FakeDB: unknown table ${m[1]}`);
      const year = bound[0] as number;
      const likeTail = /like \? escape '\\'$/i;
      const terms = m[2].split(") AND (").join(" AND ").split(" AND ");
      const patterns: string[] = [];
      let cursor = 1;
      for (const term of terms) {
        if (!likeTail.test(term.trim())) {
          throw new Error(`FakeDB: unparsed LIKE term: ${term}`);
        }
        patterns.push(bound[cursor++] as string);
      }
      const limit = bound[cursor] as number;
      const regexes = patterns.map(likeToRegex);
      const matched = table.rows
        .filter(
          (r) =>
            r.jcr_year === year &&
            regexes.every((re) => re.test(String(r.journal_name))),
        )
        .sort((a, b) => {
          const an = a.jif == null ? 1 : 0;
          const bn = b.jif == null ? 1 : 0;
          return an - bn || Number(b.jif) - Number(a.jif);
        })
        .slice(0, limit);
      for (const row of matched) options?.onRow?.(storageRow(row), () => {});
      return;
    }

    throw new Error(`FakeDB: unsupported SQL: ${sql}`);
  }
}

const TABLE = "zsearch_impact_factors";
const COLUMNS = [
  "id",
  "jcr_year",
  "journal_name",
  "issn",
  "eissn",
  "jif",
  "jif_quartile",
];

function seed(): void {
  FakeDB.reset();
  FakeDB.createTable(TABLE, COLUMNS);
  const rows: Row[] = [
    { jcr_year: 2024, journal_name: "NATURE", issn: "0028-0836", jif: 50.5 },
    {
      jcr_year: 2024,
      journal_name: "NATURE BIOTECHNOLOGY",
      issn: "1087-0156",
      jif: 33.1,
    },
    {
      jcr_year: 2024,
      journal_name: "Nature Biomedical Engineering",
      issn: "2157-846X",
      jif: 26.8,
    },
    {
      jcr_year: 2024,
      journal_name: "NATURE REVIEWS BIOENGINEERING",
      issn: null,
      jif: null,
    },
    {
      jcr_year: 2024,
      journal_name: "APPLIED BIOCHEMISTRY AND BIOTECHNOLOGY",
      issn: null,
      jif: 3.1,
    },
    { jcr_year: 2023, journal_name: "NATURE LEGACY", issn: null, jif: 9.9 },
  ];
  rows.forEach((r, i) => FakeDB.insert(TABLE, { id: i + 1, ...r }));
}

beforeEach(() => {
  seed();
  (globalThis as any).Zotero = {
    DB: FakeDB,
    debug: () => {},
    Prefs: { get: () => false },
  };
});

async function names(kw: string): Promise<string[]> {
  const rows = await JCRStore.searchByNameFuzzy(kw, 25);
  return rows.map((r) => String(r.journal_name));
}

describe("searchByNameFuzzy — 分词包含匹配（2026-10-10 回归）", () => {
  it("不完整单词按词前缀命中（原缺陷：整串连续匹配必空）", async () => {
    expect(await names("nature bio")).toEqual([
      "NATURE BIOTECHNOLOGY",
      "Nature Biomedical Engineering",
      "NATURE REVIEWS BIOENGINEERING", // jif null 排末尾
    ]);
  });

  it("两个词都不完整也能命中", async () => {
    expect(await names("nat bio")).toEqual([
      "NATURE BIOTECHNOLOGY",
      "Nature Biomedical Engineering",
      "NATURE REVIEWS BIOENGINEERING",
    ]);
  });

  it("词序无关——AND 匹配不要求连续子串", async () => {
    expect(await names("biotech nature")).toEqual(["NATURE BIOTECHNOLOGY"]);
  });

  it("只查最新年份（2023 的行不进结果）", async () => {
    expect(await names("nature legacy")).toEqual([]);
  });

  it("LIKE 通配符按字面量转义", async () => {
    // '%' 在刊名里不存在——转义后不应被当通配符
    expect(await names("nature %bio")).toEqual([]);
    expect(await names("nature _bio")).toEqual([]);
  });

  it("空白关键词直接返回空数组，不发查询", async () => {
    expect(await names("   ")).toEqual([]);
    expect(await names("")).toEqual([]);
  });

  it("截断上限生效", async () => {
    const rows = await JCRStore.searchByNameFuzzy("bio", 2);
    expect(rows).toHaveLength(2);
  });
});
