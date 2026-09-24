/**
 * BeallsListSchema — Database schema for Beall's List predatory journal data.
 *
 * Creates three tables:
 *   - zsearch_bealls_journals: standalone predatory journals + hijacked journals
 *   - zsearch_bealls_publishers: predatory publishers
 *   - zsearch_bealls_metrics: misleading metrics organizations
 */

import { createSchema } from "./schemaBase";
import { tableExists } from "./utils/schema";

const SCHEMA_VERSION = 2;
const PREF_KEY = "beallsList.schemaVersion";

export default createSchema({
  version: SCHEMA_VERSION,
  prefKey: PREF_KEY,
  selfHeal: async (v) => {
    if (v < 1) return false;
    const journalsOk = await tableExists("zsearch_bealls_journals");
    const publishersOk = await tableExists("zsearch_bealls_publishers");
    const metricsOk = v < 2 || (await tableExists("zsearch_bealls_metrics"));
    return !(journalsOk && publishersOk && metricsOk);
  },
  up: (from, _to) => {
    const steps: (() => Promise<unknown>)[] = [];
    if (from < 1) {
      steps.push(
        () =>
          Zotero.DB.queryAsync(`
          CREATE TABLE IF NOT EXISTS zsearch_bealls_journals (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            journal_name      TEXT,
            journal_url       TEXT,
            category          TEXT NOT NULL DEFAULT 'standalone',
            extra             TEXT,
            UNIQUE(journal_name, category)
          )
        `),
        () =>
          Zotero.DB.queryAsync(`
          CREATE INDEX IF NOT EXISTS idx_bealls_journals_name
          ON zsearch_bealls_journals(journal_name)
        `),
        () =>
          Zotero.DB.queryAsync(`
          CREATE INDEX IF NOT EXISTS idx_bealls_journals_category
          ON zsearch_bealls_journals(category)
        `),
        () =>
          Zotero.DB.queryAsync(`
          CREATE TABLE IF NOT EXISTS zsearch_bealls_publishers (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            publisher_name    TEXT,
            publisher_url     TEXT,
            UNIQUE(publisher_name)
          )
        `),
        () =>
          Zotero.DB.queryAsync(`
          CREATE INDEX IF NOT EXISTS idx_bealls_publishers_name
          ON zsearch_bealls_publishers(publisher_name)
        `),
      );
    }
    if (from < 2) {
      steps.push(
        () =>
          Zotero.DB.queryAsync(`
          CREATE TABLE IF NOT EXISTS zsearch_bealls_metrics (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            metric_name       TEXT,
            metric_url        TEXT,
            UNIQUE(metric_name)
          )
        `),
        () =>
          Zotero.DB.queryAsync(`
          CREATE INDEX IF NOT EXISTS idx_bealls_metrics_name
          ON zsearch_bealls_metrics(metric_name)
        `),
      );
    }
    return steps;
  },
});
