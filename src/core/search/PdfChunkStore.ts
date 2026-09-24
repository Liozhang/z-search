/**
 * PdfChunkStore — persistence + in-memory index for PDF full-text chunks.
 *
 * Each chunk is a slice of a paper's extracted text (one per section, or
 * fixed-size blocks when section parsing falls back). Embeddings are stored
 * both in SQLite (zsearch_pdf_chunks, the source of truth) and mirrored into
 * a VectorIndex for fast cosine search.
 *
 * DB writes and index updates are kept in sync: storeChunks removes the
 * item's old chunk ids from the index, then re-loads fresh rows from DB so
 * the index can never hold stale ids.
 *
 * @module core/search/PdfChunkStore
 */

import { InMemoryMatrixIndex, IndexEntry } from "./VectorIndex";
import type { VectorIndex } from "./VectorIndex";
import { IVFIndex, IVF_MIN_VECTORS } from "./IVFIndex";
import type { SectionCategory, ParseMethod } from "./sectionParser";
import { bm25Index } from "./BM25Index";
import { safeDebug } from "../../utils/logger";

export interface ChunkInput {
  chunkIndex: number;
  sectionCategory: SectionCategory;
  sectionName: string;
  parseMethod: ParseMethod;
  chunkText: string;
  charCount: number;
  /** E1 片段定位：起始页码（页界不可得为 null）。 */
  page: number | null;
  /** E1: chunk 在 filteredText 坐标系的 [start, end)。节路径精确。 */
  charStart: number | null;
  charEnd: number | null;
  embedding: number[];
  /** PDF file mtime (ms) when this chunk was indexed. Used by isIndexFresh
   *  to detect PDF replacements and trigger rebuilds. */
  pdfMtime: number;
}

export interface StoredChunk {
  id: number;
  itemId: number;
  chunkIndex: number;
  sectionCategory: SectionCategory;
  sectionName: string;
  parseMethod: ParseMethod;
  chunkText: string;
  charCount: number;
  page: number | null;
  charStart: number | null;
  charEnd: number | null;
}

const IN_CLAUSE_LIMIT = 900;

class PdfChunkStoreClass {
  private initialized = false;
  private dimension = 1536;
  private index: VectorIndex | null = null;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await Zotero.DB.executeTransaction(async () => {
        await Zotero.DB.queryAsync(`
          CREATE TABLE IF NOT EXISTS zsearch_pdf_chunks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            item_id INTEGER NOT NULL,
            chunk_index INTEGER NOT NULL,
            section_category TEXT,
            section_name TEXT,
            parse_method TEXT NOT NULL DEFAULT 'section',
            chunk_text TEXT NOT NULL,
            char_count INTEGER NOT NULL,
            embedding BLOB NOT NULL,
            model TEXT NOT NULL,
            dimension INTEGER NOT NULL,
            pdf_mtime INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            UNIQUE(item_id, chunk_index, model)
          )
        `);
        // Migration for tables created before pdf_mtime existed. ALTER TABLE
        // has no IF NOT EXISTS in SQLite, so use PRAGMA table_info to check.
        const cols = await Zotero.DB.queryAsync(
          `PRAGMA table_info(zsearch_pdf_chunks)`,
        );
        const hasMtime = (cols as unknown[])?.some(
          (c: any) => c.name === "pdf_mtime",
        );
        if (!hasMtime) {
          await Zotero.DB.queryAsync(
            `ALTER TABLE zsearch_pdf_chunks ADD COLUMN pdf_mtime INTEGER NOT NULL DEFAULT 0`,
          );
        }
        // E1 片段定位（拍板③）：page/char_start/char_end 可空列。旧行保持
        // NULL（条目级定位），索引器重跑（mtime 变化/手动重建/回填）时补齐。
        const colNames = new Set(
          (cols as unknown[] as any[]).map((c) => c.name),
        );
        let addedPageColumns = false;
        for (const col of ["page", "char_start", "char_end"] as const) {
          if (!colNames.has(col)) {
            await Zotero.DB.queryAsync(
              `ALTER TABLE zsearch_pdf_chunks ADD COLUMN ${col} INTEGER`,
            );
            addedPageColumns = true;
          }
        }
        if (addedPageColumns) {
          // 一次性打开全库重建闸门：让下一次「Build Full-Text Index」实际
          // 跑起来，走 indexer 的免重嵌入回填路径把存量 chunk 页码补齐。
          try {
            const { setPrefDynamic } = await import("../../utils/prefs");
            await setPrefDynamic("pdfIndexer.lastFullTextVersion", 0);
          } catch (e) {
            safeDebug(
              `[z-search] PdfChunkStore: reopen full-build gate failed (non-fatal): ${e}`,
            );
          }
        }
        await Zotero.DB.queryAsync(
          `CREATE INDEX IF NOT EXISTS idx_pdf_chunks_item ON zsearch_pdf_chunks(item_id)`,
        );
        await Zotero.DB.queryAsync(
          `CREATE INDEX IF NOT EXISTS idx_pdf_chunks_category ON zsearch_pdf_chunks(section_category)`,
        );
        await Zotero.DB.queryAsync(
          `CREATE INDEX IF NOT EXISTS idx_pdf_chunks_model ON zsearch_pdf_chunks(model)`,
        );
      });

      // NOTE: the in-memory index is NOT created here. Its dimension is
      // inferred from the first real embedding (storeChunks) or from the
      // DB rows (loadIndexFromDB). This avoids depending on
      // EmbeddingsManager.getModelInfo().dimension, which is looked up per
      // model (LOCAL_MODEL_DIMENSIONS / API_MODEL_DIMENSIONS tables, default
      // 384) and may be unavailable during config transitions.
      this.initialized = true;
    } catch (e) {
      safeDebug(`[z-search] PdfChunkStore initialize error: ${e}`);
      throw e;
    }
  }

  /**
   * Lazily create or rebuild the in-memory index to match the given
   * dimension. Called from storeChunks (first embedding seen) and
   * loadIndexFromDB (dimension read from DB rows).
   */
  private ensureIndex(dimension: number): void {
    if (!this.index) {
      this.dimension = dimension;
      this.index = new InMemoryMatrixIndex(dimension);
    } else if (this.dimension !== dimension) {
      safeDebug(
        `[z-search] PdfChunkStore: dimension changed ${this.dimension} → ${dimension}, rebuilding index`,
      );
      this.dimension = dimension;
      this.index = new InMemoryMatrixIndex(dimension);
    }
  }

  getIndex(): VectorIndex {
    if (!this.initialized) {
      throw new Error(
        "PdfChunkStore not initialized — call initialize() first",
      );
    }
    if (!this.index) {
      // No data has been stored/loaded yet — return an empty index with
      // default dimension so search returns [] instead of throwing.
      this.index = new InMemoryMatrixIndex(this.dimension);
    }
    return this.index;
  }

  /**
   * Rebuild the in-memory index from DB for the given model. Called on
   * startup and after model-change rebuilds.
   *
   * Tries a binary cache file first (single bulk read via
   * VectorIndex.deserialize), validated against the live DB row count. On a
   * count mismatch (chunks added/removed since last start) it falls back to
   * the per-row SQL decode path and refreshes the cache for next time. This
   * avoids the former O(N) per-row blobToFloat32 allocation storm at cold start.
   */
  async loadIndexFromDB(model: string): Promise<void> {
    // Fast path: try the binary cache if it exists and matches the DB row count.
    const cachePath = PathUtils.join(
      Zotero.DataDirectory.dir,
      `leadero-vector-${this.sanitizeModelName(model)}.bin`,
    );
    const liveCount = await this.countChunksForModel(model);
    if (liveCount === 0) return;

    try {
      // The binary cache only stores a brute-force matrix; for large corpora we
      // want IVF instead, so skip the cache and take the SQL+IVF path below.
      if (liveCount < IVF_MIN_VECTORS && (await IOUtils.exists(cachePath))) {
        const meta = await this.readCacheMeta(cachePath);
        if (meta && meta.count === liveCount && meta.model === model) {
          // Dimension must agree with what the DB would report.
          const sampleDim = await this.sampleDimension(model);
          if (sampleDim && sampleDim === meta.dimension) {
            this.ensureIndex(meta.dimension);
            this.index!.clear();
            await this.index!.deserialize(cachePath);
            return; // fast path succeeded
          }
        }
      }
    } catch (e) {
      safeDebug(
        `[z-search] loadIndexFromDB binary cache miss/fail, falling back to SQL: ${e}`,
      );
    }

    // Fallback: per-row SQL decode (the original path).
    const rows = await Zotero.DB.queryAsync(
      `SELECT id, item_id, section_category, embedding, dimension FROM zsearch_pdf_chunks WHERE model = ?`,
      [model],
    );
    if (!rows || rows.length === 0) return;

    // Dimension is inferred from DB rows (authoritative source), NOT from
    // EmbeddingsManager.getModelInfo() which is looked up per model and may
    // be 0 during config transitions.
    // Text-only rows (empty blob, dimension 0) carry no vector — filter them
    // out so the index dimension is learned from a vector-bearing row.
    const vectorRows = (rows as any[]).filter(
      (r) => r.dimension > 0 && r.embedding && r.embedding.length > 0,
    );
    if (vectorRows.length === 0) return;
    const dim: number = vectorRows[0].dimension;
    this.dimension = dim;

    // Large corpora use IVF (approximate, clustered) for sub-linear search;
    // small ones use exact brute-force (overhead of k-means isn't worth it).
    // The binary cache is only written for the brute-force path (IVF rebuilds
    // from entries lazily and has no deserialize).
    const useIVF = rows.length >= IVF_MIN_VECTORS;
    if (useIVF) {
      this.index = new IVFIndex(dim);
    } else {
      this.ensureIndex(dim);
    }
    this.index!.clear();

    for (const r of vectorRows) {
      const meta: IndexEntry = {
        itemId: r.item_id,
        sectionCategory: r.section_category ?? undefined,
      };
      const vec = this.blobToFloat32(r.embedding);
      if (vec.length === 0) continue; // text-only row
      this.index!.add(r.id, vec, meta);
    }

    // Refresh the binary cache for the next cold start (brute-force path only).
    if (!useIVF) {
      try {
        await this.index!.serialize(cachePath);
        await this.writeCacheMeta(cachePath, {
          model,
          count: rows.length,
          dimension: dim,
        });
      } catch (e) {
        safeDebug(
          `[z-search] loadIndexFromDB cache write failed (non-fatal): ${e}`,
        );
      }
    }
  }

  /** Row count for a model — used to validate the binary cache. */
  private async countChunksForModel(model: string): Promise<number> {
    const c = await Zotero.DB.columnQueryAsync(
      `SELECT COUNT(*) FROM zsearch_pdf_chunks WHERE model = ?`,
      [model],
    );
    return Number(c) || 0;
  }

  /** Read one row's dimension to validate cache dimension header. */
  private async sampleDimension(model: string): Promise<number | null> {
    const rows = await Zotero.DB.queryAsync(
      `SELECT dimension FROM zsearch_pdf_chunks WHERE model = ? LIMIT 1`,
      [model],
    );
    if (!rows || rows.length === 0) return null;
    return rows[0].dimension as number;
  }

  private sanitizeModelName(model: string): string {
    // Filesystem-safe cache suffix (model names contain slashes/colons).
    return model.replace(/[^a-zA-Z0-9_-]/g, "_");
  }

  /** Sidecar metadata for the binary cache: { model, count, dimension }. */
  private async readCacheMeta(
    cachePath: string,
  ): Promise<{ model: string; count: number; dimension: number } | null> {
    const metaPath = cachePath + ".meta.json";
    try {
      if (!(await IOUtils.exists(metaPath))) return null;
      const text = await IOUtils.readUTF8(metaPath);
      return JSON.parse(text);
    } catch (e) {
      safeDebug(
        "[z-search] PdfChunkStore.readCacheMeta(" +
          cachePath +
          ") failed: " +
          e,
      );
      return null;
    }
  }

  private async writeCacheMeta(
    cachePath: string,
    meta: { model: string; count: number; dimension: number },
  ): Promise<void> {
    const metaPath = cachePath + ".meta.json";
    await IOUtils.writeUTF8(metaPath, JSON.stringify(meta));
  }

  private float32ToBlob(vector: number[] | Float32Array): Uint8Array {
    const arr =
      vector instanceof Float32Array ? vector : new Float32Array(vector);
    return new Uint8Array(arr.buffer.slice(0));
  }

  private blobToFloat32(blob: any): Float32Array {
    const uint8 = blob instanceof Uint8Array ? blob : new Uint8Array(blob);
    return new Float32Array(uint8.buffer.slice(0));
  }

  // ── BM25 (FTS5) sync hooks ──
  // PdfChunkStore is the single writer to zsearch_pdf_chunks, so FTS sync
  // lives here. All hooks are non-fatal: an FTS failure must never break the
  // primary indexing path; BM25Index.ensureFresh's count+max(id) check
  // repairs any drift on the next keyword search.

  private async syncBm25Remove(chunkIds: number[]): Promise<void> {
    try {
      await bm25Index.removeRows(chunkIds);
    } catch (e) {
      // F-30（回退审计 2026-09-11）：chunk 事务已提交而 FTS 镜像失同步——
      // 置 drift 标记让下次关键词搜索强制 rebuild，而非依赖探针漏检窗口。
      bm25Index.markDrifted();
      safeDebug(
        `[z-search] PdfChunkStore: BM25 remove sync failed (drift flagged): ${e}`,
      );
    }
  }

  private async syncBm25Upsert(
    rows: Array<{
      id: number;
      itemId: number;
      sectionCategory?: string | null;
      chunkText: string;
    }>,
  ): Promise<void> {
    try {
      await bm25Index.upsertRows(rows);
    } catch (e) {
      // F-30：同上——upsert 失败即标记漂移（含 BM25Index 内部 catch 前抛出
      // 的异常路径；内部已吞的失败由其自身 ftsDrift 覆盖）。
      bm25Index.markDrifted();
      safeDebug(
        `[z-search] PdfChunkStore: BM25 upsert sync failed (drift flagged): ${e}`,
      );
    }
  }

  /**
   * BM25 keyword search over chunk texts (FTS5 in the external leadero DB).
   * Degrades to [] when FTS5 is unavailable, the index is stale beyond
   * repair, or nothing matches — callers treat [] as "no hits".
   */
  async searchByKeyword(
    query: string,
    topK: number,
    sectionCategory?: string,
  ): Promise<
    Array<{
      chunkId: number;
      itemId: number;
      score: number;
      sectionCategory?: string;
    }>
  > {
    return bm25Index.search(query, topK, sectionCategory);
  }

  /**
   * Chunk count across ALL models — the gate for retrieval='bm25': the text
   * index is embedding-model-independent, so unlike the vector path it must
   * not require chunks for the *current* model.
   */
  async countAllChunks(): Promise<number> {
    const rows = await Zotero.DB.queryAsync(
      `SELECT COUNT(*) AS n FROM zsearch_pdf_chunks`,
    );
    return Number(rows?.[0]?.n) || 0;
  }

  /**
   * Replace all chunks for an item. Existing rows are deleted in a single
   * transaction with the new inserts so partial failures cannot leave a
   * mixed old/new state.
   *
   * The in-memory index is updated AFTER the transaction commits:
   * 1. Remove old chunk ids for this item
   * 2. Re-read fresh rows from DB and add to index
   */
  async storeChunks(
    itemId: number,
    model: string,
    chunks: ChunkInput[],
  ): Promise<void> {
    if (!this.initialized) {
      throw new Error("PdfChunkStore not initialized");
    }

    // Text-only chunks (empty embedding) carry no vector — the cosine index
    // must not learn a bogus dimension from them. Mixed batches (shouldn't
    // happen today, but be safe) establish the dimension from the first
    // vector-bearing chunk.
    const vectorChunks = chunks.filter((c) => c.embedding.length > 0);
    if (vectorChunks.length > 0) {
      this.ensureIndex(vectorChunks[0].embedding.length);
    }
    if (vectorChunks.length > 0 && !this.index) {
      throw new Error("PdfChunkStore index unavailable after ensureIndex");
    }

    const existingIds = await this.getChunkIdsForItem(itemId, model);

    const now = Date.now();
    await Zotero.DB.executeTransaction(async () => {
      await Zotero.DB.queryAsync(
        `DELETE FROM zsearch_pdf_chunks WHERE item_id = ? AND model = ?`,
        [itemId, model],
      );
      // Batch INSERT: 100 chunks per statement to reduce SQL round-trips
      // 16 columns (incl. E1's page/char_start/char_end) — placeholder count
      // MUST match; a mismatch aborts the whole batch statement.
      const INSERT_CHUNK = Math.max(1, Math.floor(900 / 16)); // 16 columns → 56
      const ROW_PLACEHOLDERS = "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)";
      for (let i = 0; i < chunks.length; i += INSERT_CHUNK) {
        const batch = chunks.slice(i, i + INSERT_CHUNK);
        const rowPh = batch.map(() => ROW_PLACEHOLDERS).join(",");
        const params = batch.flatMap((c) => [
          itemId,
          c.chunkIndex,
          c.sectionCategory,
          c.sectionName,
          c.parseMethod,
          c.chunkText,
          c.charCount,
          // Text-only chunks (empty embedding) are stored as a 4-byte zero
          // sentinel with dimension=0. mozStorage binds a 0-length blob as
          // SQL NULL, which the embedding NOT NULL constraint rejects — the
          // sentinel keeps the row legal while remaining un-indexable
          // (all text-only filters key on dimension === 0).
          c.embedding.length > 0
            ? this.float32ToBlob(c.embedding)
            : new Uint8Array(4),
          model,
          c.embedding.length,
          c.pdfMtime,
          c.page,
          c.charStart,
          c.charEnd,
          now,
          now,
        ]);
        await Zotero.DB.queryAsync(
          `INSERT INTO zsearch_pdf_chunks
             (item_id, chunk_index, section_category, section_name, parse_method,
              chunk_text, char_count, embedding, model, dimension, pdf_mtime,
              page, char_start, char_end, created_at, updated_at)
           VALUES ${rowPh}`,
          params,
        );
      }
    });

    // Sync indexes: remove old, add new (post-commit so we read consistent rows)
    for (const id of existingIds) {
      this.index?.remove(id);
    }
    const freshRows = await Zotero.DB.queryAsync(
      `SELECT id, section_category, embedding, dimension, chunk_text FROM zsearch_pdf_chunks WHERE item_id = ? AND model = ?`,
      [itemId, model],
    );
    if (freshRows) {
      for (const r of freshRows) {
        // Text-only chunk (dimension 0 sentinel blob) — BM25-only rows carry
        // no vector and must stay out of the cosine index.
        if (!r.dimension || r.dimension === 0) continue;
        const meta: IndexEntry = {
          itemId,
          sectionCategory: r.section_category ?? undefined,
        };
        this.index?.add(r.id, this.blobToFloat32(r.embedding), meta);
      }
    }
    await this.syncBm25Remove(existingIds);
    await this.syncBm25Upsert(
      (freshRows || []).map((r: any) => ({
        id: r.id,
        itemId,
        sectionCategory: r.section_category,
        chunkText: r.chunk_text,
      })),
    );
  }

  async getChunkIdsForItem(itemId: number, model: string): Promise<number[]> {
    const rows = await Zotero.DB.queryAsync(
      `SELECT id FROM zsearch_pdf_chunks WHERE item_id = ? AND model = ?`,
      [itemId, model],
    );
    return (rows || []).map((r: any) => r.id);
  }

  async hasChunks(itemId: number, model: string): Promise<boolean> {
    const rows = await Zotero.DB.queryAsync(
      `SELECT 1 FROM zsearch_pdf_chunks WHERE item_id = ? AND model = ? LIMIT 1`,
      [itemId, model],
    );
    return !!(rows && rows.length > 0);
  }

  /**
   * E1 回填前置：该条目（item, model）下页码缺失（page IS NULL）的 chunk 数。
   */
  async countChunksWithoutPage(itemId: number, model: string): Promise<number> {
    const rows = await Zotero.DB.queryAsync(
      `SELECT COUNT(*) AS n FROM zsearch_pdf_chunks
       WHERE item_id = ? AND model = ? AND page IS NULL`,
      [itemId, model],
    );
    return rows?.[0]?.n ?? 0;
  }

  /**
   * E1 回填：按 chunk_index 原位补写页码与字符区间。返回受影响行数
   * （queryAsync 对 UPDATE 的返回形态二态：纯数字或 {rowsAffected}）。
   */
  async updateChunkLocation(
    itemId: number,
    model: string,
    chunkIndex: number,
    page: number,
    charStart: number | null,
    charEnd: number | null,
  ): Promise<number> {
    const r = await Zotero.DB.queryAsync(
      `UPDATE zsearch_pdf_chunks
       SET page = ?, char_start = ?, char_end = ?, updated_at = ?
       WHERE item_id = ? AND model = ? AND chunk_index = ?`,
      [page, charStart, charEnd, Date.now(), itemId, model, chunkIndex],
    );
    return typeof r === "number"
      ? r
      : ((r as { rowsAffected?: number } | null)?.rowsAffected ?? 0);
  }

  /**
   * Check whether chunks exist for (itemId, model) AND their pdf_mtime
   * matches the current PDF file's mtime.
   *
   * Returns false in any of these cases (each triggers a rebuild):
   *  - no chunks stored yet
   *  - pdfMtime is 0 (caller couldn't read attachment mtime — fail safe)
   *  - stored mtime is 0 (legacy rows from before pdf_mtime column existed)
   *  - mtimes differ (PDF was replaced, OCR'd, or otherwise modified)
   */
  async isIndexFresh(
    itemId: number,
    model: string,
    pdfMtime: number,
  ): Promise<boolean> {
    if (!pdfMtime) return false;
    const rows = await Zotero.DB.queryAsync(
      `SELECT pdf_mtime FROM zsearch_pdf_chunks WHERE item_id = ? AND model = ? LIMIT 1`,
      [itemId, model],
    );
    if (!rows || rows.length === 0) return false;
    const stored: number = rows[0].pdf_mtime;
    if (!stored) return false; // legacy row, force rebuild
    return stored === pdfMtime;
  }

  /**
   * Fetch full chunk rows by DB id. Used after search to retrieve the
   * matched chunk_text for result snippets.
   */
  async getChunksByIds(ids: number[]): Promise<StoredChunk[]> {
    if (ids.length === 0) return [];
    const out: StoredChunk[] = [];
    for (let i = 0; i < ids.length; i += IN_CLAUSE_LIMIT) {
      const batch = ids.slice(i, i + IN_CLAUSE_LIMIT);
      const placeholders = batch.map(() => "?").join(",");
      const rows = await Zotero.DB.queryAsync(
        `SELECT id, item_id, chunk_index, section_category, section_name,
                parse_method, chunk_text, char_count, page, char_start, char_end
         FROM zsearch_pdf_chunks WHERE id IN (${placeholders})`,
        batch,
      );
      if (rows) {
        for (const r of rows) {
          out.push({
            id: r.id,
            itemId: r.item_id,
            chunkIndex: r.chunk_index,
            sectionCategory: r.section_category ?? "other",
            sectionName: r.section_name ?? "",
            parseMethod: (r.parse_method as ParseMethod) ?? "section",
            chunkText: r.chunk_text,
            charCount: r.char_count,
            page: r.page ?? null,
            charStart: r.char_start ?? null,
            charEnd: r.char_end ?? null,
          });
        }
      }
    }
    return out;
  }

  /**
   * Classification metadata read for PaperAnalyzer's targeted Methods feed
   * (P0 参数化 Methods). Returns one row per chunk_index for the item —
   * when multiple model generations coexist, rows with a non-null
   * section_category win, then the highest row id (latest write).
   * Pure metadata read: no embedding decode, no index involvement.
   */
  async getClassifiedChunksForItem(itemId: number): Promise<
    Array<{
      chunkIndex: number;
      sectionCategory: string | null;
      sectionName: string | null;
      chunkText: string;
      page: number | null;
    }>
  > {
    try {
      await this.initialize();
      const rows = (await Zotero.DB.queryAsync(
        `SELECT chunk_index, section_category, section_name, chunk_text, page
         FROM zsearch_pdf_chunks
         WHERE item_id = ?
         ORDER BY chunk_index ASC, (section_category IS NULL) ASC, id DESC`,
        [itemId],
      )) as any[];
      const byIndex = new Map<
        number,
        {
          sectionCategory: string | null;
          sectionName: string | null;
          chunkText: string;
          page: number | null;
        }
      >();
      for (const r of rows ?? []) {
        if (byIndex.has(r.chunk_index)) continue; // ORDER BY already picked the best row per index
        byIndex.set(r.chunk_index, {
          sectionCategory: r.section_category ?? null,
          sectionName: r.section_name ?? null,
          chunkText: r.chunk_text ?? "",
          page: r.page ?? null,
        });
      }
      return Array.from(byIndex.entries())
        .map(([chunkIndex, v]) => ({ chunkIndex, ...v }))
        .sort((a, b) => a.chunkIndex - b.chunkIndex);
    } catch (e) {
      safeDebug(
        `[z-search] PdfChunkStore.getClassifiedChunksForItem error: ${e}`,
      );
      return [];
    }
  }

  /**
   * Count VECTOR chunks for a model — used by the UI to estimate rebuild
   * scope and by the vector search gate. Text-only chunks (BM25-only rows,
   * dimension 0) don't count: a library indexed without embeddings must not
   * read as "vector-indexed".
   */
  async countChunks(model: string): Promise<number> {
    const rows = await Zotero.DB.queryAsync(
      `SELECT COUNT(*) as cnt FROM zsearch_pdf_chunks WHERE model = ? AND dimension > 0`,
      [model],
    );
    return rows?.[0]?.cnt ?? 0;
  }

  /**
   * Total bytes occupied by chunk_text across all rows. Used by the UI to
   * warn the user when full-text indexing is consuming too much space in
   * zotero.sqlite (which is the user's core library DB and gets backed up
   * / synced as a whole).
   *
   * Note: returns the raw SUM(LENGTH(chunk_text)) which counts UTF-16 code
   * units; actual on-disk bytes are roughly 2x for CJK-heavy text. Good
   * enough for a "is this getting too big?" warning.
   */
  async getTotalTextSize(): Promise<number> {
    const rows = await Zotero.DB.queryAsync(
      `SELECT COALESCE(SUM(LENGTH(chunk_text)), 0) as total FROM zsearch_pdf_chunks`,
    );
    return rows?.[0]?.total ?? 0;
  }

  /**
   * Detect whether any chunks exist for a model other than the current one.
   * Triggers the "model changed" warning in the UI.
   */
  async hasStaleChunks(currentModel: string): Promise<boolean> {
    const rows = await Zotero.DB.queryAsync(
      `SELECT 1 FROM zsearch_pdf_chunks WHERE model != ? LIMIT 1`,
      [currentModel],
    );
    return !!(rows && rows.length > 0);
  }

  async deleteChunks(itemId: number): Promise<void> {
    // Snapshot existing ids BEFORE the transaction so they can be removed
    // from the in-memory index AFTER commit (post-commit sync pattern,
    // same as storeChunks). Wrapping DELETE in executeTransaction matches
    // storeChunks semantics and protects against partial-failure states.
    const ids = await this.getChunkIdsForItemAllModels(itemId);
    await Zotero.DB.executeTransaction(async () => {
      await Zotero.DB.queryAsync(
        `DELETE FROM zsearch_pdf_chunks WHERE item_id = ?`,
        [itemId],
      );
    });
    if (this.index) {
      for (const id of ids) this.index.remove(id);
    }
    await this.syncBm25Remove(ids);
  }

  private async getChunkIdsForItemAllModels(itemId: number): Promise<number[]> {
    const rows = await Zotero.DB.queryAsync(
      `SELECT id FROM zsearch_pdf_chunks WHERE item_id = ?`,
      [itemId],
    );
    return (rows || []).map((r: any) => r.id);
  }

  private async getChunkIdsForModel(model: string): Promise<number[]> {
    const rows = await Zotero.DB.queryAsync(
      `SELECT id FROM zsearch_pdf_chunks WHERE model = ?`,
      [model],
    );
    return (rows || []).map((r: any) => r.id);
  }

  async deleteChunksByModel(model: string): Promise<void> {
    // Snapshot ids BEFORE the delete so the FTS mirror can drop the same rows.
    const bm25Ids = await this.getChunkIdsForModel(model);
    await Zotero.DB.queryAsync(
      `DELETE FROM zsearch_pdf_chunks WHERE model = ?`,
      [model],
    );
    // Sync before any early return below — FTS must not keep stale-model rows.
    await this.syncBm25Remove(bm25Ids);
    // Clear + repopulate index from surviving rows. DO NOT filter by
    // this.dimension — it is stale when called from prefEvents mode-switch
    // (only ensureIndex updates it, and that hasn't run for the new model
    // yet). Filtering by stale dimension would silently empty the index.
    if (!this.index) return;
    this.index.clear();
    const rows = await Zotero.DB.queryAsync(
      `SELECT id, item_id, section_category, embedding, dimension
       FROM zsearch_pdf_chunks WHERE model != ?`,
      [model],
    );
    if (!rows || rows.length === 0) return;

    // InMemoryMatrixIndex is single-dimension; rebuild to match the first
    // surviving row. In practice users have one active model so all rows
    // share the same dimension. Mixed-dimension leftovers (rare) are skipped
    // to keep the index consistent.
    const firstDim: number = rows[0].dimension;
    this.ensureIndex(firstDim);
    for (const r of rows) {
      if (r.dimension !== firstDim) continue;
      this.index!.add(r.id, this.blobToFloat32(r.embedding), {
        itemId: r.item_id,
        sectionCategory: r.section_category ?? undefined,
      });
    }
  }

  /**
   * Remove chunks whose item_id no longer exists in the items table.
   *
   * Covers two scenarios:
   *  1. Parent item deleted — Zotero's item-delete notifier may pass only
   *     attachment IDs (item_id column stores parentID), so deleteChunks(id)
   *     is a no-op for those notifications.
   *  2. Library sync/restore that removed items out-of-band.
   *
   * Idempotent and safe to call repeatedly. Returns the number of orphaned
   * chunk rows removed.
   */
  async deleteOrphans(): Promise<number> {
    if (!this.initialized) return 0;

    const orphanRows = await Zotero.DB.queryAsync(
      `SELECT id FROM zsearch_pdf_chunks
       WHERE item_id NOT IN (SELECT itemID FROM items)`,
    );
    if (!orphanRows || orphanRows.length === 0) return 0;

    const orphanIds: number[] = orphanRows.map((r: any) => r.id);

    // Commit DB DELETE first, THEN update memory index — same post-commit
    // pattern as storeChunks. If we did it in the opposite order and the
    // transaction failed (disk full / DB lock), the in-memory index would
    // be missing rows that are still in the DB, producing inconsistent
    // state until next restart.
    await Zotero.DB.executeTransaction(async () => {
      for (let i = 0; i < orphanIds.length; i += IN_CLAUSE_LIMIT) {
        const batch = orphanIds.slice(i, i + IN_CLAUSE_LIMIT);
        const placeholders = batch.map(() => "?").join(",");
        await Zotero.DB.queryAsync(
          `DELETE FROM zsearch_pdf_chunks WHERE id IN (${placeholders})`,
          batch,
        );
      }
    });

    if (this.index) {
      for (const id of orphanIds) this.index.remove(id);
    }
    await this.syncBm25Remove(orphanIds);

    return orphanIds.length;
  }
}

export default new PdfChunkStoreClass();
export { PdfChunkStoreClass };
