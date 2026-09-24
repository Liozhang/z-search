/**
 * BM25Index — FTS5-backed BM25 full-text index over PDF chunks.
 *
 * Storage lives in the MAIN zotero.sqlite. This is platform-FORCED, not a
 * style choice: Firefox registers the FTS5 virtual-table module only on the
 * main mozStorage connection — verified on Zotero 10 / SQLite 3.49.2 that
 * `CREATE VIRTUAL TABLE … USING fts5` succeeds on Zotero.DB but throws
 * "no such module: fts5" on a dedicated `new Zotero.DBConnection(path)`
 * external connection (temp and non-temp alike). The external-file option
 * from the db-deep-audit legislation is therefore unavailable for FTS.
 *
 * The FTS table is contentful (stores the tokenized text itself), not an
 * external-content table: deletes then need no prior token knowledge, and
 * chunk rows are immutable once written (AUTOINCREMENT ids never reused),
 * so rowid-keyed DELETE + INSERT keeps it in sync cheaply. sectionCategory
 * and itemId ride along as UNINDEXED columns so search can resolve items
 * in one query.
 *
 * Sync is EXPLICIT: PdfChunkStore is the single writer to zsearch_pdf_chunks
 * (storeChunks / deleteChunks / deleteChunksByModel / deleteOrphans) and
 * calls the sync hooks — FTS failures there are non-fatal and repaired by
 * the ensureFresh count+maxId check on the next keyword search.
 *
 * Capability probe: availability is probed once via a temp-schema virtual
 * table and degraded cleanly (search returns [], sync becomes a no-op).
 *
 * @module core/search/BM25Index
 */

import { safeDebug } from "../../utils/logger";
import { tokenizeForFts, buildMatchQuery } from "./fts-tokenize";

const FTS_TABLE = "zsearch_chunks_fts";
/** Params per batched statement: 4 columns × 200 rows = 800 (< 999). */
const INSERT_BATCH_ROWS = 200;
/** Rowids per batched DELETE. */
const DELETE_BATCH = 500;
/** Read batch for the bulk rebuild. */
const REBUILD_READ_BATCH = 500;
/** Over-fetch so JS-side section filtering doesn't starve topK. */
const SECTION_FILTER_OVERFETCH = 3;

export interface KeywordHit {
  chunkId: number;
  itemId: number;
  /** Positive display score (−bm25()); magnitude is corpus-dependent —
   *  use ranks for fusion, never thresholds. */
  score: number;
  sectionCategory?: string;
}

class BM25IndexClass {
  private capability: "unknown" | "available" | "unavailable" = "unknown";
  private schemaReady = false;
  // F-29（回退审计 2026-09-11，P1）：写失败漂移标记——count+maxId 探针
  // 兜不住"同数不同行"的漂移（删除+插入数量恰好相抵），且用户可能此后
  // 永不触发修复窗口。写失败即置位，下次 search() 强制 rebuild。
  private ftsDrift = false;

  /** 供 PdfChunkStore 同步钩子在写失败时置位（F-30）。 */
  markDrifted(): void {
    this.ftsDrift = true;
  }

  isAvailable(): boolean {
    return this.capability !== "unavailable";
  }

  /**
   * Probe FTS5 availability + create the schema. Idempotent, lazy (first
   * BM25 use — no startup cost), never throws: returns false when BM25 is
   * unusable so callers degrade cleanly.
   */
  async ensure(): Promise<boolean> {
    if (this.capability === "unavailable") return false;
    if (this.capability === "available" && this.schemaReady) return true;

    if (this.capability === "unknown") {
      try {
        await Zotero.DB.queryAsync(
          `CREATE VIRTUAL TABLE temp.zsearch_fts5_probe USING fts5(x)`,
        );
        await Zotero.DB.queryAsync(
          `DROP TABLE IF EXISTS temp.zsearch_fts5_probe`,
        );
        this.capability = "available";
      } catch (e) {
        this.capability = "unavailable";
        safeDebug(
          `[z-search] BM25Index: FTS5 unavailable in this SQLite build, BM25 disabled: ${e}`,
        );
        return false;
      }
    }

    if (!this.schemaReady) {
      try {
        await Zotero.DB.queryAsync(`
          CREATE VIRTUAL TABLE IF NOT EXISTS ${FTS_TABLE} USING fts5(
            tokens,
            item_id UNINDEXED,
            section_category UNINDEXED
          )
        `);
        this.schemaReady = true;
      } catch (e) {
        this.capability = "unavailable";
        safeDebug(`[z-search] BM25Index: schema create failed: ${e}`);
        return false;
      }
    }

    return true;
  }

  /**
   * BM25 search over chunk texts. Never throws at steady state — probing
   * or rebuild failures surface as an empty result so callers degrade.
   * Rebuilds the index first when it is stale or empty while chunks exist
   * (first adoption / restore divergence).
   */
  async search(
    query: string,
    topK: number,
    sectionCategory?: string,
  ): Promise<KeywordHit[]> {
    const match = buildMatchQuery(query);
    if (!match || topK <= 0) return [];
    if (!(await this.ensureFresh())) return [];

    // Callers pass sectionCategory='any' as "no filter" (vector path
    // special-cases it before building its filter) — honor it here too.
    const filterCat =
      sectionCategory && sectionCategory !== "any"
        ? sectionCategory
        : undefined;
    const fetch = filterCat ? topK * SECTION_FILTER_OVERFETCH : topK;
    try {
      const rows = await Zotero.DB.queryAsync(
        `SELECT rowid AS chunkId, item_id AS itemId, section_category AS sectionCategory,
                bm25(${FTS_TABLE}) AS rankScore
         FROM ${FTS_TABLE}
         WHERE ${FTS_TABLE} MATCH ?
         ORDER BY rankScore
         LIMIT ?`,
        [match, fetch],
      );
      const hits: KeywordHit[] = [];
      for (const r of rows ?? []) {
        const cat = r.sectionCategory ?? undefined;
        if (filterCat && cat !== filterCat) continue;
        hits.push({
          chunkId: r.chunkId,
          itemId: r.itemId,
          // bm25() is negative with "more negative = better match"; flip
          // sign so callers see the conventional higher-is-better score.
          score: -Number(r.rankScore) || 0,
          sectionCategory: cat,
        });
        if (hits.length >= topK) break;
      }
      return hits;
    } catch (e) {
      safeDebug(`[z-search] BM25Index.search failed: ${e}`);
      return [];
    }
  }

  /** Row count in the FTS index. */
  async size(): Promise<number> {
    if (!(await this.ensure())) return 0;
    try {
      const rows = await Zotero.DB.queryAsync(
        `SELECT COUNT(*) AS n FROM ${FTS_TABLE}`,
      );
      return Number(rows?.[0]?.n) || 0;
    } catch (e) {
      safeDebug(`[z-search] BM25Index.size failed: ${e}`);
      return 0;
    }
  }

  /**
   * Remove chunks by id (contentful FTS5 → plain DELETE, no token needed).
   * Non-throwing: a failed delete leaves ghost rows that the freshness
   * check repairs on next search.
   */
  async removeRows(chunkIds: number[]): Promise<void> {
    if (chunkIds.length === 0) return;
    if (!(await this.ensure())) return;
    try {
      for (let i = 0; i < chunkIds.length; i += DELETE_BATCH) {
        const batch = chunkIds.slice(i, i + DELETE_BATCH);
        const ph = batch.map(() => "?").join(",");
        await Zotero.DB.queryAsync(
          `DELETE FROM ${FTS_TABLE} WHERE rowid IN (${ph})`,
          batch,
        );
      }
    } catch (e) {
      this.ftsDrift = true;
      safeDebug(
        `[z-search] BM25Index.removeRows failed (drift flagged, repaired on next search): ${e}`,
      );
    }
  }

  /**
   * Index chunk rows written by PdfChunkStore. Chunk ids are AUTOINCREMENT
   * (never reused) so these are fresh inserts; the defensive DELETE keeps
   * the call idempotent under retry. Non-throwing.
   */
  async upsertRows(
    rows: Array<{
      id: number;
      itemId: number;
      sectionCategory?: string | null;
      chunkText: string;
    }>,
  ): Promise<void> {
    if (rows.length === 0) return;
    if (!(await this.ensure())) return;
    try {
      for (let i = 0; i < rows.length; i += INSERT_BATCH_ROWS) {
        const batch = rows.slice(i, i + INSERT_BATCH_ROWS);
        const ids = batch.map((r) => r.id);
        const phDel = ids.map(() => "?").join(",");
        await Zotero.DB.queryAsync(
          `DELETE FROM ${FTS_TABLE} WHERE rowid IN (${phDel})`,
          ids,
        );
        const rowPh = batch.map(() => "(?,?,?,?)").join(",");
        const params = batch.flatMap((r) => [
          r.id,
          tokenizeForFts(r.chunkText || ""),
          r.itemId,
          r.sectionCategory ?? null,
        ]);
        await Zotero.DB.queryAsync(
          `INSERT INTO ${FTS_TABLE}(rowid, tokens, item_id, section_category)
           VALUES ${rowPh}`,
          params,
        );
      }
    } catch (e) {
      this.ftsDrift = true;
      safeDebug(
        `[z-search] BM25Index.upsertRows failed (drift flagged, repaired on next search): ${e}`,
      );
    }
  }

  /**
   * Ensure the index exists AND is consistent with zsearch_pdf_chunks
   * before a search: stale check is (count, max rowid) vs the chunk table —
   * both directions of divergence trigger a full rebuild.
   */
  private async ensureFresh(): Promise<boolean> {
    if (!(await this.ensure())) return false;

    // F-29：显式漂移标记优先于探针——探针只看 count/maxId，同数不同行
    // 的漂移会永久漏检。rebuild 幂等（类注释），失败标记由 catch 保留。
    if (this.ftsDrift) {
      this.ftsDrift = false;
      safeDebug(
        `[z-search] BM25Index: drift flagged by failed write, rebuilding`,
      );
      return this.rebuild();
    }

    const mainCountRows = await Zotero.DB.queryAsync(
      `SELECT COUNT(*) AS n, COALESCE(MAX(id), 0) AS maxId FROM zsearch_pdf_chunks`,
    );
    const mainCount = Number(mainCountRows?.[0]?.n) || 0;
    if (mainCount === 0) return false; // nothing to index; caller reports NOT_INDEXED

    try {
      const ftsRows = await Zotero.DB.queryAsync(
        `SELECT COUNT(*) AS n, COALESCE(MAX(rowid), 0) AS maxId FROM ${FTS_TABLE}`,
      );
      const ftsCount = Number(ftsRows?.[0]?.n) || 0;
      const ftsMaxId = Number(ftsRows?.[0]?.maxId) || 0;
      if (
        ftsCount === mainCount &&
        ftsMaxId >= Number(mainCountRows[0].maxId)
      ) {
        return true;
      }
    } catch (e) {
      safeDebug(`[z-search] BM25Index: freshness probe failed: ${e}`);
      return false;
    }

    safeDebug(`[z-search] BM25Index: index stale (fts vs main), rebuilding`);
    return this.rebuild();
  }

  /**
   * Full rebuild. Returns true on success. Called from ensureFresh; safe
   * to call repeatedly.
   */
  async rebuild(): Promise<boolean> {
    if (!(await this.ensure())) return false;
    try {
      await Zotero.DB.queryAsync(`DELETE FROM ${FTS_TABLE}`);

      let offset = 0;
      let indexed = 0;
      while (true) {
        const rows = await Zotero.DB.queryAsync(
          `SELECT id, item_id, section_category, chunk_text
           FROM zsearch_pdf_chunks ORDER BY id LIMIT ? OFFSET ?`,
          [REBUILD_READ_BATCH, offset],
        );
        if (!rows || rows.length === 0) break;
        await this.upsertRows(
          rows.map((r: any) => ({
            id: r.id,
            itemId: r.item_id,
            sectionCategory: r.section_category,
            chunkText: r.chunk_text,
          })),
        );
        indexed += rows.length;
        offset += REBUILD_READ_BATCH;
      }
      safeDebug(`[z-search] BM25Index: rebuild complete (${indexed} chunks)`);
      return true;
    } catch (e) {
      safeDebug(`[z-search] BM25Index.rebuild failed: ${e}`);
      return false;
    }
  }
}

export const bm25Index = new BM25IndexClass();
export { BM25IndexClass };
