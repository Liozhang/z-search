/**
 * TokenUsageStore — Persistent token usage tracking with memory buffer.
 *
 * Records every AI API call's token consumption to SQLite.
 * Uses an in-memory buffer with periodic flush to avoid blocking AI calls.
 * Provides aggregated queries for the Usage Dashboard.
 *
 * @module core/ai/TokenUsageStore
 */

import { toErrorMessage } from "../../utils/error";
import { safeDebug } from "../../utils/logger";

const SCHEMA_VERSION = 4;

/** Flush every N records */
const FLUSH_THRESHOLD = 30;
/** Flush every N milliseconds */
const FLUSH_INTERVAL_MS = 5000;
/** Default retention in days */
const DEFAULT_RETENTION_DAYS = 180;

interface TokenRecord {
  feature: string;
  modelId: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  isEstimated: boolean;
  sessionId?: string;
  soulId?: string;
  itemId?: number;
  collectionId?: number;
  createdAt: number;
}

export interface TokenUsageStats {
  totalTokens: number;
  totalCalls: number;
  todayTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalReasoningTokens: number;
  byModel: Array<{
    modelId: string;
    calls: number;
    tokens: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    reasoningTokens: number;
  }>;
  byFeature: Array<{
    feature: string;
    calls: number;
    tokens: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    reasoningTokens: number;
  }>;
  bySoul: Array<{
    soulId: string;
    calls: number;
    tokens: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    reasoningTokens: number;
  }>;
  byItem: Array<{
    itemId: number;
    calls: number;
    tokens: number;
    inputTokens: number;
    outputTokens: number;
  }>;
  byCollection: Array<{
    collectionId: number;
    calls: number;
    tokens: number;
    inputTokens: number;
    outputTokens: number;
  }>;
  /** Month-over-month comparison (calendar month, 本月 vs 上月) */
  monthOverMonth?: {
    current: number;
    previous: number;
    changePercent: number;
    direction: "up" | "down" | "flat";
  };
}

export interface HeatmapDay {
  date: string;
  totalTokens: number;
  count: number;
}

class TokenUsageStore {
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private buffer: TokenRecord[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * DB operation lock — Zotero.DB uses a single SQLite connection and cannot
   * handle concurrent queries. All DB access must be serialized through
   * _withDbLock to prevent "rows is undefined" errors.
   */
  private _dbLock: Promise<void> = Promise.resolve();

  /** Consecutive flush failure count — used to give up on persistent DB errors */
  private _flushFailCount = 0;
  private static readonly MAX_FLUSH_FAIL_COUNT = 5;

  private async _withDbLock<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this._dbLock;
    let resolve!: () => void;
    this._dbLock = new Promise<void>((r) => {
      resolve = r;
    });
    try {
      await prev;
      return await fn();
    } finally {
      resolve();
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._doInitialize();
    try {
      await this.initPromise;
    } catch (e) {
      safeDebug("[z-search] TokenUsageStore initialize error: " + e);
      this.initPromise = null;
      throw e instanceof Error ? e : new Error(String(e ?? "Unknown error"));
    }
  }

  private async _doInitialize(): Promise<void> {
    await Zotero.DB.executeTransaction(async () => {
      // Create table if it doesn't exist (fresh install)
      await Zotero.DB.queryAsync(`
        CREATE TABLE IF NOT EXISTS zsearch_token_usage (
          id                INTEGER PRIMARY KEY AUTOINCREMENT,
          feature           TEXT NOT NULL,
          model_id          TEXT NOT NULL,
          prompt_tokens     INTEGER NOT NULL DEFAULT 0,
          completion_tokens INTEGER NOT NULL DEFAULT 0,
          total_tokens      INTEGER NOT NULL DEFAULT 0,
          cache_read_tokens INTEGER DEFAULT 0,
          cache_write_tokens INTEGER DEFAULT 0,
          reasoning_tokens  INTEGER DEFAULT 0,
          is_estimated      INTEGER DEFAULT 0,
          session_id        TEXT,
          soul_id           TEXT,
          item_id           INTEGER,
          collection_id     INTEGER,
          created_at        INTEGER NOT NULL
        )
      `);

      // Incremental migration — add columns that may be missing in older versions
      const migrationColumns: Array<{ col: string; def: string }> = [
        { col: "cache_read_tokens", def: "INTEGER DEFAULT 0" },
        { col: "cache_write_tokens", def: "INTEGER DEFAULT 0" },
        { col: "reasoning_tokens", def: "INTEGER DEFAULT 0" },
        { col: "is_estimated", def: "INTEGER DEFAULT 0" },
        { col: "session_id", def: "TEXT" },
        { col: "soul_id", def: "TEXT" },
        { col: "item_id", def: "INTEGER" },
        { col: "collection_id", def: "INTEGER" },
      ];

      const cols = await Zotero.DB.queryAsync(
        "PRAGMA table_info(zsearch_token_usage)",
      );
      const colNames = new Set((cols as unknown[]).map((c: any) => c.name));
      for (const { col, def } of migrationColumns) {
        if (!colNames.has(col)) {
          await Zotero.DB.queryAsync(
            `ALTER TABLE zsearch_token_usage ADD COLUMN ${col} ${def}`,
          );
        }
      }

      // Ensure all indexes exist
      await Zotero.DB.queryAsync(
        "CREATE INDEX IF NOT EXISTS idx_tu_date ON zsearch_token_usage(created_at)",
      );
      await Zotero.DB.queryAsync(
        "CREATE INDEX IF NOT EXISTS idx_tu_feature ON zsearch_token_usage(feature)",
      );
      await Zotero.DB.queryAsync(
        "CREATE INDEX IF NOT EXISTS idx_tu_model ON zsearch_token_usage(model_id)",
      );
      await Zotero.DB.queryAsync(
        "CREATE INDEX IF NOT EXISTS idx_tu_soul ON zsearch_token_usage(soul_id)",
      );
      await Zotero.DB.queryAsync(
        "CREATE INDEX IF NOT EXISTS idx_tu_item ON zsearch_token_usage(item_id)",
      );
      await Zotero.DB.queryAsync(
        "CREATE INDEX IF NOT EXISTS idx_tu_collection ON zsearch_token_usage(collection_id)",
      );

      // Persist schema version in DB (replaces Prefs-based tracking)
      await Zotero.DB.queryAsync(
        `CREATE TABLE IF NOT EXISTS zsearch_schema_versions (name TEXT PRIMARY KEY, version INTEGER NOT NULL)`,
      );
      await Zotero.DB.queryAsync(
        "INSERT OR REPLACE INTO zsearch_schema_versions (name, version) VALUES (?, ?)",
        ["tokenUsage", SCHEMA_VERSION],
      );
    });

    await this.cleanup(DEFAULT_RETENTION_DAYS);

    // Start periodic flush
    this.flushTimer = setInterval(() => {
      this.flush().catch((e) => {
        safeDebug(`[z-search] TokenUsage periodic flush failed: ${e}`);
      });
    }, FLUSH_INTERVAL_MS);

    this.initialized = true;
  }

  /**
   * Record a token usage entry. Non-blocking — pushes to memory buffer.
   * Callers should NOT await this.
   */
  record(params: {
    feature: string;
    modelId: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    reasoningTokens?: number;
    isEstimated?: boolean;
    sessionId?: string;
    soulId?: string;
    itemId?: number;
    collectionId?: number;
  }): void {
    if (!this.initialized) return;
    this.buffer.push({
      feature: params.feature,
      modelId: params.modelId,
      promptTokens: Number(params.promptTokens) || 0,
      completionTokens: Number(params.completionTokens) || 0,
      totalTokens: Number(params.totalTokens) || 0,
      cacheReadTokens: Number(params.cacheReadTokens) || 0,
      cacheWriteTokens: Number(params.cacheWriteTokens) || 0,
      reasoningTokens: Number(params.reasoningTokens) || 0,
      isEstimated: Boolean(params.isEstimated),
      sessionId: params.sessionId,
      soulId: params.soulId,
      itemId:
        params.itemId != null ? Number(params.itemId) || undefined : undefined,
      collectionId:
        params.collectionId != null
          ? Number(params.collectionId) || undefined
          : undefined,
      createdAt: Date.now(),
    });

    if (this.buffer.length >= FLUSH_THRESHOLD) {
      this.flush().catch((e) => {
        safeDebug(`[z-search] TokenUsage threshold flush failed: ${e}`);
      });
    }
  }

  /**
   * Internal flush logic — must be called within _withDbLock.
   */
  private async _flushLocked(): Promise<void> {
    if (this.buffer.length === 0) return;

    const batch = this.buffer.splice(0);
    const COLS = 14;
    // A buffered row costs COLS params: the batch INSERT must chunk or a
    // backlog of ≥72 records throws "too many SQL variables" (999/14).
    const FLUSH_CHUNK = Math.floor(999 / COLS);
    const toRow = (r: TokenRecord): unknown[] => [
      r.feature,
      r.modelId,
      r.promptTokens,
      r.completionTokens,
      r.totalTokens,
      r.cacheReadTokens,
      r.cacheWriteTokens,
      r.reasoningTokens,
      r.isEstimated ? 1 : 0,
      r.sessionId || null,
      r.soulId || null,
      r.itemId ?? null,
      r.collectionId ?? null,
      r.createdAt,
    ];

    try {
      // Batch INSERT — chunked multi-row statements in one transaction
      await Zotero.DB.executeTransaction(async () => {
        for (let i = 0; i < batch.length; i += FLUSH_CHUNK) {
          const chunk = batch.slice(i, i + FLUSH_CHUNK);
          const placeholders = chunk
            .map(() => `(${Array(COLS).fill("?").join(",")})`)
            .join(",");
          const params = chunk.flatMap(toRow);
          await Zotero.DB.queryAsync(
            `INSERT INTO zsearch_token_usage
              (feature, model_id, prompt_tokens, completion_tokens, total_tokens,
               cache_read_tokens, cache_write_tokens, reasoning_tokens, is_estimated,
               session_id, soul_id, item_id, collection_id, created_at)
             VALUES ${placeholders}`,
            params,
          );
        }
      });
      this._flushFailCount = 0;
    } catch (e) {
      const errMsg = toErrorMessage(e);
      // Fall back to per-row INSERT so one bad record does not lose the entire batch
      const failed: TokenRecord[] = [];
      try {
        await Zotero.DB.executeTransaction(async () => {
          for (const r of batch) {
            try {
              await Zotero.DB.queryAsync(
                `INSERT INTO zsearch_token_usage
                  (feature, model_id, prompt_tokens, completion_tokens, total_tokens,
                   cache_read_tokens, cache_write_tokens, reasoning_tokens, is_estimated,
                   session_id, soul_id, item_id, collection_id, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                toRow(r),
              );
            } catch (e) {
              safeDebug(
                "[z-search] TokenUsageStore: per-row INSERT failed: " + e,
              );
              failed.push(r);
            }
          }
        });
      } catch (e) {
        safeDebug("[z-search] TokenUsageStore: batch transaction failed: " + e);
        // Transaction itself failed — everything is unrecovered
        failed.push(...batch);
      }

      if (failed.length === 0) {
        // All records recovered via fallback — not a real failure
        this._flushFailCount = 0;
      } else {
        this._flushFailCount++;
        if (
          this._flushFailCount < TokenUsageStore.MAX_FLUSH_FAIL_COUNT &&
          this.buffer.length + failed.length < FLUSH_THRESHOLD * 3
        ) {
          // Actually re-buffer the unrecovered records (front, so chronological
          // order is preserved). The old code only logged "put back" — the
          // records were silently dropped.
          this.buffer.unshift(...failed);
          safeDebug(
            `[z-search] TokenUsage flush: batch INSERT failed (${errMsg}), re-buffered ${failed.length} unrecovered records`,
          );
        } else {
          safeDebug(
            `[z-search] TokenUsage: ${failed.length} records lost — flush failed ${this._flushFailCount} consecutive times (${errMsg})`,
          );
          this._flushFailCount = 0;
        }
      }
    }
  }

  /**
   * Flush buffered records to SQLite in a single transaction.
   */
  async flush(): Promise<void> {
    return this._withDbLock(() => this._flushLocked());
  }

  /**
   * Get heatmap data: daily token totals for the last 53 weeks.
   */
  async getHeatmapData(): Promise<HeatmapDay[]> {
    return this._withDbLock(async () => {
      const now = Date.now();
      const weeks = 53;
      const startDate = now - weeks * 7 * 24 * 60 * 60 * 1000;

      const rows: any[] = await Zotero.DB.queryAsync(
        `SELECT created_at, total_tokens, 1 as cnt
         FROM zsearch_token_usage
         WHERE created_at >= ?`,
        [startDate],
      );

      // Group by local date to avoid UTC/local timezone mismatch
      const dayMap = new Map<string, { totalTokens: number; count: number }>();
      for (const r of rows) {
        const d = new Date(r.created_at);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        const entry = dayMap.get(key) || { totalTokens: 0, count: 0 };
        entry.totalTokens += r.total_tokens ?? 0;
        entry.count += 1;
        dayMap.set(key, entry);
      }

      return Array.from(dayMap.entries()).map(([date, data]) => ({
        date,
        totalTokens: data.totalTokens,
        count: data.count,
      }));
    });
  }

  /**
   * Get aggregated usage stats.
   * Flushes buffer first so recent records are included.
   */
  async getStats(filter?: {
    from?: number;
    to?: number;
    feature?: string;
    modelId?: string;
  }): Promise<TokenUsageStats> {
    return this._withDbLock(async () => {
      // Flush pending records so dashboard sees the latest data
      await this._flushLocked();

      let where = "1=1";
      const params: any[] = [];

      if (filter?.from) {
        where += " AND created_at >= ?";
        params.push(filter.from);
      }
      if (filter?.to) {
        where += " AND created_at <= ?";
        params.push(filter.to);
      }
      if (filter?.feature) {
        where += " AND feature = ?";
        params.push(filter.feature);
      }
      if (filter?.modelId) {
        where += " AND model_id = ?";
        params.push(filter.modelId);
      }

      // Overall totals
      const totalRow: any = (
        await Zotero.DB.queryAsync(
          `SELECT COALESCE(SUM(total_tokens),0) as total, COUNT(*) as cnt,
                SUM(prompt_tokens) as pt, SUM(completion_tokens) as ct,
                SUM(cache_read_tokens) as crt, SUM(reasoning_tokens) as rt
         FROM zsearch_token_usage WHERE ${where}`,
          params,
        )
      )[0];

      // Today — respect filter conditions (feature/modelId) but use absolute today start
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayMs = todayStart.getTime();
      const todayWhere =
        filter?.feature || filter?.modelId
          ? `${where.replace("1=1", "1=1")} AND created_at >= ?`
          : "created_at >= ?";
      const todayParams =
        filter?.feature || filter?.modelId ? [...params, todayMs] : [todayMs];
      const todayRow: any = (
        await Zotero.DB.queryAsync(
          `SELECT COALESCE(SUM(total_tokens),0) as total FROM zsearch_token_usage WHERE ${todayWhere}`,
          todayParams,
        )
      )[0];

      // By model
      const modelRows: any[] = await Zotero.DB.queryAsync(
        `SELECT model_id, COUNT(*) as cnt, SUM(total_tokens) as total,
                SUM(prompt_tokens) as pt, SUM(completion_tokens) as ct,
                SUM(cache_read_tokens) as crt, SUM(reasoning_tokens) as rt
         FROM zsearch_token_usage WHERE ${where}
         GROUP BY model_id ORDER BY total DESC`,
        params,
      );

      // By feature
      const featureRows: any[] = await Zotero.DB.queryAsync(
        `SELECT feature, COUNT(*) as cnt, SUM(total_tokens) as total,
                SUM(prompt_tokens) as pt, SUM(completion_tokens) as ct,
                SUM(cache_read_tokens) as crt, SUM(reasoning_tokens) as rt
         FROM zsearch_token_usage WHERE ${where}
         GROUP BY feature ORDER BY total DESC`,
        params,
      );

      // By soul
      const soulRows: any[] = await Zotero.DB.queryAsync(
        `SELECT soul_id, COUNT(*) as cnt, SUM(total_tokens) as total,
                SUM(prompt_tokens) as pt, SUM(completion_tokens) as ct,
                SUM(cache_read_tokens) as crt, SUM(reasoning_tokens) as rt
         FROM zsearch_token_usage WHERE ${where} AND soul_id IS NOT NULL
         GROUP BY soul_id ORDER BY total DESC`,
        params,
      );

      // By item
      const itemRows: any[] = await Zotero.DB.queryAsync(
        `SELECT item_id, COUNT(*) as cnt, SUM(total_tokens) as total,
                SUM(prompt_tokens) as pt, SUM(completion_tokens) as ct,
                SUM(cache_read_tokens) as crt, SUM(reasoning_tokens) as rt
         FROM zsearch_token_usage WHERE ${where} AND item_id IS NOT NULL
         GROUP BY item_id ORDER BY total DESC LIMIT 100`,
        params,
      );

      // By collection
      const collectionRows: any[] = await Zotero.DB.queryAsync(
        `SELECT collection_id, COUNT(*) as cnt, SUM(total_tokens) as total,
                SUM(prompt_tokens) as pt, SUM(completion_tokens) as ct,
                SUM(cache_read_tokens) as crt, SUM(reasoning_tokens) as rt
         FROM zsearch_token_usage WHERE ${where} AND collection_id IS NOT NULL
         GROUP BY collection_id ORDER BY total DESC LIMIT 100`,
        params,
      );

      // Month-over-month (calendar month: 本月 vs 上月,基于 total_tokens)
      const nowDate = new Date();
      const thisMonthStart = new Date(
        nowDate.getFullYear(),
        nowDate.getMonth(),
        1,
      ).getTime();
      const lastMonthStart = new Date(
        nowDate.getFullYear(),
        nowDate.getMonth() - 1,
        1,
      ).getTime();
      const nowMs = nowDate.getTime();
      const momCurrentRow: any = (
        await Zotero.DB.queryAsync(
          `SELECT COALESCE(SUM(total_tokens),0) as total FROM zsearch_token_usage WHERE created_at >= ? AND created_at <= ?`,
          [thisMonthStart, nowMs],
        )
      )[0];
      const momPreviousRow: any = (
        await Zotero.DB.queryAsync(
          `SELECT COALESCE(SUM(total_tokens),0) as total FROM zsearch_token_usage WHERE created_at >= ? AND created_at < ?`,
          [lastMonthStart, thisMonthStart],
        )
      )[0];
      const momCurrent = momCurrentRow?.total ?? 0;
      const momPrevious = momPreviousRow?.total ?? 0;
      const changePercent =
        momPrevious > 0
          ? ((momCurrent - momPrevious) / momPrevious) * 100
          : momCurrent > 0
            ? 100
            : 0;
      const direction: "up" | "down" | "flat" =
        changePercent > 0.5 ? "up" : changePercent < -0.5 ? "down" : "flat";

      return {
        monthOverMonth: {
          current: momCurrent,
          previous: momPrevious,
          changePercent,
          direction,
        },
        totalTokens: totalRow?.total ?? 0,
        totalCalls: totalRow?.cnt ?? 0,
        todayTokens: todayRow?.total ?? 0,
        totalInputTokens: totalRow?.pt ?? 0,
        totalOutputTokens: totalRow?.ct ?? 0,
        totalCacheReadTokens: totalRow?.crt ?? 0,
        totalReasoningTokens: totalRow?.rt ?? 0,
        byModel: modelRows.map((r: any) => ({
          modelId: r.model_id,
          calls: r.cnt,
          tokens: r.total ?? 0,
          inputTokens: r.pt ?? 0,
          outputTokens: r.ct ?? 0,
          cacheReadTokens: r.crt ?? 0,
          reasoningTokens: r.rt ?? 0,
        })),
        byFeature: featureRows.map((r: any) => ({
          feature: r.feature,
          calls: r.cnt,
          tokens: r.total ?? 0,
          inputTokens: r.pt ?? 0,
          outputTokens: r.ct ?? 0,
          cacheReadTokens: r.crt ?? 0,
          reasoningTokens: r.rt ?? 0,
        })),
        bySoul: soulRows.map((r: any) => ({
          soulId: r.soul_id || "",
          calls: r.cnt,
          tokens: r.total ?? 0,
          inputTokens: r.pt ?? 0,
          outputTokens: r.ct ?? 0,
          cacheReadTokens: r.crt ?? 0,
          reasoningTokens: r.rt ?? 0,
        })),
        byItem: itemRows.map((r: any) => ({
          itemId: r.item_id,
          calls: r.cnt,
          tokens: r.total ?? 0,
          inputTokens: r.pt ?? 0,
          outputTokens: r.ct ?? 0,
          cacheReadTokens: r.crt ?? 0,
          reasoningTokens: r.rt ?? 0,
        })),
        byCollection: collectionRows.map((r: any) => ({
          collectionId: r.collection_id,
          calls: r.cnt,
          tokens: r.total ?? 0,
          inputTokens: r.pt ?? 0,
          outputTokens: r.ct ?? 0,
          cacheReadTokens: r.crt ?? 0,
          reasoningTokens: r.rt ?? 0,
        })),
      };
    });
  }

  /**
   * Remove records older than N days.
   */
  async cleanup(days: number): Promise<void> {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return this._withDbLock(async () => {
      try {
        await Zotero.DB.queryAsync(
          "DELETE FROM zsearch_token_usage WHERE created_at < ?",
          [cutoff],
        );
      } catch (e) {
        safeDebug("[z-search] TokenUsageStore.cleanup: " + e);
        // Table may not exist yet on first run
      }
    });
  }

  /**
   * Clear all token usage records. Discards buffered records and deletes the entire table.
   */
  async clearAll(): Promise<void> {
    return this._withDbLock(async () => {
      this.buffer.length = 0;
      try {
        await Zotero.DB.queryAsync("DELETE FROM zsearch_token_usage");
      } catch (e) {
        safeDebug("[z-search] TokenUsageStore.clearAll: " + e);
        // Table may not exist yet on first run
      }
    });
  }

  /**
   * Clear item_id references for the given item IDs (set to NULL).
   *
   * Unlike physical DELETE, this preserves the row so historical token
   * statistics (SUM aggregates) remain stable. Used when Zotero items
   * are deleted — the token consumption is a historical fact and should
   * not be retroactively erased from "monthly usage" views.
   *
   * Schema note: item_id is already nullable in zsearch_token_usage.
   */
  async clearItemIds(itemIds: number[]): Promise<void> {
    if (itemIds.length === 0) return;
    return this._withDbLock(async () => {
      try {
        const BATCH = 900;
        for (let i = 0; i < itemIds.length; i += BATCH) {
          const batch = itemIds.slice(i, i + BATCH);
          const placeholders = batch.map(() => "?").join(",");
          await Zotero.DB.queryAsync(
            `UPDATE zsearch_token_usage SET item_id = NULL WHERE item_id IN (${placeholders})`,
            batch,
          );
        }
      } catch (e) {
        safeDebug(
          "[z-search] TokenUsageStore.clearItemIds: " + e,
        ); /* table may not exist yet */
      }
    });
  }

  /**
   * Clear collection_id references for the given collection IDs (set to NULL).
   * Same rationale as clearItemIds — preserve historical stats.
   */
  async clearCollectionIds(collectionIds: number[]): Promise<void> {
    if (collectionIds.length === 0) return;
    return this._withDbLock(async () => {
      try {
        const BATCH = 900;
        for (let i = 0; i < collectionIds.length; i += BATCH) {
          const batch = collectionIds.slice(i, i + BATCH);
          const placeholders = batch.map(() => "?").join(",");
          await Zotero.DB.queryAsync(
            `UPDATE zsearch_token_usage SET collection_id = NULL WHERE collection_id IN (${placeholders})`,
            batch,
          );
        }
      } catch (e) {
        safeDebug(
          "[z-search] TokenUsageStore.clearCollectionIds: " + e,
        ); /* table may not exist yet */
      }
    });
  }

  /**
   * Called on plugin shutdown — flush remaining buffer.
   */
  async destroy(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
    this.initialized = false;
    this.initPromise = null;
  }
}

export default new TokenUsageStore();
