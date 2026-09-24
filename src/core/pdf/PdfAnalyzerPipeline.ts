/**
 * PdfAnalyzerPipeline — Entry point for structured PDF analysis.
 *
 * Delegates to the configured backend (OpenDataLoader or MinerU) via the
 * fallback cascade selector. On infrastructure errors, automatically switches
 * to the other backend. Both produce the same PdfDocumentAnalysis IR.
 */

import type { PdfDocumentAnalysis, AnalyzeOptions } from "./PdfIR";
import { getPrefDynamic } from "../../utils/prefs";
import { analyzePdfFromOpenDataLoader } from "./OpenDataLoaderJsonAdapter";
import { analyzePdfFromMinerU } from "./MinerUJsonAdapter";

/**
 * Analyze a PDF document and produce a structured IR.
 *
 * @param itemId - Zotero parent item ID (not attachment ID)
 * @param options - Analysis options (page limit / abort signal)
 * @throws PdfParseError when all backends are unavailable or parsing fails
 */
export async function analyzePdf(
  itemId: number,
  options?: AnalyzeOptions,
): Promise<PdfDocumentAnalysis> {
  const backend =
    (getPrefDynamic("pdfParser.backend") as string) || "opendataloader";
  const opts = {
    startPage: options?.maxPages ? 1 : undefined,
    endPage: options?.maxPages,
    signal: options?.signal,
  };

  // localOnly (background auto-actions): force the local ODL backend and
  // never cross-fall back to MinerU (remote VLM) — PdfParseError propagates
  // so the caller can retry next session.
  if (options?.localOnly) {
    return analyzePdfFromOpenDataLoader(itemId, opts);
  }

  if (backend === "mineru") {
    try {
      return await analyzePdfFromMinerU(itemId, opts);
    } catch (e) {
      // Only fall back on infra errors; content errors propagate.
      if (!isInfraError(e)) throw e;
      const fallback =
        (getPrefDynamic("pdfParser.backendFallback") as boolean) ?? true;
      if (!fallback) throw e;
      // Fall back to ODL.
      return analyzePdfFromOpenDataLoader(itemId, opts);
    }
  }

  try {
    return await analyzePdfFromOpenDataLoader(itemId, opts);
  } catch (e) {
    if (!isInfraError(e)) throw e;
    const fallback =
      (getPrefDynamic("pdfParser.backendFallback") as boolean) ?? true;
    if (!fallback) throw e;
    return analyzePdfFromMinerU(itemId, opts);
  }
}

function isInfraError(e: any): boolean {
  const name = e?.name || "";
  const msg = String(e?.message || e);

  // M-20: user cancellation is not an infra error — propagate as-is instead
  // of falling back to the other backend for a parse the user cancelled.
  if (name === "AbortError" || /abort|已取消|cancelled/i.test(msg)) {
    return false;
  }

  if (name === "MinerUInfraError") return true;
  if (name === "MinerUContentError") return false;

  const reason = e?.reason;
  if (
    reason === "java-missing" ||
    reason === "jar-missing" ||
    reason === "timeout"
  ) {
    return true;
  }

  // M-20: "abort" removed from the infra pattern — see the guard above.
  if (/network|fetch|timeout|ECONN|socket/i.test(msg)) return true;
  return false;
}
