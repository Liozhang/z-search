/**
 * OpenAlexJournalCacheSchema — DB schema for cached OpenAlex /sources lookups.
 *
 * Caches the OpenAlex journal record (topics, country, APC, OA, academic
 * indices) per normalized ISSN so the Journal "metric" mode doesn't re-hit the
 * network on every lookup. Local tables (JCR/CASS/Warning/Bealls) are still
 * queried live — only the OpenAlex supplementary data is cached, because it is
 * the sole source for those fields and changes slowly.
 *
 * Expiry is TTL-based (30 days, enforced in OpenAlexJournalCacheStore.get()).
 *
 * @module core/data/OpenAlexJournalCacheSchema
 */

import { invalidateColumnCache } from "./queryPlain";
import { safeDebug } from "../../utils/logger";

class OpenAlexJournalCacheSchema {
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await Zotero.DB.executeTransaction(async () => {
        await Zotero.DB.queryAsync(`
          CREATE TABLE IF NOT EXISTS zsearch_openalex_journal_cache (
            issn       TEXT PRIMARY KEY,
            payload    TEXT NOT NULL,
            cached_at  INTEGER NOT NULL
          )
        `);

        await Zotero.DB.queryAsync(`
          CREATE INDEX IF NOT EXISTS idx_openalex_journal_cache_at
          ON zsearch_openalex_journal_cache(cached_at)
        `);

        // Version bookkeeping: this store previously had zero version
        // tracking (schema changes would have had no migration path). DDL is
        // unconditional + idempotent; the row records the shape for future
        // migrations and tooling.
        await Zotero.DB.queryAsync(
          `CREATE TABLE IF NOT EXISTS zsearch_schema_versions (name TEXT PRIMARY KEY, version INTEGER NOT NULL)`,
        );
        await Zotero.DB.queryAsync(
          "INSERT OR REPLACE INTO zsearch_schema_versions (name, version) VALUES (?, ?)",
          ["openalexJournalCache", 1],
        );
      });

      invalidateColumnCache("zsearch_openalex_journal_cache");
      this.initialized = true;
    } catch (e) {
      safeDebug("[z-search] OpenAlexJournalCacheSchema initialize error: " + e);
    }
  }
}

export default new OpenAlexJournalCacheSchema();
