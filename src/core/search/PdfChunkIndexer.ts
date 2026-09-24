/**
 * PdfChunkIndexer — Build full-text chunk indexes from PDF attachments.
 *
 * Pipeline per item:
 *   attachment lookup → text extraction → section parse → concurrent
 *   embedding → PdfChunkStore.storeChunks (DB + VectorIndex dual-write)
 *
 * Skips: items without PDF attachment, scanned PDFs (no extractable text),
 * already-indexed items (incremental). Errors on one item do not abort the
 * batch; they are counted and recorded for the UI to surface.
 *
 * @module core/search/PdfChunkIndexer
 */

import { getPdfFullText, getFirstPdfAttachment } from "../pdf/PdfTextProvider";
import {
  parseSections,
  locatePageNumber,
  type ParseResult,
} from "./sectionParser";
import PdfChunkStore, { type ChunkInput } from "./PdfChunkStore";
import EmbeddingsManager from "../ai/EmbeddingsManager";
import { safeDebug } from "../../utils/logger";

export type IndexPhase =
  "extracting" | "parsing" | "embedding" | "storing" | "done";

export interface IndexProgress {
  current: number;
  total: number;
  phase: IndexPhase;
  currentItem?: number;
}

export interface BuildResult {
  processed: number;
  skipped: number;
  errors: number;
  skippedDetails: Array<{ itemId: number; reason: string }>;
}

export interface SingleItemResult {
  skipped: boolean;
  reason?: string;
  chunksStored?: number;
}

/** Inter-batch delay to avoid sustained API rate-limit while embedBatch
 *  already parallelizes within an item. */
const BATCH_DELAY_MS = 50;

class PdfChunkIndexerClass {
  /**
   * Heuristic check for whether extracted PDF text is real content vs
   * binary/OCR garbage. Uses two signals on the first 1000 chars:
   *  - ratio of Unicode letters+digits (< 0.5 = garbage, e.g. decoded
   *    binary noise where most chars are control/symbol)
   *  - average token length when split on whitespace (> 50 = a single
   *    unbroken run, typical of failed OCR or font-subset gibberish)
   *
   * Conservative: real text passes easily (English abstracts are ~80%
   * letters, CJK ~95%). The threshold only triggers on genuinely broken
   * extraction.
   */
  static isLikelyGarbage(text: string): boolean {
    const sample = text.slice(0, 1000);
    if (sample.length === 0) return true;

    const real = (sample.match(/[\p{L}\p{N}]/gu) || []).length;
    if (real / sample.length < 0.5) return true;

    const tokens = sample.split(/\s+/).filter((t) => t.length > 0);
    if (tokens.length === 0) return true;
    const avgTokenLen = sample.length / tokens.length;
    if (avgTokenLen > 50) return true;

    return false;
  }

  /**
   * Read PDF attachment file mtime (ms). Returns 0 on any failure — callers
   * treat 0 as "force rebuild" via isIndexFresh, which is the safe default.
   */
  private async getAttachmentMtime(attachmentId: number): Promise<number> {
    try {
      const att = Zotero.Items.get(attachmentId);
      if (!att) return 0;
      const mtime = await (att as any).attachmentModificationTime;
      return typeof mtime === "number" ? mtime : 0;
    } catch (e) {
      safeDebug(
        "[z-search] PdfChunkIndexer.getAttachmentMtime(" +
          attachmentId +
          ") failed: " +
          e,
      );
      return 0;
    }
  }

  /**
   * Index a single Zotero item (regular item with a PDF attachment).
   * Replaces any existing chunks for this item+model atomically.
   *
   * @param prebuiltMtime - Optional cached mtime from caller (avoids re-reading
   *                        when buildIndexBatch already fetched it for the
   *                        isIndexFresh check).
   */
  async buildIndexForItem(
    itemId: number,
    prebuiltMtime?: number,
  ): Promise<SingleItemResult> {
    const model = EmbeddingsManager.getModelInfo().name;

    const attachmentId = getFirstPdfAttachment(itemId);
    if (!attachmentId) {
      return { skipped: true, reason: "no-pdf-attachment" };
    }

    const pdfMtime =
      prebuiltMtime ?? (await this.getAttachmentMtime(attachmentId));

    let pdfResult;
    try {
      pdfResult = await getPdfFullText(attachmentId, null);
    } catch (e) {
      // Batch semantics: log the parse failure (incl. PdfParseError reason)
      // and skip this item — the batch continues.
      safeDebug(
        `[z-search] PdfChunkIndexer: getPdfFullText failed for item ${itemId}: ${e instanceof Error ? e.message : e}`,
      );
      return { skipped: true, reason: "extraction-failed" };
    }

    // Garbage-text guard: PDF text extractors occasionally return binary
    // noise decoded as a string (failed OCR, encrypted PDFs). Embedding such
    // "text" pollutes the vector index with nonsense vectors that surface as
    // noise in search results. Skip when the letter/digit ratio is too low
    // or when the text is one huge unbroken token.
    if (PdfChunkIndexerClass.isLikelyGarbage(pdfResult.text)) {
      return { skipped: true, reason: "low-quality-text" };
    }

    // P1-D：结构化章节前置优先源 —— 有 DOI 且结构化 XML（PMC JATS /
    // OpenAlex GROBID TEI）能切出带 method 章的有效结果时，替代文本猜测；
    // 任何一环失败回落 parseSections 原路径（增强，不作依赖）。
    const structured = await this.tryStructuredParse(itemId);
    const parsed = structured ?? parseSections(pdfResult.text);
    if (parsed.chunks.length === 0) {
      return { skipped: true, reason: "empty-parse" };
    }

    const texts = parsed.chunks.map((c) => c.chunkText);
    let embeddings: number[][] | null = null;
    let embedError: unknown = null;
    try {
      embeddings = await EmbeddingsManager.embedBatch(texts);
    } catch (e) {
      // BM25 独立立法（2026-09-09 真机）：本地 ONNX 在 Zotero sandbox 无
      // DOM/Worker 跑不了 onnxruntime-web，且 API embedding 可能未配置 ——
      // embed 失败不再让全文检索陪葬。降级为 text-only chunks（空向量），
      // BM25 / 关键词通道照常工作，向量通道自然缺席（indexed:false）。
      embedError = e;
      safeDebug(
        `[z-search] PdfChunkIndexer: embedBatch failed for item ${itemId}, storing text-only (BM25-only) chunks: ${e}`,
      );
    }

    // Guard: embedding API must return one vector per input（成功路径才校验）
    if (embeddings && embeddings.length !== texts.length) {
      throw new Error(
        `Embedding count mismatch: ${embeddings.length} vs ${texts.length} texts`,
      );
    }

    // E1 片段定位：chunk 偏移（filteredText 坐标）→ 页码。页界不可得
    // （旧缓存/降级解析）时 page 为 null，chunk 仍按条目级入索引。
    const pageSpans = pdfResult.pageSpans ?? [];
    const chunkInputs: ChunkInput[] = parsed.chunks.map((c, i) => ({
      chunkIndex: i,
      sectionCategory: c.sectionCategory,
      sectionName: c.sectionName,
      parseMethod: parsed.method,
      chunkText: c.chunkText,
      charCount: c.charCount,
      page: locatePageNumber(pageSpans, c.startOffset),
      charStart: c.startOffset,
      charEnd: c.endOffset,
      embedding: embeddings ? embeddings[i] : [],
      pdfMtime,
    }));

    await PdfChunkStore.storeChunks(itemId, model, chunkInputs);
    if (embedError) {
      safeDebug(
        `[z-search] PdfChunkIndexer: item ${itemId} indexed text-only (${chunkInputs.length} chunks, vector disabled)`,
      );
    }
    return { skipped: false, chunksStored: chunkInputs.length };
  }

  /**
   * P1-D：结构化章节解析尝试（PMC JATS / GROBID TEI 前置优先源）。
   * 复合校验门（isMethodBearingParse）：≥3 章 + 含 method 章 —— method
   * 是 P0 定向投喂的目标，无它则结构化路径相对文本猜测无增益，回落。
   * XML 坐标 ≠ PDF 坐标：产出的 chunk page/char 偏移为 null（E1 条目级
   * 语义，parse_method='structured' 可溯）。全路径容错，失败恒 null。
   */
  private async tryStructuredParse(
    itemId: number,
  ): Promise<ParseResult | null> {
    try {
      const { fetchStructuredXmlForItem } =
        await import("../pdf/StructuredFullTextClient");
      const result = await fetchStructuredXmlForItem(itemId);
      if (!result) return null;
      const { parseTeiOrJats, isMethodBearingParse } =
        await import("./TeiSectionParser");
      const parsed = parseTeiOrJats(result.xml);
      if (!parsed || !isMethodBearingParse(parsed)) {
        safeDebug(
          `[z-search] PdfChunkIndexer: structured XML for item ${itemId} lacks method sections, falling back`,
        );
        return null;
      }
      safeDebug(
        `[z-search] PdfChunkIndexer: structured sections (${result.source}) for item ${itemId}: ${parsed.chunks.length} chunks`,
      );
      return parsed;
    } catch (e) {
      safeDebug(
        `[z-search] PdfChunkIndexer.tryStructuredParse(${itemId}) failed (non-fatal): ${e}`,
      );
      return null;
    }
  }

  /**
   * E1 回填：存量 chunk（page IS NULL）免重嵌入补页码。
   * 重解析文本（AICache 命中，无 JVM 重复开销）→ parseSections（确定性）→
   * 按 chunk_index 同位对账后原位 UPDATE。条数漂移（切块代码版本变化）
   * 跳过整个条目并记日志 —— 绝不按猜测半量回填。
   */
  async backfillChunkPages(itemId: number, model: string): Promise<boolean> {
    try {
      const attachmentId = getFirstPdfAttachment(itemId);
      if (!attachmentId) return false;
      const pdfResult = await getPdfFullText(attachmentId, null);
      if (PdfChunkIndexerClass.isLikelyGarbage(pdfResult.text)) return false;
      const pageSpans = pdfResult.pageSpans ?? [];
      if (pageSpans.length === 0) return false;

      const parsed = parseSections(pdfResult.text);
      const stored = (await PdfChunkStore.getChunkIdsForItem(itemId, model))
        .length;
      if (stored !== parsed.chunks.length) {
        safeDebug(
          `[z-search] PdfChunkIndexer.backfill(${itemId}): chunk count drift (${stored} stored vs ${parsed.chunks.length} reparsed), skipping`,
        );
        return false;
      }

      let updated = 0;
      for (let i = 0; i < parsed.chunks.length; i++) {
        const c = parsed.chunks[i];
        if (c.startOffset === null) continue;
        const page = locatePageNumber(pageSpans, c.startOffset);
        if (page === null) continue;
        updated += await PdfChunkStore.updateChunkLocation(
          itemId,
          model,
          i,
          page,
          c.startOffset,
          c.endOffset,
        );
      }
      if (updated > 0) {
        safeDebug(
          `[z-search] PdfChunkIndexer.backfill(${itemId}): ${updated}/${parsed.chunks.length} chunks located to pages`,
        );
      }
      return updated > 0;
    } catch (e) {
      safeDebug(
        `[z-search] PdfChunkIndexer.backfill(${itemId}) failed (non-fatal): ${e}`,
      );
      return false;
    }
  }

  /**
   * Index a batch of items. Incremental: skips items that already have
   * chunks for the current model. Cancels cleanly when shouldCancel returns
   * true (already-committed items are kept).
   */
  async buildIndexBatch(
    itemIds: number[],
    onProgress?: (p: IndexProgress) => void,
    shouldCancel?: () => boolean,
  ): Promise<BuildResult> {
    const model = EmbeddingsManager.getModelInfo().name;
    const result: BuildResult = {
      processed: 0,
      skipped: 0,
      errors: 0,
      skippedDetails: [],
    };

    for (let i = 0; i < itemIds.length; i++) {
      if (shouldCancel?.()) {
        safeDebug(
          `[z-search] PdfChunkIndexer: cancelled at ${i}/${itemIds.length}`,
        );
        break;
      }
      const itemId = itemIds[i];
      onProgress?.({
        current: i + 1,
        total: itemIds.length,
        phase: "extracting",
        currentItem: itemId,
      });

      try {
        // Incremental: skip items whose chunks exist for this model AND
        // whose stored pdf_mtime matches the current PDF's mtime. PDF
        // replacements / OCR passes change the file mtime, triggering a
        // rebuild; legacy rows (mtime=0) also force rebuild.
        const attachmentId = getFirstPdfAttachment(itemId);
        if (!attachmentId) {
          result.skipped++;
          result.skippedDetails.push({ itemId, reason: "no-pdf-attachment" });
          continue;
        }
        const pdfMtime = await this.getAttachmentMtime(attachmentId);
        const fresh = await PdfChunkStore.isIndexFresh(itemId, model, pdfMtime);
        if (fresh) {
          // E1: 索引新鲜但页码缺失（三列迁移前的存量行）→ 免重嵌入回填。
          // 回填后 page 已补，下次构建回到纯 skip。
          const missing = await PdfChunkStore.countChunksWithoutPage(
            itemId,
            model,
          );
          if (missing > 0) {
            await this.backfillChunkPages(itemId, model);
          }
          result.skipped++;
          result.skippedDetails.push({ itemId, reason: "already-indexed" });
          continue;
        }

        // Pass prebuilt mtime so buildIndexForItem doesn't re-stat the file.
        const r = await this.buildIndexForItem(itemId, pdfMtime);
        if (r.skipped) {
          result.skipped++;
          result.skippedDetails.push({ itemId, reason: r.reason || "unknown" });
        } else {
          result.processed++;
        }
      } catch (e: any) {
        safeDebug(
          `[z-search] PdfChunkIndexer: error indexing item ${itemId}: ${e}`,
        );
        result.errors++;
        result.skippedDetails.push({
          itemId,
          reason: `error: ${(String(e?.message || e) || "").slice(0, 120)}`,
        });
        // Continue with next item — one failure must not abort the batch
      }

      // Gentle pacing between items; embedBatch already paces within an item
      if (i < itemIds.length - 1) {
        await Zotero.Promise.delay(BATCH_DELAY_MS);
      }
    }

    onProgress?.({
      current: itemIds.length,
      total: itemIds.length,
      phase: "done",
    });
    return result;
  }

  /**
   * Index every regular item in the user library that has a PDF attachment.
   * Used by the "Build Full-Text Index" button in SemanticSearchPanel.
   */
  async buildFullLibraryIndex(
    onProgress?: (p: IndexProgress) => void,
    shouldCancel?: () => boolean,
  ): Promise<BuildResult> {
    // asIDs=true avoids loading full item objects
    const allIds = (await Zotero.Items.getAll(
      Zotero.Libraries.userLibraryID,
      false,
      false,
      true,
    )) as number[];

    // Pre-filter to regular items that actually have a PDF attachment —
    // avoids no-op iterations and useless "skipped: no-pdf-attachment" rows
    const candidateIds: number[] = [];
    for (const id of allIds) {
      const item = Zotero.Items.get(id);
      if (!item || item.isNote() || item.isAttachment()) continue;
      if (getFirstPdfAttachment(id)) {
        candidateIds.push(id);
      }
    }

    safeDebug(
      `[z-search] PdfChunkIndexer: full library build — ${candidateIds.length} candidates out of ${allIds.length} items`,
    );

    // Fast skip: if Zotero's full-text index hasn't changed since last build
    // and there are many candidates (>50), skip the entire rebuild
    if (candidateIds.length > 50) {
      try {
        const currentVersion = await (
          Zotero as any
        ).FullText?.getLibraryVersion(Zotero.Libraries.userLibraryID);
        if (currentVersion !== undefined && currentVersion !== null) {
          const { getPrefDynamic } = await import("../../utils/prefs");
          const lastVersion = getPrefDynamic(
            "pdfIndexer.lastFullTextVersion",
          ) as number | null;
          if (lastVersion === currentVersion) {
            safeDebug(
              `[z-search] PdfChunkIndexer: skipping — fullTextVersion unchanged (${currentVersion})`,
            );
            onProgress?.({
              current: candidateIds.length,
              total: candidateIds.length,
              phase: "done",
            });
            return {
              processed: 0,
              skipped: candidateIds.length,
              errors: 0,
              skippedDetails: [],
            };
          }
          // Store version for next time
          const { setPrefDynamic } = await import("../../utils/prefs");
          await setPrefDynamic(
            "pdfIndexer.lastFullTextVersion",
            currentVersion,
          );
        }
      } catch (e) {
        safeDebug(
          "[z-search] PdfChunkIndexer.buildIndexForItem: version check failed, proceeding with full build: " +
            e,
        );
        // Non-critical — proceed with full build if version check fails
      }
    }

    return this.buildIndexBatch(candidateIds, onProgress, shouldCancel);
  }
}

export default new PdfChunkIndexerClass();
export { PdfChunkIndexerClass };
