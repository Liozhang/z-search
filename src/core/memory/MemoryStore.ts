import type { MemoryEntry, MemoryQuery, MemoryStats } from "../../types/memory";
import VersionedStore from "../utils/VersionedStore";
import { SQLITE_MAX_VARIABLES } from "../../utils/constants";
import { safeDebug } from "../../utils/logger";

/**
 * Persistent memory storage using Zotero.DB.
 * Two tables: zsearch_memory (main) and zsearch_souls (for custom souls).
 */
class MemoryStore extends VersionedStore {
  private static readonly SCHEMA_VERSION = 3;
  private static readonly SCHEMA_NAME = "memory";

  protected SCHEMA_VERSION = MemoryStore.SCHEMA_VERSION;
  protected SCHEMA_NAME = MemoryStore.SCHEMA_NAME;
  protected SCHEMA_TABLES = ["zsearch_memory", "zsearch_souls"] as const;

  async initialize(): Promise<void> {
    await this.ensureSchema();
  }

  protected createSchema(): Promise<void> {
    const tasks: Promise<any>[] = [
      Zotero.DB.queryAsync(`
        CREATE TABLE IF NOT EXISTS zsearch_memory (
          id TEXT PRIMARY KEY,
          soul_id TEXT NOT NULL,
          tier TEXT NOT NULL,
          key TEXT,
          content TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `),
      // Index for fast soul+tier queries
      Zotero.DB.queryAsync(`
        CREATE INDEX IF NOT EXISTS idx_zsearch_memory_soul_tier
        ON zsearch_memory (soul_id, tier)
      `),
      // Index for key-based lookups (getByKey, addSummary dedup)
      Zotero.DB.queryAsync(`
        CREATE INDEX IF NOT EXISTS idx_zsearch_memory_key
        ON zsearch_memory (key)
      `),
      Zotero.DB.queryAsync(`
        CREATE TABLE IF NOT EXISTS zsearch_souls (
          soul_id TEXT PRIMARY KEY,
          data TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          deleted INTEGER NOT NULL DEFAULT 0
        )
      `),
    ];
    return Promise.all(tasks).then((): void => undefined);
  }

  protected async migrate(fromVersion: number): Promise<void> {
    // Schema v2: add expires_at column
    if (fromVersion < 2) {
      const cols = (await Zotero.DB.queryAsync(
        "PRAGMA table_info(zsearch_memory)",
      )) as Array<any>;
      const hasExpiresAt = cols.some((c: any) => c.name === "expires_at");
      if (!hasExpiresAt) {
        await Zotero.DB.queryAsync(
          "ALTER TABLE zsearch_memory ADD COLUMN expires_at INTEGER",
        );
      }
    }

    // Schema v3: add category column
    if (fromVersion < 3) {
      const cols = (await Zotero.DB.queryAsync(
        "PRAGMA table_info(zsearch_memory)",
      )) as Array<any>;
      const hasCategory = cols.some((c: any) => c.name === "category");
      if (!hasCategory) {
        await Zotero.DB.queryAsync(
          "ALTER TABLE zsearch_memory ADD COLUMN category TEXT",
        );
      }
    }
  }

  // --- CRUD Operations ---

  async create(entry: Omit<MemoryEntry, "updatedAt">): Promise<void> {
    const now = Date.now();
    await Zotero.DB.executeTransaction(async () => {
      await Zotero.DB.queryAsync(
        `INSERT OR REPLACE INTO zsearch_memory
          (id, soul_id, tier, key, content, timestamp, updated_at, category)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entry.id,
          entry.soulId,
          entry.tier,
          entry.key ?? null,
          entry.content,
          entry.timestamp ?? now,
          now,
          entry.category ?? null,
        ],
      );
    });
  }

  async get(id: string): Promise<MemoryEntry | undefined> {
    const rows = (await Zotero.DB.queryAsync(
      "SELECT * FROM zsearch_memory WHERE id = ?",
      [id],
    )) as Array<any>;

    if (!rows || rows.length === 0) return undefined;
    return this.rowToEntry(rows[0]);
  }

  async update(id: string, updates: Partial<MemoryEntry>): Promise<void> {
    await Zotero.DB.executeTransaction(async () => {
      const existing = await this.get(id);
      if (!existing) {
        // C-D: previously silent no-op (caller couldn't detect stale update).
        // Log so concurrent-create races / purged-row bugs surface in debug output.
        // Full upsert would require soulId/tier fields which update() doesn't take —
        // leave that as a larger API refactor.
        safeDebug(
          `[z-search] MemoryStore.update: id "${id}" not found, update silently skipped`,
        );
        return;
      }

      const content = updates.content ?? existing.content;
      const key = updates.key !== undefined ? updates.key : existing.key;
      const expiresAt =
        updates.expiresAt !== undefined
          ? updates.expiresAt
          : existing.expiresAt;
      const category =
        updates.category !== undefined ? updates.category : existing.category;
      const now = Date.now();

      await Zotero.DB.queryAsync(
        `UPDATE zsearch_memory SET content = ?, key = ?, expires_at = ?, category = ?, updated_at = ? WHERE id = ?`,
        [content, key, expiresAt ?? null, category ?? null, now, id],
      );
    });
  }

  async delete(id: string): Promise<void> {
    await Zotero.DB.executeTransaction(async () => {
      await Zotero.DB.queryAsync("DELETE FROM zsearch_memory WHERE id = ?", [
        id,
      ]);
    });
  }

  /**
   * Delete multiple entries atomically in a single transaction.
   * IN clause is batched to respect the 999-host SQLite limit.
   */
  async deleteMany(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await Zotero.DB.executeTransaction(async () => {
      for (let i = 0; i < ids.length; i += SQLITE_MAX_VARIABLES) {
        const batch = ids.slice(i, i + SQLITE_MAX_VARIABLES);
        const placeholders = batch.map(() => "?").join(",");
        await Zotero.DB.queryAsync(
          `DELETE FROM zsearch_memory WHERE id IN (${placeholders})`,
          batch,
        );
      }
    });
  }

  // --- Query Operations ---

  async query(query: MemoryQuery): Promise<MemoryEntry[]> {
    let sql = "SELECT * FROM zsearch_memory WHERE soul_id = ?";
    const params: any[] = [query.soulId];

    if (query.tier) {
      sql += " AND tier = ?";
      params.push(query.tier);
    }

    if (query.key) {
      sql += " AND key = ?";
      params.push(query.key);
    }

    // Filter out expired entries
    sql += " AND (expires_at IS NULL OR expires_at > ?)";
    params.push(Date.now());

    sql += " ORDER BY timestamp DESC";

    if (query.limit) {
      sql += " LIMIT ?";
      params.push(query.limit);
    }

    if (query.offset) {
      sql += " OFFSET ?";
      params.push(query.offset);
    }

    const rows = (await Zotero.DB.queryAsync(sql, params)) as Array<any>;
    return (rows || []).map((r) => this.rowToEntry(r));
  }

  async getRules(soulId: string, limit?: number): Promise<MemoryEntry[]> {
    return this.query({
      soulId,
      tier: "rules",
      limit,
    });
  }

  async getFacts(soulId: string): Promise<MemoryEntry[]> {
    const now = Date.now();
    const rows = (await Zotero.DB.queryAsync(
      `SELECT * FROM zsearch_memory WHERE soul_id = ? AND tier = ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY timestamp DESC`,
      [soulId, "facts", now],
    )) as Array<any>;
    return (rows || []).map((r) => this.rowToEntry(r));
  }

  async getByKey(
    soulId: string,
    key: string,
    tier: string,
  ): Promise<MemoryEntry | undefined> {
    const rows = (await Zotero.DB.queryAsync(
      "SELECT * FROM zsearch_memory WHERE soul_id = ? AND tier = ? AND key = ? ORDER BY updated_at DESC LIMIT 1",
      [soulId, tier, key],
    )) as Array<any>;
    if (!rows || rows.length === 0) return undefined;
    return this.rowToEntry(rows[0]);
  }

  async getCount(soulId: string, tier: string): Promise<number> {
    const now = Date.now();
    const rows = (await Zotero.DB.queryAsync(
      "SELECT COUNT(*) as cnt FROM zsearch_memory WHERE soul_id = ? AND tier = ? AND (expires_at IS NULL OR expires_at > ?)",
      [soulId, tier, now],
    )) as Array<any>;
    return rows?.[0]?.cnt ?? 0;
  }

  async getSummaries(
    soulId: string,
    limit: number = 10,
  ): Promise<MemoryEntry[]> {
    return this.query({
      soulId,
      tier: "summary",
      limit,
    });
  }

  // --- Stats ---

  async getStats(): Promise<MemoryStats> {
    const rows = (await Zotero.DB.queryAsync(
      "SELECT soul_id, tier, COUNT(*) as count FROM zsearch_memory GROUP BY soul_id, tier",
    )) as Array<any>;

    const stats: MemoryStats = {
      totalFacts: 0,
      totalHistory: 0,
      totalProfile: 0,
      totalRules: 0,
      totalSummary: 0,
      bySoul: {},
    };

    for (const row of rows || []) {
      if (!stats.bySoul[row.soul_id]) {
        stats.bySoul[row.soul_id] = {
          facts: 0,
          history: 0,
          profile: 0,
          rules: 0,
          summary: 0,
        };
      }
      if (row.tier === "facts") {
        stats.totalFacts += row.count;
        stats.bySoul[row.soul_id].facts = row.count;
      } else if (row.tier === "profile") {
        stats.totalProfile += row.count;
        stats.bySoul[row.soul_id].profile = row.count;
      } else if (row.tier === "rules") {
        stats.totalRules += row.count;
        stats.bySoul[row.soul_id].rules = row.count;
      } else if (row.tier === "summary") {
        stats.totalSummary += row.count;
        stats.bySoul[row.soul_id].summary = row.count;
      } else {
        stats.totalHistory += row.count;
        stats.bySoul[row.soul_id].history = row.count;
      }
    }

    return stats;
  }

  // --- Cleanup ---

  async clearSoulMemory(soulId: string): Promise<void> {
    await Zotero.DB.executeTransaction(async () => {
      await Zotero.DB.queryAsync(
        "DELETE FROM zsearch_memory WHERE soul_id = ?",
        [soulId],
      );
    });
  }

  async clearAllMemory(): Promise<void> {
    await Zotero.DB.executeTransaction(async () => {
      await Zotero.DB.queryAsync("DELETE FROM zsearch_memory");
    });
  }

  rowToEntry(row: any): MemoryEntry {
    return {
      id: row.id,
      soulId: row.soul_id,
      tier: row.tier,
      key: row.key,
      content: row.content,
      timestamp: row.timestamp,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at ?? undefined,
      category: row.category ?? undefined,
    };
  }
}

export default new MemoryStore();
