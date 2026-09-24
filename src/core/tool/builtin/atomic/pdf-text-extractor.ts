/**
 * PDF Text Extraction Atomic Capability
 *
 * Page-level text extraction via OpenDataLoader (through PdfTextProvider's
 * per-item cache). Failures are returned as explicit errors surfaced from
 * PdfParseError — no fallback engine.
 *
 * Architecture: Atomic Capability → Used by skill handlers
 */

import {
  getPdfFullText,
  getFirstPdfAttachment,
  type PageText,
} from "../../../pdf/PdfTextProvider";
import { toErrorMessage } from "../../../../utils/error";
import { safeDebug } from "../../../../utils/logger";

export interface ExtractTextResult {
  success: boolean;
  itemId: number;
  totalPages: number;
  pages: PageText[];
  totalChars: number;
  source: "opendataloader-pdf";
  error?: string;
}

/**
 * Extract full text from a PDF attachment, split by real pages.
 *
 * @param itemId - Zotero item ID (parent item, not attachment)
 * @param maxPages - Maximum pages to extract (default: all)
 * @returns Structured page-by-page text extraction
 */
export async function extractPdfTextByPage(
  itemId: number,
  maxPages?: number,
  _signal?: AbortSignal,
): Promise<ExtractTextResult> {
  const attachmentId = getFirstPdfAttachment(itemId);
  if (!attachmentId) {
    return {
      success: false,
      itemId,
      totalPages: 0,
      pages: [],
      totalChars: 0,
      source: "opendataloader-pdf",
      error: "No PDF attachment",
    };
  }

  const att = Zotero.Items.get(attachmentId);
  if (!att || !att.getFilePath()) {
    return {
      success: false,
      itemId,
      totalPages: 0,
      pages: [],
      totalChars: 0,
      source: "opendataloader-pdf",
      error: "PDF not accessible",
    };
  }

  try {
    const result = await getPdfFullText(attachmentId, maxPages ?? null);
    return {
      success: true,
      itemId,
      totalPages: result.totalPages,
      pages: result.pages,
      totalChars: result.text.length,
      source: "opendataloader-pdf",
    };
  } catch (e) {
    return {
      success: false,
      itemId,
      totalPages: 0,
      pages: [],
      totalChars: 0,
      source: "opendataloader-pdf",
      error: toErrorMessage(e, "Extraction failed"),
    };
  }
}

/**
 * Get raw text content from a PDF (convenience wrapper).
 * Combines pages into a single string.
 *
 * @param itemId - Zotero item ID
 * @param maxPages - Maximum pages to extract
 * @returns Combined text or error
 */
export async function getPdfText(
  itemId: number,
  maxPages?: number,
): Promise<{
  success: boolean;
  text: string;
  pageCount: number;
  error?: string;
}> {
  const result = await extractPdfTextByPage(itemId, maxPages);
  if (!result.success) {
    return { success: false, text: "", pageCount: 0, error: result.error };
  }
  const combined = result.pages.map((p) => p.text).join("\n\n");
  return { success: true, text: combined, pageCount: result.totalPages };
}

/**
 * Extract text from a specific page range.
 *
 * Convenience wrapper around extractPdfTextByPage.
 *
 * @param itemId - Zotero item ID
 * @param startPage - Start page (1-indexed, inclusive)
 * @param endPage - End page (inclusive, optional: defaults to startPage)
 * @returns Combined text from the page range
 */
export async function extractPageRange(
  itemId: number,
  startPage: number,
  endPage?: number,
): Promise<{
  success: boolean;
  text: string;
  pageRange: string;
  error?: string;
}> {
  const end = endPage || startPage;
  if (startPage > end) {
    return {
      success: false,
      text: "",
      pageRange: `${startPage}-${end}`,
      error: "startPage cannot exceed endPage",
    };
  }

  const result = await extractPdfTextByPage(itemId, end);

  if (!result.success) {
    return {
      success: false,
      text: "",
      pageRange: `${startPage}-${end}`,
      error: result.error,
    };
  }

  // Slice to requested range
  const startIdx = startPage - 1;
  const endIdx = end;
  const requestedPages = result.pages.slice(startIdx, endIdx);
  const combined = requestedPages.map((p) => p.text).join("\n\n");

  return {
    success: true,
    text: combined,
    pageRange: `${startPage}${endPage ? `-${endPage}` : ""}`,
  };
}

/**
 * Get page count for a PDF.
 */
export async function getPdfPageCount(itemId: number): Promise<number> {
  const attachmentId = getFirstPdfAttachment(itemId);
  if (!attachmentId) return 0;

  try {
    const result = await getPdfFullText(attachmentId, null);
    return result.totalPages || result.pages.length;
  } catch (e) {
    safeDebug("[z-search] pdf-text-extractor: " + e);
    return 0;
  }
}
