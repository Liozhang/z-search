/**
 * PdfChunkStore — persistence + in-memory index for PDF full-text chunks.
 *
 * Each chunk is a slice of a paper's extracted text (one per section, or
 * fixed-size blocks when section parsing falls back). Chunk text and metadata
 * stay in the MAIN zotero.sqlite (zsearch_pdf_chunks, the source of truth for
 * rows); the vector BLOB of every chunk lives in the EXTERNAL file
 * zsearch_pdf_vectors.sqlite, keyed by chunk id.
 *
 * Why vectors are external（自 leadero #34 搬入，见
 * docs/optimization-from-siblings-2026-09-30.md 第 3 项）：Zotero 每周期都会
 * 备份并整理用户的主库 zotero.sqlite，大二进制放主库会放大备份与 VACUUM
 * 代价。FTS5 表无法搬（fts5 模块只注册在主连接上），向量可以搬，所以搬。
 * 存量内联向量走惰性迁移：读旧列 → 写外置 → 字节校验 → 清空旧列（4 字节
 * 零哨兵）。
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
import { getExternalDb } from "../task/externalDb";

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

// ── 外部向量库（自 leadero #34 搬入）──
// 与 EmbeddingStore 的 zsearch_embeddings.sqlite 同一先例：profile 目录下
// 的独立 sqlite 文件，经 externalDb.getExternalDb 取共享连接。
const PDF_VECTOR_DB_FILE = "zsearch_pdf_vectors.sqlite";
// chunk_id 逻辑上引用主库 zsearch_pdf_chunks.id。跨文件建不了外键，一致性由
// 本类作为两张表的唯一写入者维护（与 zsearch_chunks_fts 的同步钩子同一先例）。
const PDF_VECTOR_TABLE = "zsearch_pdf_chunk_vectors";
// 外部向量表列数（chunk_id, embedding, dimension, created_at, updated_at）：
// 多行 INSERT 每语句行数 = floor(900 / 5) = 180，守住变量数 ≤ 999 红线。
const PDF_VECTOR_INSERT_BATCH = Math.floor(IN_CLAUSE_LIMIT / 5);

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

      // 外部向量库建表（失败与主库初始化同样上抛）。外部连接不继承
      // busy_timeout（见 EmbeddingStore.initialize），须自行设置。
      const extConn = this.extConn();
      await extConn.queryAsync("PRAGMA busy_timeout = 5000", []);
      await extConn.executeTransaction(async () => {
        await extConn.queryAsync(`
          CREATE TABLE IF NOT EXISTS ${PDF_VECTOR_TABLE} (
            chunk_id INTEGER PRIMARY KEY,
            embedding BLOB NOT NULL,
            dimension INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          )
        `);
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

  // ── 外部向量库（自 leadero #34 搬入）──

  private extConn(): any {
    return getExternalDb(PDF_VECTOR_DB_FILE);
  }

  /** 把向量批量写入外部库（INSERT OR REPLACE，重试幂等），失败抛出。 */
  private async writeVectorsExternal(
    pairs: Array<{
      id: number;
      embedding: number[] | Float32Array | Uint8Array;
    }>,
  ): Promise<void> {
    if (pairs.length === 0) return;
    const conn = this.extConn();
    const now = Date.now();
    const ROW_PH = "(?,?,?,?,?)";
    await conn.executeTransaction(async () => {
      for (let i = 0; i < pairs.length; i += PDF_VECTOR_INSERT_BATCH) {
        const batch = pairs.slice(i, i + PDF_VECTOR_INSERT_BATCH);
        const rowPh = batch.map(() => ROW_PH).join(",");
        const params = batch.flatMap((p) => [
          p.id,
          this.float32ToBlob(p.embedding),
          p.embedding.length,
          now,
          now,
        ]);
        await conn.queryAsync(
          `INSERT OR REPLACE INTO ${PDF_VECTOR_TABLE} (chunk_id, embedding, dimension, created_at, updated_at) VALUES ${rowPh}`,
          params,
        );
      }
    });
  }

  /**
   * 删除外部库中对应 chunk 的向量。非致命：失败只记录——chunk_id 由主库
   * AUTOINCREMENT 分配且不复用，孤儿外部行不会被任何读取路径命中，只是
   * 占一点磁盘空间。
   */
  private async deleteVectorsExternal(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    try {
      const conn = this.extConn();
      await conn.executeTransaction(async () => {
        for (let i = 0; i < ids.length; i += IN_CLAUSE_LIMIT) {
          const batch = ids.slice(i, i + IN_CLAUSE_LIMIT);
          const ph = batch.map(() => "?").join(",");
          await conn.queryAsync(
            `DELETE FROM ${PDF_VECTOR_TABLE} WHERE chunk_id IN (${ph})`,
            batch,
          );
        }
      });
    } catch (e) {
      safeDebug(
        `[z-search] PdfChunkStore: external vector delete failed (non-fatal): ${e}`,
      );
    }
  }

  /** 逐字节比较（惰性迁移的回读校验）：长度一致且每个字节相等。 */
  private bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  /**
   * 按 chunk id 批量取向量（读路径统一入口）。向量真身在外置库
   * zsearch_pdf_vectors.sqlite；存量行的向量仍在主库旧列时惰性迁移：
   * 读旧列 → 写外置 → 回读字节校验 → 校验通过才清空旧列（4 字节零哨兵，
   * 与文本型 chunk 的哨兵同形）。校验不通过或外置写失败时保留旧列数据
   * 照常返回（下次读取重试迁移）；全部失败非致命。
   */
  private async fetchVectorsByIds(
    ids: number[],
  ): Promise<Map<number, Float32Array>> {
    const out = new Map<number, Float32Array>();
    if (ids.length === 0) return out;
    const conn = this.extConn();
    const found = new Set<number>();
    for (let i = 0; i < ids.length; i += IN_CLAUSE_LIMIT) {
      const batch = ids.slice(i, i + IN_CLAUSE_LIMIT);
      const ph = batch.map(() => "?").join(",");
      const rows = await conn.queryAsync(
        `SELECT chunk_id, embedding FROM ${PDF_VECTOR_TABLE} WHERE chunk_id IN (${ph})`,
        batch,
      );
      for (const r of rows || []) {
        if (this.toUint8(r.embedding).length > 4) {
          out.set(r.chunk_id, this.blobToFloat32(r.embedding));
          found.add(r.chunk_id);
        }
      }
    }

    // 惰性迁移：外置库没有的 id → 主库旧列还留着真向量的话搬过去。
    const missing = ids.filter((id) => !found.has(id));
    if (missing.length === 0) return out;
    for (let i = 0; i < missing.length; i += IN_CLAUSE_LIMIT) {
      const batch = missing.slice(i, i + IN_CLAUSE_LIMIT);
      const ph = batch.map(() => "?").join(",");
      const inlineRows = (await Zotero.DB.queryAsync(
        `SELECT id, embedding, dimension FROM zsearch_pdf_chunks WHERE id IN (${ph}) AND dimension > 0`,
        batch,
      )) as any[];
      const candidates = (inlineRows || [])
        .filter((r) => this.toUint8(r.embedding).length > 4)
        .map((r) => ({ id: r.id, inline: this.toUint8(r.embedding) }));
      if (candidates.length === 0) continue;
      try {
        await this.writeVectorsExternal(
          candidates.map((c) => ({ id: c.id, embedding: c.inline })),
        );
        // 回读校验：只清空校验通过的行；不通过保留旧列下次重试。
        const verifiedIds: number[] = [];
        for (const c of candidates) {
          const back = await conn.queryAsync(
            `SELECT embedding FROM ${PDF_VECTOR_TABLE} WHERE chunk_id = ?`,
            [c.id],
          );
          const backBytes = back?.[0] ? this.toUint8(back[0].embedding) : null;
          if (backBytes && this.bytesEqual(backBytes, c.inline)) {
            verifiedIds.push(c.id);
            out.set(c.id, this.blobToFloat32(c.inline));
          }
        }
        if (verifiedIds.length > 0) {
          const vph = verifiedIds.map(() => "?").join(",");
          await Zotero.DB.queryAsync(
            `UPDATE zsearch_pdf_chunks SET embedding = ? WHERE id IN (${vph})`,
            [new Uint8Array(4), ...verifiedIds],
          );
        }
      } catch (e) {
        // 迁移失败非致命：外置读不到就退回旧列（本轮已加入 out 的不变）。
        safeDebug(
          `[z-search] PdfChunkStore: lazy inline-vector migration failed (non-fatal): ${e}`,
        );
        for (const c of candidates) {
          if (!out.has(c.id)) out.set(c.id, this.blobToFloat32(c.inline));
        }
      }
    }
    return out;
  }

  /** 把 BLOB 归一成 Uint8Array（宿主可能返回 ArrayBuffer 或 Uint8Array）。 */
  private toUint8(v: any): Uint8Array {
    return v instanceof Uint8Array ? v : new Uint8Array(v);
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
      `zsearch-vector-${this.sanitizeModelName(model)}.bin`,
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

    // Fallback: per-row SQL decode (the original path). 向量外置后主库读取
    // 只供 id/元数据/维度，向量由 fetchVectorsByIds 从外置库供给（存量内联
    // 向量在该路径上惰性迁移）。
    const rows = await Zotero.DB.queryAsync(
      `SELECT id, item_id, section_category, dimension FROM zsearch_pdf_chunks WHERE model = ?`,
      [model],
    );
    if (!rows || rows.length === 0) return;

    // Dimension is inferred from DB rows (authoritative source), NOT from
    // EmbeddingsManager.getModelInfo() which is looked up per model and may
    // be 0 during config transitions.
    // Text-only rows (dimension 0) carry no vector — filter them out so the
    // index dimension is learned from a vector-bearing row.
    const vectorRows = (rows as any[]).filter((r) => r.dimension > 0);
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

    const vecById = await this.fetchVectorsByIds(vectorRows.map((r) => r.id));
    let added = 0;
    for (const r of vectorRows) {
      const vec = vecById.get(r.id);
      if (!vec || vec.length === 0) continue; // 向量不可得的行（待迁移/待重建）
      const meta: IndexEntry = {
        itemId: r.item_id,
        sectionCategory: r.section_category ?? undefined,
      };
      this.index!.add(r.id, vec, meta);
      added++;
    }

    // Refresh the binary cache for the next cold start (brute-force path only).
    // 外置库读取不完整时（迁移中/临时故障）不写缓存——计数校验按主库行数
    // 在下次启动依旧通过，残缺缓存会让幽灵向量跨启动复活。
    if (!useIVF && added === vectorRows.length) {
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

  private float32ToBlob(
    vector: number[] | Float32Array | Uint8Array,
  ): Uint8Array {
    // 惰性迁移传入的已是 float32 字节的 Uint8Array，直接落库。
    if (vector instanceof Uint8Array) return vector;
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
   * BM25 keyword search over chunk texts (FTS5 in the external plugin DB).
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
   * mixed old/new state. 向量外置后：主库行一律落 4 字节零哨兵（真向量不再
   * 进主库），主库事务提交后按新行 id 把向量批量写入外部库；外部写失败则
   * 补偿删除刚提交的主库行（条目回到「未索引」态，由下次构建重建），避免
   * 留下有 dimension 而无向量的行。
   *
   * The in-memory index is updated AFTER the transaction commits:
   * 1. Remove old chunk ids for this item
   * 2. Add the new chunk ids with their input vectors
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
      // （向量外置：embedding 列对所有行落 4 字节零哨兵——mozStorage 把
      // 0 长度 blob 绑成 SQL NULL 会被 NOT NULL 拒绝；dimension 列写真值，
      // countChunks 等按 dimension>0 判定「有向量」的闸门不受影响。）
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
          new Uint8Array(4), // 向量在外置库；主库哨兵占位
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

    // Fresh rows supply the AUTOINCREMENT ids the external vectors key on.
    const freshRows = await Zotero.DB.queryAsync(
      `SELECT id, chunk_index, section_category, dimension, chunk_text FROM zsearch_pdf_chunks WHERE item_id = ? AND model = ?`,
      [itemId, model],
    );

    // Pair fresh ids with input vectors via chunk_index (UNIQUE(item_id,
    // chunk_index, model) makes the mapping unambiguous within this write).
    const vecByChunkIndex = new Map<number, number[]>();
    for (const c of chunks) {
      if (c.embedding.length > 0)
        vecByChunkIndex.set(c.chunkIndex, c.embedding);
    }
    const idVecPairs: Array<{ id: number; embedding: number[] }> = [];
    for (const r of (freshRows || []) as any[]) {
      if (!r.dimension || r.dimension === 0) continue; // 文本型 chunk 无向量
      const vec = vecByChunkIndex.get(r.chunk_index);
      if (vec) idVecPairs.push({ id: r.id, embedding: vec });
    }

    if (idVecPairs.length > 0) {
      try {
        await this.writeVectorsExternal(idVecPairs);
      } catch (e) {
        // 外部库写失败：补偿删除刚提交的主库行，让条目回到「未索引」态
        // （isIndexFresh → false → 下次重建），绝不留下 dimension>0 而无向量
        // 的行——那会让向量检索对该条目永久静默漏检。主库补偿删除失败时
        // 同样兜底记录，但异常照原样上抛给调用方。
        try {
          await Zotero.DB.executeTransaction(async () => {
            await Zotero.DB.queryAsync(
              `DELETE FROM zsearch_pdf_chunks WHERE item_id = ? AND model = ?`,
              [itemId, model],
            );
          });
        } catch (e2) {
          safeDebug(
            `[z-search] PdfChunkStore: compensating delete after external vector write failure also failed: ${e2}`,
          );
        }
        for (const id of existingIds) {
          this.index?.remove(id);
        }
        await this.syncBm25Remove(existingIds);
        throw e;
      }
    }

    // Sync indexes: remove old, add new (post-commit so we read consistent rows)
    for (const id of existingIds) {
      this.index?.remove(id);
    }
    const metaById = new Map<number, string | null | undefined>();
    for (const r of (freshRows || []) as any[]) {
      metaById.set(r.id, r.section_category);
    }
    for (const p of idVecPairs) {
      this.index?.add(p.id, new Float32Array(p.embedding), {
        itemId,
        sectionCategory: metaById.get(p.id) ?? undefined,
      });
    }
    await this.syncBm25Remove(existingIds);
    await this.syncBm25Upsert(
      ((freshRows || []) as any[]).map((r) => ({
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
    // 外部向量库同步清理（失败非致命，见 deleteVectorsExternal）。
    await this.deleteVectorsExternal(ids);
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
    // 被删模型的外部向量同步清理（失败非致命，见 deleteVectorsExternal）。
    await this.deleteVectorsExternal(bm25Ids);
    // Clear + repopulate index from surviving rows. DO NOT filter by
    // this.dimension — it is stale when called from prefEvents mode-switch
    // (only ensureIndex updates it, and that hasn't run for the new model
    // yet). Filtering by stale dimension would silently empty the index.
    if (!this.index) return;
    this.index.clear();
    const rows = await Zotero.DB.queryAsync(
      `SELECT id, item_id, section_category, dimension
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
    const survivors = (rows as any[]).filter(
      (r) => r.dimension === firstDim && firstDim > 0,
    );
    const vecById = await this.fetchVectorsByIds(survivors.map((r) => r.id));
    for (const r of survivors) {
      const vec = vecById.get(r.id);
      if (!vec) continue; // 向量不可得的行（待迁移/待重建）
      this.index!.add(r.id, vec, {
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
    // 孤儿行的外部向量同步清理（失败非致命）。
    await this.deleteVectorsExternal(orphanIds);

    return orphanIds.length;
  }
}

export default new PdfChunkStoreClass();
export { PdfChunkStoreClass };
