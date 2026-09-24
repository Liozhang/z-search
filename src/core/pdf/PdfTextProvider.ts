/**
 * PdfTextProvider — Full-text extraction via OpenDataLoader, with per-item cache.
 *
 * OpenDataLoader is the single extraction backend. Results are cached in AICache
 * (per item, 24h TTL) so repeated calls (per-message page injection, search
 * snippets) don't re-spawn the JVM. Cache is a read-through optimization of the
 * same data source — NOT a fallback.
 *
 * Page boundaries come from the ODL JSON structure (one PdfPageAnalysis per page).
 *
 * Throws PdfParseError on failure — no silent degradation.
 */

import { analyzePdf } from "./PdfAnalyzerPipeline";
import type { PdfDocumentAnalysis } from "./PdfIR";
import { PdfParseError } from "./PdfParseError";
import cache, { CacheKeys } from "../cache/AICache";

// M-24: in-flight analysis dedup — concurrent getPdfFullText calls for the
// same parent item (search indexing + AI page injection running together)
// share ONE JVM parse instead of racing duplicate parses of the same PDF.
const inFlightAnalyses = new Map<number, Promise<PdfDocumentAnalysis>>();

export interface PageText {
  pageNumber: number;
  text: string;
  charCount: number;
}

export interface PdfTextResult {
  text: string;
  source: "opendataloader-pdf";
  totalPages: number;
  extractedPages: number;
  pages: PageText[];
  /**
   * E1 片段定位：text（= filteredText）坐标系下每页 [start, end) 区间。
   * 供索引器把 chunk 偏移映射到页码；空数组 = 页界不可得（旧缓存）。
   */
  pageSpans: Array<{ pageNumber: number; start: number; end: number }>;
}

interface CachedFulltext {
  text: string;
  totalPages: number;
  pages: PageText[];
  pageSpans: Array<{ pageNumber: number; start: number; end: number }>;
}

/**
 * Get full text of a PDF attachment via OpenDataLoader (cached per item).
 *
 * @param attachmentId Zotero attachment item ID (not parent item ID); resolved
 *   to the parent item for the ODL invocation
 * @param maxPages Optional page limit (null = all pages); only truncates the
 *   returned view — the full document is parsed and cached on first call.
 * @throws PdfParseError
 */
export async function getPdfFullText(
  attachmentId: number,
  maxPages?: number | null,
): Promise<PdfTextResult> {
  const att = Zotero.Items.get(attachmentId);
  const parentId = att?.parentID;
  if (!att || !parentId) {
    throw new PdfParseError("no-attachment");
  }

  const cached = await cache.get<CachedFulltext>(CacheKeys.fulltext(parentId));
  let full: CachedFulltext;

  if (cached && cached.text) {
    full = {
      text: cached.text,
      totalPages: cached.totalPages,
      pages: cached.pages,
      // 旧缓存条目无页界记账 — 按不可得降级，不伪造。
      pageSpans: cached.pageSpans ?? [],
    };
  } else {
    // M-24: cache miss — reuse an in-flight analysis for this item, or
    // register ours. Rejections (including M-20 AbortError) propagate to
    // every awaiting caller as-is; there is no catch here that could convert
    // an abort into PdfParseError("no-text").
    let analysisPromise = inFlightAnalyses.get(parentId);
    if (!analysisPromise) {
      analysisPromise = analyzePdf(parentId).finally(() => {
        inFlightAnalyses.delete(parentId);
      });
      inFlightAnalyses.set(parentId, analysisPromise);
    }
    const analysis = await analysisPromise;
    const pages: PageText[] = analysis.pages.map((p) => {
      const text = p.textBlocks.map((b) => b.text).join("\n");
      return {
        pageNumber: p.pageNumber,
        text: text.trim(),
        charCount: text.length,
      };
    });
    full = {
      text: analysis.filteredText,
      totalPages: analysis.totalPages,
      pages,
      pageSpans: analysis.filteredPageSpans ?? [],
    };
    if (full.text.trim().length > 0) {
      await cache.set(CacheKeys.fulltext(parentId), full);
    }
  }

  if (!full.text || full.text.trim().length === 0) {
    throw new PdfParseError("no-text");
  }

  const limit = maxPages ?? null;
  const pages = limit
    ? full.pages.filter((p) => p.pageNumber <= limit)
    : full.pages;

  return {
    text: limit ? pages.map((p) => p.text).join("\n\n") : full.text,
    source: "opendataloader-pdf",
    totalPages: full.totalPages,
    extractedPages: pages.length,
    pages,
    pageSpans: full.pageSpans,
  };
}

/**
 * Get the first PDF attachment ID for a parent item.
 */
export function getFirstPdfAttachment(parentItemId: number): number | null {
  const item = Zotero.Items.get(parentItemId);
  if (!item) return null;

  const attachments = item.getAttachments();
  for (const attId of attachments) {
    const att = Zotero.Items.get(attId);
    if (att && att.isPDFAttachment()) {
      return attId;
    }
  }
  return null;
}
