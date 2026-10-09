/**
 * PdfAnalyzerPipeline — Entry point for structured PDF analysis.
 *
 * 「哪些后端按什么顺序参与」由 parseChain.resolveParseChain 求解（纯函数，
 * 单测锁矩阵）；本文件只负责逐层执行与错误放行：基础设施错误（缺 jar、
 * 缺 Java、超时、网络）换下一层，内容错误（解析出来但没文本）原样上抛。
 * 链尾恒为 Zotero 内建全文抽取——零依赖兜底，保证有 PDF 就有全文
 * （2026-10-04 修复：此前缺 jar/缺令牌两连败后直接抛错）。
 */

import type { PdfDocumentAnalysis, AnalyzeOptions } from "./PdfIR";
import { getPrefDynamic } from "../../utils/prefs";
import { analyzePdfFromOpenDataLoader } from "./OpenDataLoaderJsonAdapter";
import { analyzePdfFromMinerU } from "./MinerUJsonAdapter";
import { analyzePdfFromZoteroFulltext } from "./ZoteroFulltextAdapter";
import { resolveParseChain, type ParseTierId } from "./parseChain";
import { safeDebug } from "../../utils/logger";

const TIER_RUNNERS: Record<
  ParseTierId,
  (itemId: number, opts: any) => Promise<PdfDocumentAnalysis>
> = {
  opendataloader: analyzePdfFromOpenDataLoader,
  mineru: analyzePdfFromMinerU,
  "zotero-fulltext": analyzePdfFromZoteroFulltext,
};

/**
 * MinerU 是否值得入链：自建模式（local endpoint）不需要令牌；云模式没配
 * 令牌时尝试注定失败，直接跳过该层。
 */
function isMineruAvailable(): boolean {
  const mode = (getPrefDynamic("pdfParser.mineru.mode") as string) || "cloud";
  if (mode !== "cloud") return true;
  return Boolean(
    String(getPrefDynamic("pdfParser.mineru.apiToken") ?? "").trim(),
  );
}

/**
 * Analyze a PDF document and produce a structured IR.
 *
 * @param itemId - Zotero parent item ID (not attachment ID)
 * @param options - Analysis options (page limit / abort signal)
 * @throws PdfParseError when every tier in the chain failed
 */
export async function analyzePdf(
  itemId: number,
  options?: AnalyzeOptions,
): Promise<PdfDocumentAnalysis> {
  const opts = {
    startPage: options?.maxPages ? 1 : undefined,
    endPage: options?.maxPages,
    signal: options?.signal,
  };
  const chain = resolveParseChain({
    backend:
      (getPrefDynamic("pdfParser.backend") as string) || "opendataloader",
    fallback: (getPrefDynamic("pdfParser.backendFallback") as boolean) ?? true,
    localOnly: Boolean(options?.localOnly),
    mineruAvailable: isMineruAvailable(),
  });

  let lastError: unknown;
  for (let i = 0; i < chain.length; i++) {
    try {
      return await TIER_RUNNERS[chain[i]](itemId, opts);
    } catch (e: any) {
      lastError = e;
      // M-20: user cancellation is never a fallback signal.
      if (
        e?.name === "AbortError" ||
        /abort|已取消|cancelled/i.test(String(e?.message || e))
      ) {
        throw e;
      }
      // 内容错误（解析成功但没文本等）不再换层——换层也救不了，且会掩盖
      // 真实失败原因。链尾层的失败没有下一层，自然上抛。
      if (!isInfraError(e) && i < chain.length - 1) {
        throw e;
      }
      safeDebug(
        `[z-search] PdfAnalyzerPipeline: tier ${chain[i]} failed for item ${itemId}: ` +
          (e instanceof Error ? e.message : e),
      );
    }
  }
  throw lastError;
}

function isInfraError(e: any): boolean {
  const name = e?.name || "";
  const msg = String(e?.message || e);

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
