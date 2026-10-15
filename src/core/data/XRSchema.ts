/**
 * XRSchema — Database schema initialization for XinRui (新锐) journal quartile
 * data.
 *
 * Creates one table: zsearch_xr_quartiles. 中科院文献情报中心自 2026 年起停止
 * 发布期刊分区表（2025 版为官方终版），原分区表团队以「新锐学术」名义接续
 * 发布《新锐期刊分区表》：大类分区（含跨学科第二大类）、Top 期刊，以及取代
 * 独立预警名单的 Under Review 标记。表结构对齐 zsearch_cass_quartiles，去掉
 * 新锐数据不含的 rank/total 与 OA 列，加上第二大类与中文刊名列。
 */

import { createSchema } from "./schemaBase";
import { tableExists } from "./utils/schema";

const SCHEMA_VERSION = 1;
const PREF_KEY = "xr.schemaVersion";

export default createSchema({
  version: SCHEMA_VERSION,
  prefKey: PREF_KEY,
  selfHeal: async () => !(await tableExists("zsearch_xr_quartiles")),
  up: (from, _to) => {
    const steps: (() => Promise<unknown>)[] = [];
    if (from < 1) {
      steps.push(
        () =>
          Zotero.DB.queryAsync(`
          CREATE TABLE IF NOT EXISTS zsearch_xr_quartiles (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            xr_year           INTEGER NOT NULL,
            journal_name      TEXT NOT NULL,
            chinese_name      TEXT,
            issn              TEXT,
            eissn             TEXT,
            cn                TEXT,
            wos_database      TEXT,
            is_under_review   INTEGER DEFAULT 0,
            major_category    TEXT NOT NULL,
            major_category_en TEXT,
            major_quartile    INTEGER,
            is_top            INTEGER DEFAULT 0,
            major2_category    TEXT,
            major2_category_en TEXT,
            major2_quartile    INTEGER,
            minor_categories  TEXT,
            UNIQUE(xr_year, journal_name)
          )
        `),
        () =>
          Zotero.DB.queryAsync(`
          CREATE INDEX IF NOT EXISTS idx_xr_quartiles_issn
          ON zsearch_xr_quartiles(issn)
        `),
        () =>
          Zotero.DB.queryAsync(`
          CREATE INDEX IF NOT EXISTS idx_xr_quartiles_eissn
          ON zsearch_xr_quartiles(eissn)
        `),
        () =>
          Zotero.DB.queryAsync(`
          CREATE INDEX IF NOT EXISTS idx_xr_quartiles_name
          ON zsearch_xr_quartiles(journal_name)
        `),
        () =>
          Zotero.DB.queryAsync(`
          CREATE INDEX IF NOT EXISTS idx_xr_quartiles_year
          ON zsearch_xr_quartiles(xr_year)
        `),
        () =>
          Zotero.DB.queryAsync(`
          CREATE UNIQUE INDEX IF NOT EXISTS idx_xr_quartiles_year_issn
          ON zsearch_xr_quartiles(xr_year, issn)
          WHERE issn IS NOT NULL
        `),
      );
    }
    return steps;
  },
});
