/**
 * ZoteroFulltextAdapter — 链尾兜底：Zotero 内建全文抽取 → PdfDocumentAnalysis IR。
 *
 * 定位（2026-10-04）：ODL 缺 jar / 缺 Java、MinerU 缺令牌时，此前的回退链
 * 直接抛错，全新安装的 PDF 全文索引全军覆没。Zotero 自带 pdf.js 文本层抽取
 * （.zotero-ft-cache），零依赖、纯本地、总能给出纯文本——作为回退链的最后一
 * 级，保证「有 PDF 就有全文」。
 *
 * 代价：只有纯文本，无版面结构——单页文本块、页界不可得（filteredPageSpans
 * 给整篇单区间，消费方按条目级降级），表格/公式/图表全空。真实性优先：IR
 * 的 source 标为 tier2-zotero-fulltext，绝不冒充结构化后端。
 *
 * 刻意不复用 PdfTextProvider.getFirstPdfAttachment：那是它的调用方，反向
 * import 成环。附件查找逻辑就地内联（6 行）。
 *
 * @module core/pdf/ZoteroFulltextAdapter
 */

import type {
  PdfDocumentAnalysis,
  AnalyzeOptions,
  PdfPageAnalysis,
} from "./PdfIR";
import { PdfParseError } from "./PdfParseError";
import { safeDebug } from "../../utils/logger";

/** 就地内联的首附件查找（与 PdfTextProvider.getFirstPdfAttachment 同语义）。 */
function firstPdfAttachmentId(parentItemId: number): number | null {
  const item = Zotero.Items.get(parentItemId);
  if (!item) return null;
  for (const attId of item.getAttachments()) {
    const att = Zotero.Items.get(attId);
    if (att && att.isPDFAttachment()) return attId;
  }
  return null;
}

/**
 * 读 Zotero 全文缓存文本。优先 getItemContent（读缓存即返回）；旧宿主没有
 * 该方法时直接读缓存文件。无缓存返回空串——不在这里触发索引。
 */
async function readFulltextCache(attachmentId: number): Promise<string> {
  // zotero-types 声明的 FullText 接口未含 getItemContent（真机存在），与
  // PdfChunkIndexer 的 FullText.getLibraryVersion 同样走 any 访问。
  const ft = Zotero.Fulltext as any;
  if (typeof ft?.getItemContent === "function") {
    const text = await ft.getItemContent(attachmentId);
    return typeof text === "string" ? text : "";
  }
  const att = Zotero.Items.get(attachmentId);
  if (!att) return "";
  const cacheFile = ft.getItemCacheFile(att);
  try {
    if (!(await (globalThis as any).IOUtils.exists(cacheFile.path))) return "";
    const text = await Zotero.File.getContentsAsync(cacheFile.path);
    return typeof text === "string" ? text : "";
  } catch (e) {
    safeDebug("[z-search] ZoteroFulltextAdapter: cache read failed: " + e);
    return "";
  }
}

/** 已知总页数（best-effort；Zotero 的页数记录缺失时返回 0）。 */
async function knownPageCount(attachmentId: number): Promise<number> {
  try {
    const pages = await (Zotero.Fulltext as any).getPages(attachmentId);
    return pages && typeof pages.total === "number" ? pages.total : 0;
  } catch {
    return 0;
  }
}

/**
 * Zotero 内建全文抽取 → 结构化 IR（单页纯文本块）。
 *
 * @param itemId - Zotero parent item ID（与 analyzePdf 其余后端一致）
 * @throws PdfParseError("no-attachment" / "no-text")
 */
export async function analyzePdfFromZoteroFulltext(
  itemId: number,
  _options?: AnalyzeOptions,
): Promise<PdfDocumentAnalysis> {
  const attachmentId = firstPdfAttachmentId(itemId);
  if (!attachmentId) {
    throw new PdfParseError("no-attachment");
  }

  let text = await readFulltextCache(attachmentId);
  if (!text.trim()) {
    // 无缓存才触发一次同步索引（抽取在 Zotero 的 pdf.js worker 里完成）。
    try {
      await (Zotero.Fulltext as any).indexItems([attachmentId], {
        complete: true,
      });
    } catch (e) {
      safeDebug(
        `[z-search] ZoteroFulltextAdapter: indexItems(${attachmentId}) failed: ` +
          e,
      );
    }
    text = await readFulltextCache(attachmentId);
  }
  const trimmed = text.trim();
  if (!trimmed) {
    throw new PdfParseError(
      "no-text",
      "Zotero built-in extraction produced no text (scanned PDF?)",
    );
  }

  const page: PdfPageAnalysis = {
    pageNumber: 1,
    width: 0,
    height: 0,
    textBlocks: [
      {
        text: trimmed,
        bbox: { x: 0, y: 0, width: 0, height: 0 },
        fontSize: 0,
        fontName: "",
        hasEOL: true,
      },
    ],
    regions: [],
    tables: [],
    chartAreas: [],
    formulas: [],
    repeatedElements: [],
    citations: [],
  };

  return {
    source: "tier2-zotero-fulltext",
    totalPages: (await knownPageCount(attachmentId)) || 1,
    pages: [page],
    allTables: [],
    allFormulas: [],
    allChartAreas: [],
    allCitations: [],
    filteredText: trimmed,
    filteredPageSpans: [{ pageNumber: 1, start: 0, end: trimmed.length }],
    filteredMarkdown: trimmed,
    confidence: 0.5,
    processingMs: 0,
  };
}
