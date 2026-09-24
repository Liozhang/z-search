/**
 * CASSSchema — Database schema initialization for CAS (Chinese Academy of Sciences) journal quartile data.
 *
 * Creates one table: zsearch_cass_quartiles.
 * Stores major category quartile (1-4) with rank/total, Top flag, and up to 6 minor categories as JSON.
 */

import { createSchema } from "./schemaBase";
import { tableExists } from "./utils/schema";

const SCHEMA_VERSION = 2;
const PREF_KEY = "cass.schemaVersion";

export default createSchema({
  version: SCHEMA_VERSION,
  prefKey: PREF_KEY,
  selfHeal: async () => !(await tableExists("zsearch_cass_quartiles")),
  up: (from, _to) => {
    const steps: (() => Promise<unknown>)[] = [];
    if (from < 1) {
      steps.push(
        () =>
          Zotero.DB.queryAsync(`
          CREATE TABLE IF NOT EXISTS zsearch_cass_quartiles (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            cass_year         INTEGER NOT NULL,
            journal_name      TEXT NOT NULL,
            issn              TEXT,
            eissn             TEXT,
            is_review         INTEGER DEFAULT 0,
            is_oa             INTEGER DEFAULT 0,
            wos_category      TEXT,
            major_category    TEXT NOT NULL,
            major_category_en TEXT,
            major_quartile    INTEGER NOT NULL,
            major_rank        INTEGER,
            major_total       INTEGER,
            is_top            INTEGER DEFAULT 0,
            minor_categories  TEXT,
            UNIQUE(cass_year, journal_name)
          )
        `),
        () =>
          Zotero.DB.queryAsync(`
          CREATE INDEX IF NOT EXISTS idx_cass_quartiles_issn
          ON zsearch_cass_quartiles(issn)
        `),
        () =>
          Zotero.DB.queryAsync(`
          CREATE INDEX IF NOT EXISTS idx_cass_quartiles_eissn
          ON zsearch_cass_quartiles(eissn)
        `),
        () =>
          Zotero.DB.queryAsync(`
          CREATE INDEX IF NOT EXISTS idx_cass_quartiles_name
          ON zsearch_cass_quartiles(journal_name)
        `),
        () =>
          Zotero.DB.queryAsync(`
          CREATE INDEX IF NOT EXISTS idx_cass_quartiles_year
          ON zsearch_cass_quartiles(cass_year)
        `),
      );
    }
    if (from < 2) {
      steps.push(() =>
        Zotero.DB.queryAsync(`
          CREATE UNIQUE INDEX IF NOT EXISTS idx_cass_quartiles_year_issn
          ON zsearch_cass_quartiles(cass_year, issn)
          WHERE issn IS NOT NULL
        `),
      );
    }
    return steps;
  },
});
