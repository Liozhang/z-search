/**
 * WarningListSchema — Database schema for international journal warning list data.
 *
 * Creates one table: zsearch_journal_warnings.
 * Stores warning records by year (2020-2025), with both Chinese and English
 * level/reason fields (translated at import time).
 */

import { createSchema } from "./schemaBase";
import { tableExists } from "./utils/schema";

const SCHEMA_VERSION = 1;
const PREF_KEY = "warningList.schemaVersion";

export default createSchema({
  version: SCHEMA_VERSION,
  prefKey: PREF_KEY,
  selfHeal: async () => !(await tableExists("zsearch_journal_warnings")),
  up: (from, _to) => {
    const steps: (() => Promise<unknown>)[] = [];
    if (from < 1) {
      steps.push(
        () =>
          Zotero.DB.queryAsync(`
          CREATE TABLE IF NOT EXISTS zsearch_journal_warnings (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            journal_name      TEXT NOT NULL,
            warning_year      INTEGER NOT NULL,
            warning_level     TEXT,
            warning_level_en  TEXT,
            warning_reason    TEXT,
            warning_reason_en TEXT,
            UNIQUE(journal_name, warning_year)
          )
        `),
        () =>
          Zotero.DB.queryAsync(`
          CREATE INDEX IF NOT EXISTS idx_journal_warnings_name
          ON zsearch_journal_warnings(journal_name)
        `),
        () =>
          Zotero.DB.queryAsync(`
          CREATE INDEX IF NOT EXISTS idx_journal_warnings_year
          ON zsearch_journal_warnings(warning_year)
        `),
      );
    }
    return steps;
  },
});
