/**
 * OpenAlexJournalCacheStore — read/write the zsearch_openalex_journal_cache table.
 *
 * Stores the full OpenAlex journal record as JSON keyed by normalized ISSN.
 * get() enforces the TTL (30 days): returns null when the row is missing or
 * stale, so callers fall back to a live OpenAlex request and upsert() the
 * fresh result.
 *
 * @module core/data/OpenAlexJournalCacheStore
 */

import { queryPlain } from "./queryPlain";
import { normalizeISSN } from "./utils/normalize";
import type { OpenAlexJournal } from "../sources/academic-search";
import { safeDebug } from "../../utils/logger";

/** Cache entries older than this are treated as missing (re-fetched). */
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface CacheRow {
  issn: string;
  payload: string;
  cached_at: number;
}

class OpenAlexJournalCacheStore {
  private initialized = false;

  async initialize(): Promise<void> {
    // Schema is created by OpenAlexJournalCacheSchema; this is a no-op marker
    // for the servicesInit registration pattern.
    this.initialized = true;
  }

  /**
   * Return a non-stale cached OpenAlex record for the given ISSN, or null.
   * Stale (older than 30 days) or missing rows both return null so callers
   * uniformly fall back to a live request. Stale rows are deleted best-effort
   * on read（审计 P2-1：陈旧行此前永不清理，表无限增长）.
   */
  async get(issn: string): Promise<OpenAlexJournal | null> {
    if (!issn) return null;
    const key = normalizeISSN(issn);
    if (!key) return null;
    try {
      const rows = await queryPlain(
        `SELECT issn, payload, cached_at FROM zsearch_openalex_journal_cache WHERE issn = ?`,
        [key],
      );
      const row = rows[0] as CacheRow | undefined;
      if (!row) return null;
      if (Date.now() - row.cached_at > CACHE_TTL_MS) {
        void Zotero.DB.queryAsync(
          `DELETE FROM zsearch_openalex_journal_cache WHERE issn = ?`,
          [key],
        ).catch(() => {
          /* 清理失败无碍——下次读取仍判陈旧 */
        });
        return null;
      }
      return JSON.parse(row.payload) as OpenAlexJournal;
    } catch (e) {
      safeDebug("[z-search] OpenAlexJournalCacheStore.get error: " + e);
      return null;
    }
  }

  /**
   * Store (or replace) the OpenAlex record for its ISSN. Best-effort: write
   * failures are logged but do not propagate, since a cache miss just means a
   * later live fetch.
   */
  async upsert(record: OpenAlexJournal): Promise<void> {
    const issn = record.issn || record.issnL;
    if (!issn) return; // nothing to key on
    const key = normalizeISSN(issn);
    if (!key) return;
    try {
      await Zotero.DB.queryAsync(
        `INSERT INTO zsearch_openalex_journal_cache (issn, payload, cached_at) VALUES (?, ?, ?)
         ON CONFLICT(issn) DO UPDATE SET payload = excluded.payload, cached_at = excluded.cached_at`,
        [key, JSON.stringify(record), Date.now()],
      );
    } catch (e) {
      safeDebug("[z-search] OpenAlexJournalCacheStore.upsert error: " + e);
    }
  }
}

export default new OpenAlexJournalCacheStore();
