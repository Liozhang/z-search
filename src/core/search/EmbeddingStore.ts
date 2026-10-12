/**
 * EmbeddingStore - SQLite-based vector embedding storage
 *
 * Dedicated storage for text embeddings, replacing the AICache-based approach.
 * Stores embeddings as BLOB (Float32Array) for compact storage and fast retrieval.
 *
 * Storage lives in the EXTERNAL file zsearch_embeddings.sqlite (see
 * externalDb.ts): vectors were BLOB-heavy plugin data inside the user's main
 * zotero.sqlite (Zotero backs up + vacuums that file on every cycle), and
 * every embedding-model switch duplicated the whole set. Rows written by
 * older versions are migrated out of the main DB once at init.
 *
 * @module core/search/EmbeddingStore
 */

export interface EmbeddingEntry {
  itemId: number;
  itemType: string;
  embedding: Float32Array;
  model: string;
  dimension: number;
  searchText?: string;
  createdAt: number;
  updatedAt: number;
}

export interface EmbeddingStats {
  total: number;
  byModel: Record<string, number>;
}

import { SAFE_BATCH_SIZE } from "../../utils/constants";
import { safeDebug } from "../../utils/logger";
import { SQL_IS_REGULAR_ITEM } from "../../utils/zoteroSql";
import { getExternalDb, migrateTableFromMainDb } from "../task/externalDb";

class EmbeddingStore {
  private initialized = false;

  private dbConn(): any {
    return getExternalDb("zsearch_embeddings.sqlite");
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const conn = this.dbConn();

      // External connections inherit no busy_timeout — see TaskStore.init
      await conn.queryAsync("PRAGMA busy_timeout = 5000", []);

      // DDL 先行：迁移把行写入外部库的目标表，目标表不存在时整个迁移
      // 必然空转（首次升级启动正是这种状态），杂散表要多背一个启动周期。
      await conn.executeTransaction(async () => {
        await conn.queryAsync(`
          CREATE TABLE IF NOT EXISTS zsearch_embeddings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            item_id INTEGER NOT NULL,
            item_type TEXT NOT NULL DEFAULT 'item',
            embedding BLOB NOT NULL,
            model TEXT NOT NULL,
            dimension INTEGER NOT NULL,
            search_text TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            UNIQUE(item_id, model)
          )
        `);

        await conn.queryAsync(`
          CREATE INDEX IF NOT EXISTS idx_embeddings_model
          ON zsearch_embeddings(model)
        `);

        await conn.queryAsync(`
          CREATE INDEX IF NOT EXISTS idx_embeddings_item
          ON zsearch_embeddings(item_id)
        `);

        // Claim-node vectors (evidence schema v3 originally created this in
        // the main DB; moved here so one file holds all vector BLOBs).
        await conn.queryAsync(`
          CREATE TABLE IF NOT EXISTS zsearch_claim_embeddings (
            node_id INTEGER NOT NULL,
            model TEXT NOT NULL,
            embedding BLOB NOT NULL,
            dimension INTEGER NOT NULL,
            created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
            UNIQUE(node_id, model)
          )
        `);

        // Version bookkeeping (the store previously had none — schema changes
        // had no migration path; DDL above is unconditional + idempotent).
        await conn.queryAsync(
          `CREATE TABLE IF NOT EXISTS zsearch_schema_versions (name TEXT PRIMARY KEY, version INTEGER NOT NULL)`,
        );
        await conn.queryAsync(
          "INSERT OR REPLACE INTO zsearch_schema_versions (name, version) VALUES (?, ?)",
          ["embeddings", 1],
        );
      });

      // One-time migration: rows written by older versions live in the
      // user's MAIN zotero.sqlite. Copy into the external file, then drop
      // the stray tables from the main DB (INSERT OR REPLACE keeps the
      // migration idempotent across retries). Also carries claim vectors,
      // whose table moved to this file for the same size reasons.
      // 位置在建表之后（原在之前）：迁移目标表必须先存在。
      await migrateTableFromMainDb(conn, "zsearch_embeddings");
      await migrateTableFromMainDb(conn, "zsearch_claim_embeddings");

      this.initialized = true;
    } catch (e) {
      safeDebug("[z-search] EmbeddingStore initialize error: " + e);
      throw e;
    }
  }

  private float32ToBlob(vector: number[]): Uint8Array {
    const float32 = new Float32Array(vector);
    return new Uint8Array(float32.buffer);
  }

  private blobToFloat32(blob: any): Float32Array {
    const uint8 = blob instanceof Uint8Array ? blob : new Uint8Array(blob);
    return new Float32Array(uint8.buffer);
  }

  async storeEmbedding(
    itemId: number,
    embedding: number[],
    model: string,
    searchText?: string,
    itemType: string = "item",
  ): Promise<void> {
    const now = Date.now();
    const blob = this.float32ToBlob(embedding);

    try {
      await this.dbConn().queryAsync(
        `INSERT INTO zsearch_embeddings (item_id, item_type, embedding, model, dimension, search_text, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(item_id, model) DO UPDATE SET
           embedding = excluded.embedding,
           dimension = excluded.dimension,
           search_text = excluded.search_text,
           updated_at = excluded.updated_at`,
        [
          itemId,
          itemType,
          blob,
          model,
          embedding.length,
          searchText ?? null,
          now,
          now,
        ],
      );
    } catch (e) {
      safeDebug(
        `[z-search] EmbeddingStore.storeEmbedding failed for item ${itemId}: ${e}`,
      );
      throw e;
    }
  }

  async getEmbedding(
    itemId: number,
    model: string,
  ): Promise<Float32Array | null> {
    try {
      const rows = await this.dbConn().queryAsync(
        `SELECT embedding FROM zsearch_embeddings WHERE item_id = ? AND model = ?`,
        [itemId, model],
      );

      if (rows && rows.length > 0) {
        return this.blobToFloat32(rows[0].embedding);
      }
      return null;
    } catch (e) {
      safeDebug(
        `[z-search] EmbeddingStore.getEmbedding failed for item ${itemId}: ${e}`,
      );
      throw e;
    }
  }

  /**
   * Fetch a cached note embedding (item_type='note'). Returns null on miss so
   * callers can fall back to live inference and persist the result.
   */
  async getNoteEmbedding(
    noteId: number,
    model: string,
  ): Promise<Float32Array | null> {
    try {
      const rows = await this.dbConn().queryAsync(
        `SELECT embedding FROM zsearch_embeddings WHERE item_id = ? AND item_type = 'note' AND model = ?`,
        [noteId, model],
      );
      if (rows && rows.length > 0) {
        return this.blobToFloat32(rows[0].embedding);
      }
      return null;
    } catch (e) {
      safeDebug(
        `[z-search] EmbeddingStore.getNoteEmbedding failed for note ${noteId}: ${e}`,
      );
      return null;
    }
  }

  /**
   * Persist a note embedding. Uses the same zsearch_embeddings table with
   * item_type='note' so it coexists with item embeddings under UNIQUE(item_id, model).
   */
  async storeNoteEmbedding(
    noteId: number,
    embedding: number[] | Float32Array,
    model: string,
    searchText: string,
  ): Promise<void> {
    const now = Date.now();
    const blob = this.float32ToBlob(Array.from(embedding));
    const dim = embedding.length;
    try {
      await this.dbConn().queryAsync(
        `INSERT INTO zsearch_embeddings (item_id, item_type, embedding, model, dimension, search_text, created_at, updated_at)
         VALUES (?, 'note', ?, ?, ?, ?, ?, ?)
         ON CONFLICT(item_id, model) DO UPDATE SET
           embedding = excluded.embedding,
           dimension = excluded.dimension,
           search_text = excluded.search_text,
           updated_at = excluded.updated_at`,
        [noteId, blob, model, dim, searchText.slice(0, 500), now, now],
      );
    } catch (e) {
      safeDebug(
        `[z-search] EmbeddingStore.storeNoteEmbedding failed for note ${noteId}: ${e}`,
      );
    }
  }

  /**
   * Invalidate a cached note embedding (e.g. when the note is edited).
   * The next findSimilarNotes call will re-embed and re-cache.
   */
  async invalidateNoteEmbedding(noteId: number, model?: string): Promise<void> {
    try {
      if (model) {
        await this.dbConn().queryAsync(
          `DELETE FROM zsearch_embeddings WHERE item_id = ? AND item_type = 'note' AND model = ?`,
          [noteId, model],
        );
      } else {
        await this.dbConn().queryAsync(
          `DELETE FROM zsearch_embeddings WHERE item_id = ? AND item_type = 'note'`,
          [noteId],
        );
      }
    } catch (e) {
      safeDebug(
        `[z-search] EmbeddingStore.invalidateNoteEmbedding failed for note ${noteId}: ${e}`,
      );
    }
  }

  async getEmbeddingsForItems(
    itemIds: number[],
    model: string,
  ): Promise<
    Array<{ itemId: number; embedding: Float32Array; searchText?: string }>
  > {
    if (itemIds.length === 0) return [];

    try {
      const BATCH_SIZE = SAFE_BATCH_SIZE;
      const allRows: any[] = [];

      for (let i = 0; i < itemIds.length; i += BATCH_SIZE) {
        const batch = itemIds.slice(i, i + BATCH_SIZE);
        const placeholders = batch.map(() => "?").join(",");
        const rows = await this.dbConn().queryAsync(
          `SELECT item_id, embedding, search_text FROM zsearch_embeddings
           WHERE item_id IN (${placeholders}) AND model = ?`,
          [...batch, model],
        );
        if (rows) allRows.push(...rows);
      }

      return allRows.map((row: any) => ({
        itemId: row.item_id,
        embedding: this.blobToFloat32(row.embedding),
        searchText: row.search_text ?? undefined,
      }));
    } catch (e) {
      safeDebug(`[z-search] EmbeddingStore.getEmbeddingsForItems failed: ${e}`);
      throw e;
    }
  }

  async getAllEmbeddings(
    model: string,
    options?: { limit?: number; offset?: number },
  ): Promise<
    Array<{ itemId: number; embedding: Float32Array; searchText?: string }>
  > {
    try {
      const limit = options?.limit;
      const offset = options?.offset ?? 0;

      let sql = `SELECT item_id, embedding, search_text FROM zsearch_embeddings WHERE model = ?`;
      const params: any[] = [model];

      if (limit != null) {
        sql += ` LIMIT ? OFFSET ?`;
        params.push(limit, offset);
      }

      const rows = await this.dbConn().queryAsync(sql, params);

      return (rows || []).map((row: any) => ({
        itemId: row.item_id,
        embedding: this.blobToFloat32(row.embedding),
        searchText: row.search_text ?? undefined,
      }));
    } catch (e) {
      safeDebug(`[z-search] EmbeddingStore.getAllEmbeddings failed: ${e}`);
      throw e;
    }
  }

  /**
   * Count total embeddings for a given model.
   */
  async getEmbeddingCount(model: string): Promise<number> {
    try {
      const rows = await this.dbConn().queryAsync(
        `SELECT COUNT(*) as count FROM zsearch_embeddings WHERE model = ?`,
        [model],
      );
      return rows?.[0]?.count ?? 0;
    } catch (e) {
      safeDebug(`[z-search] EmbeddingStore.getEmbeddingCount failed: ${e}`);
      throw e;
    }
  }

  async deleteEmbedding(itemId: number, model: string): Promise<void> {
    try {
      await this.dbConn().queryAsync(
        `DELETE FROM zsearch_embeddings WHERE item_id = ? AND model = ?`,
        [itemId, model],
      );
    } catch (e) {
      safeDebug(
        `[z-search] EmbeddingStore.deleteEmbedding failed for item ${itemId}: ${e}`,
      );
      throw e;
    }
  }

  async deleteEmbeddingsByItemId(itemId: number): Promise<void> {
    try {
      await this.dbConn().queryAsync(
        `DELETE FROM zsearch_embeddings WHERE item_id = ?`,
        [itemId],
      );
    } catch (e) {
      safeDebug(
        `[z-search] EmbeddingStore.deleteEmbeddingsByItemId failed for item ${itemId}: ${e}`,
      );
      // 与 deleteEmbedding/clearAll 同口径上抛：清理方（条目删除监听）
      // 需要知道失败，否则会误以为清理成功。
      throw e;
    }
  }

  /**
   * 删除 item_id 已不存在于 items 表的孤儿嵌入行。嵌入表在外部库，
   * 无法跨库联表——按 ID 集合比对（同 getUnembeddedItemCount 的口径）。
   * 供启动时的孤儿清理调用，幂等。
   */
  async deleteOrphanEmbeddings(): Promise<number> {
    const rows = await this.dbConn().queryAsync(
      `SELECT DISTINCT item_id FROM zsearch_embeddings`,
    );
    const ids = (rows || []).map((r: any) => Number(r.item_id));
    if (ids.length === 0) return 0;

    const alive = new Set<number>();
    for (let i = 0; i < ids.length; i += SAFE_BATCH_SIZE) {
      const chunk = ids.slice(i, i + SAFE_BATCH_SIZE);
      const ph = chunk.map(() => "?").join(",");
      const found = (await Zotero.DB.queryAsync(
        `SELECT itemID FROM items WHERE itemID IN (${ph})`,
        chunk,
      )) as any[];
      for (const r of found || []) alive.add(Number(r.itemID));
    }

    const orphanIds = ids.filter((id: number) => !alive.has(id));
    if (orphanIds.length === 0) return 0;

    for (let i = 0; i < orphanIds.length; i += SAFE_BATCH_SIZE) {
      const chunk = orphanIds.slice(i, i + SAFE_BATCH_SIZE);
      const ph = chunk.map(() => "?").join(",");
      await this.dbConn().queryAsync(
        `DELETE FROM zsearch_embeddings WHERE item_id IN (${ph})`,
        chunk,
      );
    }
    return orphanIds.length;
  }

  async clearAll(model?: string): Promise<void> {
    try {
      if (model) {
        await this.dbConn().queryAsync(
          `DELETE FROM zsearch_embeddings WHERE model = ?`,
          [model],
        );
      } else {
        await this.dbConn().queryAsync(`DELETE FROM zsearch_embeddings`);
      }
    } catch (e) {
      safeDebug(`[z-search] EmbeddingStore.clearAll failed: ${e}`);
      throw e;
    }
  }

  async getStats(): Promise<EmbeddingStats> {
    try {
      const rows = await this.dbConn().queryAsync(
        `SELECT model, COUNT(*) as count FROM zsearch_embeddings GROUP BY model`,
        [],
      );

      const byModel: Record<string, number> = {};
      let total = 0;
      for (const row of rows || []) {
        byModel[row.model] = row.count;
        total += row.count;
      }

      return { total, byModel };
    } catch (e) {
      safeDebug(`[z-search] EmbeddingStore.getStats failed: ${e}`);
      return { total: 0, byModel: {} };
    }
  }

  async getUnembeddedItemCount(model: string): Promise<number> {
    try {
      // Vectors now live in the external file while Zotero's items table
      // stays in the main DB — a single cross-file SQL statement is not
      // possible. Set algebra gives the same count:
      //   unembedded = |items(non-attachment)| − |items ∩ embedded|
      //
      // "Non-attachment" is matched BY TYPE NAME: the old
      // `itemTypeID != 14` ('14 = attachment') was backwards — Zotero 10
      // numbers itemTypeID from the alphabetically ordered schema.json
      // (3=attachment, 14=document, 28=note), so it counted every note and
      // attachment and dropped every document. See src/utils/zoteroSql.ts §面 B.
      // 回收站条目一并排除：rebuildIndex 用 Zotero.Items.getAll（不含回收
      // 站），计数不排除会让「待嵌入 N 条」永远清不掉。
      const totalRows = (await Zotero.DB.queryAsync(
        `SELECT COUNT(*) as count FROM items i
         WHERE ${SQL_IS_REGULAR_ITEM}
           AND i.itemID NOT IN (SELECT itemID FROM deletedItems)`,
      )) as any[];
      const total = Number(totalRows?.[0]?.count ?? 0);

      const embeddedIds = [...(await this.getEmbeddedItemIDs(model))];
      let embeddedInZotero = 0;
      for (let i = 0; i < embeddedIds.length; i += SAFE_BATCH_SIZE) {
        const chunk = embeddedIds.slice(i, i + SAFE_BATCH_SIZE);
        const ph = chunk.map(() => "?").join(",");
        const rows = (await Zotero.DB.queryAsync(
          `SELECT COUNT(*) as count FROM items i
           WHERE ${SQL_IS_REGULAR_ITEM}
             AND i.itemID NOT IN (SELECT itemID FROM deletedItems)
             AND i.itemID IN (${ph})`,
          chunk,
        )) as any[];
        embeddedInZotero += Number(rows?.[0]?.count ?? 0);
      }
      return Math.max(0, total - embeddedInZotero);
    } catch (e) {
      safeDebug(
        `[z-search] EmbeddingStore.getUnembeddedItemCount failed: ${e}`,
      );
      throw e;
    }
  }

  /**
   * Get all item IDs that already have embeddings for a given model.
   * Used by rebuildIndex to skip already-processed items.
   */
  async getEmbeddedItemIDs(model: string): Promise<Set<number>> {
    try {
      const rows = await this.dbConn().queryAsync(
        `SELECT item_id FROM zsearch_embeddings WHERE model = ?`,
        [model],
      );
      const ids = new Set<number>();
      for (const row of rows || []) {
        ids.add(row.item_id);
      }
      return ids;
    } catch (e) {
      safeDebug(`[z-search] EmbeddingStore.getEmbeddedItemIDs failed: ${e}`);
      throw e;
    }
  }

  /**
   * Get stored search texts for a model, keyed by item_id（不带向量 BLOB，
   * 供构建期做内容变更比对）。
   */
  async getSearchTextMap(model: string): Promise<Map<number, string>> {
    try {
      const rows = await this.dbConn().queryAsync(
        `SELECT item_id, search_text FROM zsearch_embeddings WHERE model = ?`,
        [model],
      );
      const map = new Map<number, string>();
      for (const row of rows || []) {
        map.set(Number(row.item_id), row.search_text ?? "");
      }
      return map;
    } catch (e) {
      safeDebug(`[z-search] EmbeddingStore.getSearchTextMap failed: ${e}`);
      throw e;
    }
  }

  /**
   * Rebuild index for all items that don't have embeddings yet, plus items
   * whose search text changed since last embedding (title/abstract edits).
   *
   * Embeddings are computed in batches and written once per batch inside a
   * single transaction (instead of one transaction per item). ONNX inference
   * (`embedFn`) remains serial, but this collapses N transaction commits into
   * ⌈N/BATCH⌉, eliminating most of the per-item fsync overhead.
   */
  async rebuildIndex(
    model: string,
    embedFn: (text: string) => Promise<number[]>,
    createSearchTextFn: (item: any) => string,
    onProgress?: (current: number, total: number) => void,
    shouldCancel?: () => boolean,
  ): Promise<{
    processed: number;
    errors: number;
    /** 首条错误消息（截断）——全部失败时 UI 需要一个可行动的原因出口。 */
    firstError: string | null;
  }> {
    let processed = 0;
    let errors = 0;
    let firstError: string | null = null;

    // Items waiting to be embedded, accumulated until a batch is full.
    const WRITE_BATCH = 25;
    const pending: Array<{
      itemId: number;
      itemType: string;
      searchText: string;
      embedding: number[];
    }> = [];

    /** Flush a pending batch in a single transaction. */
    const flushBatch = async () => {
      if (pending.length === 0) return;
      const batch = pending.splice(0, pending.length);
      try {
        await this.dbConn().executeTransaction(async () => {
          for (const b of batch) {
            // storeEmbedding 是 upsert（UNIQUE(item_id, model) 冲突时更新
            // 向量与 search_text）。不做「已嵌入即跳过」的二次检查——重嵌
            // 入场景（内容变更）本来就带着旧行来，必须覆盖；并发构建双写
            // 同一内容也是无害的。
            await this.storeEmbedding(
              b.itemId,
              b.embedding,
              model,
              b.searchText,
              b.itemType,
            );
          }
        });
      } catch (e) {
        // Batch write failed — those items were embedded but NOT stored:
        // move them out of processed into errors so the summary stays
        // honest (processed + errors accounts for every attempted item).
        errors += batch.length;
        processed -= batch.length;
        if (!firstError) {
          firstError = String((e as any)?.message || e).slice(0, 300);
        }
        safeDebug(
          `[z-search] EmbeddingStore.rebuildIndex batch write error: ${e}`,
        );
      }
    };

    try {
      const embeddedIDs = await this.getEmbeddedItemIDs(model);
      const items = await Zotero.Items.getAll(Zotero.Libraries.userLibraryID);

      // PDF 注释条目一并入库（对齐 All Search 覆盖面）：注释行让
      // 高亮文本与批注可被语义检索命中。
      // 增量口径是「内容」而非「存在」：已嵌入但检索文本已变的条目
      // （标题/摘要被编辑）也要重嵌入，否则索引永远停留在旧内容上。
      // 比对载体是入库时保存的 search_text，无需额外哈希列。
      const storedTexts = await this.getSearchTextMap(model);
      const currentTexts = new Map<number, string>();
      const toProcess = items.filter((item: any) => {
        if (!(item.isRegularItem() || item.isNote() || item.isAnnotation?.())) {
          return false;
        }
        const text = createSearchTextFn(item);
        currentTexts.set(item.id, text);
        if (!embeddedIDs.has(item.id)) return true;
        return (storedTexts.get(item.id) ?? "") !== text;
      });

      const total = toProcess.length;

      for (const item of toProcess) {
        // 取消即停（2026-09-25）：大库元数据嵌入可跑数分钟，用户点取消后
        // 不应继续烧推理；已写入批次保留，下次构建按 embeddedIDs 续跑。
        if (shouldCancel?.()) break;
        try {
          const searchText =
            currentTexts.get(item.id) ?? createSearchTextFn(item);
          // 空检索文本：无内容可嵌入，按已处理计（不是错误），保进度守恒。
          if (!searchText.trim()) {
            processed++;
            continue;
          }

          const embedding = await embedFn(searchText);
          pending.push({
            itemId: item.id,
            itemType: item.isNote()
              ? "note"
              : item.isAnnotation?.()
                ? "annotation"
                : "item",
            searchText,
            embedding,
          });
          // 嵌入成功才计 processed——此前计数在 try 之外，嵌入全错时
          // 「成功 X 篇」与「失败 X 篇」同时虚高、互相矛盾。
          processed++;

          if (pending.length >= WRITE_BATCH) {
            await flushBatch();
          }
        } catch (e) {
          errors++;
          if (!firstError) {
            firstError = String((e as any)?.message || e).slice(0, 300);
          }
          if (errors <= 3) {
            safeDebug(
              `[z-search] EmbeddingStore.rebuildIndex item error #${errors}: ${e}`,
            );
          }
        }
        // 成败都要推进进度条（失败条目此前也推进——保持同一节奏）。
        if (onProgress && processed % 10 === 0) {
          onProgress(processed, total);
        }
      }

      // Flush any remaining items in the final partial batch.
      await flushBatch();

      if (onProgress) {
        onProgress(processed, total);
      }
    } catch (e) {
      safeDebug("[z-search] EmbeddingStore rebuildIndex error: " + e);
    }

    return { processed, errors, firstError };
  }
}

export default new EmbeddingStore();
