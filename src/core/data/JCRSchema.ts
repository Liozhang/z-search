/**
 * JCRSchema — Database schema initialization for JCR Impact Factor data.
 *
 * Creates one table: zsearch_impact_factors.
 * Supports multi-year data via UNIQUE(jcr_year, issn/journal_name).
 */

import { createSchema } from "./schemaBase";
import { tableExists } from "./utils/schema";

const SCHEMA_VERSION = 1;
const PREF_KEY = "jcr.schemaVersion";

export default createSchema({
  version: SCHEMA_VERSION,
  prefKey: PREF_KEY,
  // Self-heal: if pref claims migrated but table is missing, force re-creation.
  // This protects against DB reset / manual DROP / profile pref/DB desync.
  selfHeal: async () => !(await tableExists("zsearch_impact_factors")),
  up: (from, _to) => {
    const steps: (() => Promise<unknown>)[] = [];
    if (from < 1) {
      steps.push(
        () =>
          Zotero.DB.queryAsync(`
          CREATE TABLE IF NOT EXISTS zsearch_impact_factors (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            jcr_year            INTEGER NOT NULL,
            journal_name        TEXT NOT NULL,
            abbreviated_name    TEXT,
            publisher           TEXT,
            issn                TEXT,
            eissn               TEXT,
            total_cites         INTEGER,
            total_articles      INTEGER,
            citable_items       INTEGER,
            cited_half_life     REAL,
            citing_half_life    REAL,
            jif                 REAL,
            five_year_jif       REAL,
            jif_without_self    REAL,
            jci                 REAL,
            jif_quartile        TEXT,
            jif_rank            INTEGER,
            UNIQUE(jcr_year, issn),
            UNIQUE(jcr_year, journal_name)
          )
        `),
        () =>
          Zotero.DB.queryAsync(`
          CREATE INDEX IF NOT EXISTS idx_impact_factors_issn
          ON zsearch_impact_factors(issn)
        `),
        () =>
          Zotero.DB.queryAsync(`
          CREATE INDEX IF NOT EXISTS idx_impact_factors_eissn
          ON zsearch_impact_factors(eissn)
        `),
        () =>
          Zotero.DB.queryAsync(`
          CREATE INDEX IF NOT EXISTS idx_impact_factors_name
          ON zsearch_impact_factors(journal_name)
        `),
        () =>
          Zotero.DB.queryAsync(`
          CREATE INDEX IF NOT EXISTS idx_impact_factors_year
          ON zsearch_impact_factors(jcr_year)
        `),
      );
    }
    return steps;
  },
});
