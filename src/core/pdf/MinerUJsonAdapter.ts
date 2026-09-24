/**
 * MinerUJsonAdapter — Map MinerU layout.json output to Leadero PdfIR.
 *
 * MinerU's layout.json (also called middle.json) is a hierarchical structure:
 *   root.pdf_info[] → pages
 *     page.page_size: [width, height]
 *     page.para_blocks[] → content blocks (title / text / table / image_body /
 *       interline_equation / list)
 *       block.bbox: [x0, y0, x1, y1]  ← top-left origin, y-axis DOWN (raw PDF points)
 *       block.lines[] → lines
 *         line.spans[] → spans (type: text | inline_equation | image)
 *     page.discarded_blocks[] → headers / footers / page numbers
 *
 * Key difference from ODL: MinerU uses **top-left origin with y-down**,
 * while PdfIR uses **bottom-left origin with y-up**. The adapter flips y.
 *
 * MinerU also provides native LaTeX for equations and HTML for tables — far
 * richer than ODL's garbled inline text.
 */

import type {
  PdfDocumentAnalysis,
  PdfPageAnalysis,
  PdfTextBlock,
  PdfTable,
  PdfTableRow,
  PdfTableCell,
  PdfFormula,
  PdfChartArea,
  RepeatedElement,
  RepeatedRegionType,
  BBox,
  LayoutRegion,
  LayoutRole,
} from "./PdfIR";

import { PdfParseError } from "./PdfParseError";
import { parsePdfWithMinerU } from "./MinerUApiClient";

interface MinerUPage {
  page_idx: number;
  page_size: [number, number]; // [width, height]
  para_blocks: MinerUBlock[];
  discarded_blocks?: MinerUBlock[];
  preproc_blocks?: MinerUBlock[];
}

interface MinerUBlock {
  type: string;
  bbox: [number, number, number, number]; // [x0, y0, x1, y1] top-left origin
  lines?: MinerULine[];
  // Table-specific
  table_body?: string; // HTML <table>...</table>
  table_caption?: string[];
  table_footnote?: string[];
  // Image-specific
  image_path?: string;
  // Equation-specific
  type_text?: string; // sometimes LaTeX is here
  // List/text level
  text_level?: number;
  level?: number;
  // VLM angle
  angle?: number;
}

interface MinerULine {
  bbox: [number, number, number, number];
  spans: MinerUSpan[];
}

interface MinerUSpan {
  type: string; // "text" | "inline_equation" | "image"
  content?: string;
  bbox: [number, number, number, number];
  image_path?: string;
}

interface MinerULayout {
  pdf_info: MinerUPage[];
  _backend?: string;
  _version_name?: string;
}

/**
 * Convert MinerU layout.json → PdfDocumentAnalysis.
 *
 * @param layoutJson  Parsed layout.json (middle.json)
 * @param imagesMap   Optional filename→dataURI map for image embedding
 */
export function adaptMinerULayout(
  layoutJson: any,
  imagesMap?: Map<string, string>,
): PdfDocumentAnalysis {
  const root = layoutJson as MinerULayout;
  const pages: MinerUPage[] = root.pdf_info || [];
  const totalPages = pages.length;

  const allTables: PdfTable[] = [];
  const allFormulas: PdfFormula[] = [];
  const allChartAreas: PdfChartArea[] = [];
  const filteredTextParts: string[] = [];
  const filteredMarkdownParts: string[] = [];
  // E1 片段定位：页界记账（与文末 join("\n\n") 增量长度严格一致，见 ODL 同名块）。
  const filteredPageSpans: Array<{
    pageNumber: number;
    start: number;
    end: number;
  }> = [];
  let filteredAcc = 0;
  let openPageSpan: { pageNumber: number; start: number; end: number } | null =
    null;
  const pushFilteredText = (content: string, pageNo: number) => {
    // E1 回归修复：与 ODL 适配器同病——重构后 filteredTextParts 无人 push，
    // filteredText 恒空。收集点收敛回本函数（记账与 join("\n\n") 严格一致）。
    filteredTextParts.push(content);
    if (!openPageSpan || openPageSpan.pageNumber !== pageNo) {
      if (openPageSpan) filteredPageSpans.push(openPageSpan);
      openPageSpan = {
        pageNumber: pageNo,
        start: filteredAcc === 0 ? 0 : filteredAcc + 2,
        end: 0,
      };
    }
    filteredAcc += (filteredAcc === 0 ? 0 : 2) + content.length;
    openPageSpan.end = filteredAcc;
  };

  const pdfPages: PdfPageAnalysis[] = pages.map((muPage) => {
    const [pageWidth, pageHeight] = muPage.page_size;
    const pageNumber = (muPage.page_idx ?? 0) + 1;

    const textBlocks: PdfTextBlock[] = [];
    const tables: PdfTable[] = [];
    const formulas: PdfFormula[] = [];
    const chartAreas: PdfChartArea[] = [];
    const repeatedElements: RepeatedElement[] = [];
    const regions: LayoutRegion[] = [];

    for (const block of muPage.para_blocks || []) {
      const bbox = flipBBox(block.bbox, pageHeight);
      const text = extractBlockText(block);
      const fontSize = estimateFontSize(block);

      switch (block.type) {
        case "title": {
          const headingLevel = block.text_level ?? block.level ?? 1;
          const tb = makeTextBlock(text, bbox, fontSize, "heading");
          textBlocks.push(tb);
          pushFilteredText(text, pageNumber);
          filteredMarkdownParts.push(`${"#".repeat(headingLevel)} ${text}`);
          regions.push(makeRegion("heading", bbox, pageNumber, tb));
          break;
        }

        case "text": {
          const tb = makeTextBlock(text, bbox, fontSize, "body");
          textBlocks.push(tb);
          pushFilteredText(text, pageNumber);
          filteredMarkdownParts.push(text);
          regions.push(makeRegion("body", bbox, pageNumber, tb));
          break;
        }

        case "interline_equation": {
          const latex = text || block.type_text || "";
          const formula: PdfFormula = {
            pageNumber,
            bbox,
            textRepresentation: latex,
            isDisplay: true,
            confidence: 0.95,
          };
          formulas.push(formula);
          allFormulas.push(formula);
          // Equations are NOT pushed to textBlocks — they should not be
          // translated. The original formula is preserved in overlay mode.
          filteredMarkdownParts.push(`$$${latex}$$`);
          break;
        }

        case "table": {
          const table = adaptMinerUTable(block, pageNumber, pageHeight);
          tables.push(table);
          allTables.push(table);
          filteredMarkdownParts.push(tableToMarkdown(table));
          break;
        }

        case "image_body":
        case "image": {
          const imgName = block.image_path?.split("/").pop() || "";
          const dataUri = imagesMap?.get(imgName);
          const chart: PdfChartArea = {
            pageNumber,
            bbox,
            detectedType: "unknown",
            hasAxes: false,
            hasLegend: false,
            confidence: 0.8,
            ...(dataUri ? { imageDataUri: dataUri } : {}),
          };
          chartAreas.push(chart);
          allChartAreas.push(chart);
          break;
        }

        default: {
          // list, index, etc. → treat as body text
          if (text) {
            const tb = makeTextBlock(text, bbox, fontSize, "body");
            textBlocks.push(tb);
            pushFilteredText(text, pageNumber);
            filteredMarkdownParts.push(
              block.type === "list" ? `- ${text}` : text,
            );
            regions.push(makeRegion("body", bbox, pageNumber, tb));
          }
          break;
        }
      }
    }

    for (const block of muPage.discarded_blocks || []) {
      const text = extractBlockText(block);
      if (!text) continue;
      const bbox = flipBBox(block.bbox, pageHeight);
      const region = mapDiscardedType(block.type);
      if (region) {
        repeatedElements.push({
          text,
          region,
          pageNumber,
          bbox,
          occurrences: 1,
        });
      }
    }

    return {
      pageNumber,
      width: pageWidth,
      height: pageHeight,
      textBlocks,
      regions,
      tables,
      chartAreas,
      formulas,
      repeatedElements,
      citations: [],
    };
  });

  if (openPageSpan) filteredPageSpans.push(openPageSpan);

  return {
    source: "tier2-mineru-api",
    totalPages,
    pages: pdfPages,
    allTables,
    allFormulas,
    allChartAreas,
    allCitations: [],
    filteredText: filteredTextParts.join("\n\n"),
    filteredPageSpans,
    filteredMarkdown: filteredMarkdownParts.join("\n\n"),
    confidence: 0.92,
    processingMs: 0,
  };
}

/**
 * Analyze a Zotero PDF attachment using the MinerU API.
 * Mirrors `analyzePdfFromOpenDataLoader` in the ODL adapter.
 */
export async function analyzePdfFromMinerU(
  itemId: number,
  options?: { startPage?: number; endPage?: number; signal?: AbortSignal },
): Promise<PdfDocumentAnalysis> {
  const item = Zotero.Items.get(itemId);
  if (!item) {
    throw new PdfParseError("no-attachment");
  }

  const attachmentIds = item
    .getAttachments()
    .filter((id: number) => Zotero.Items.get(id)?.isPDFAttachment());
  if (attachmentIds.length === 0) {
    throw new PdfParseError("no-attachment");
  }

  const attachment = Zotero.Items.get(attachmentIds[0]);
  const filePath = attachment?.getFilePath?.();
  if (!filePath) {
    throw new PdfParseError("no-attachment");
  }

  const result = await parsePdfWithMinerU(filePath, {
    signal: options?.signal,
  });

  const analysis = adaptMinerULayout(result.layoutJson, result.images);
  if (!analysis.pages || analysis.pages.length === 0) {
    throw new PdfParseError("no-text");
  }

  return analysis;
}

/** Convert MinerU [x0, y0, x1, y1] (top-left, y-down) → PdfIR BBox (bottom-left, y-up). */
function flipBBox(
  muBbox: [number, number, number, number],
  pageHeight: number,
): BBox {
  const [x0, y0, x1, y1] = muBbox;
  return {
    x: x0,
    y: pageHeight - y1, // flip y so it's measured from the bottom
    width: x1 - x0,
    height: y1 - y0,
  };
}

/** Extract concatenated text from a block's lines → spans. */
function extractBlockText(block: MinerUBlock): string {
  if (!block.lines) return "";
  const parts: string[] = [];
  for (const line of block.lines) {
    for (const span of line.spans || []) {
      if (span.type === "image") continue;
      const content = span.content || "";
      if (content) {
        if (span.type === "inline_equation") {
          parts.push(`$${content}$`);
        } else {
          parts.push(content);
        }
      }
    }
    if (parts.length > 0 && parts[parts.length - 1] !== "\n") {
      parts.push("\n");
    }
  }
  return parts.join("").replace(/\n+/g, "\n").trim();
}

/** Estimate font size from the first line's bbox height. */
function estimateFontSize(block: MinerUBlock): number {
  const firstLine = block.lines?.[0];
  if (firstLine) {
    const [, y0, , y1] = firstLine.bbox;
    const h = Math.abs(y1 - y0);
    if (h > 4) return Math.round(h);
  }
  return 10; // fallback
}

function makeTextBlock(
  text: string,
  bbox: BBox,
  fontSize: number,
  _role: string,
): PdfTextBlock {
  return {
    text,
    bbox,
    fontSize,
    fontName: "unknown",
    hasEOL: false,
    textColor: "[0.0]",
  };
}

function makeRegion(
  role: LayoutRole,
  bbox: BBox,
  pageNumber: number,
  content: PdfTextBlock,
): LayoutRegion {
  return {
    role,
    bbox,
    pageNumber,
    confidence: 1,
    content: [content],
  };
}

function mapDiscardedType(muType: string): RepeatedRegionType | null {
  switch (muType) {
    case "header":
      return "header";
    case "footer":
      return "footer";
    case "page_number":
      return "page-number";
    default:
      return null;
  }
}

function adaptMinerUTable(
  block: MinerUBlock,
  pageNumber: number,
  pageHeight: number,
): PdfTable {
  const bbox = flipBBox(block.bbox, pageHeight);
  const caption = block.table_caption?.[0] || "";
  const rows: PdfTableRow[] = [];

  const html = block.table_body || "";
  const trMatches = html.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
  if (trMatches) {
    for (const tr of trMatches) {
      const cells: PdfTableCell[] = [];
      const tdMatches = tr.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi);
      if (tdMatches) {
        for (const td of tdMatches) {
          const colspan = parseInt(
            td.match(/colspan\s*=\s*["']?(\d+)/i)?.[1] || "1",
          );
          const rowspan = parseInt(
            td.match(/rowspan\s*=\s*["']?(\d+)/i)?.[1] || "1",
          );
          // Strip HTML tags, decode entities
          const cellText = td
            .replace(/<[^>]+>/g, "")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&nbsp;/g, " ")
            .trim();

          cells.push({
            text: cellText,
            colspan,
            rowspan,
            bbox: {
              x: bbox.x,
              y: bbox.y,
              width: bbox.width,
              height: bbox.height,
            },
          });
        }
      }
      if (cells.length > 0) rows.push({ cells });
    }
  }

  return {
    pageNumber,
    bbox,
    rows,
    caption,
    confidence: 0.9,
  };
}

function tableToMarkdown(table: PdfTable): string {
  if (table.rows.length === 0) return "";
  const lines: string[] = [];
  if (table.caption) lines.push(`**${table.caption}**\n`);

  const headerCells = table.rows[0].cells.map((c) => c.text).join(" | ");
  lines.push(`| ${headerCells} |`);
  lines.push(`| ${table.rows[0].cells.map(() => "---").join(" | ")} |`);

  for (let i = 1; i < table.rows.length; i++) {
    lines.push(`| ${table.rows[i].cells.map((c) => c.text).join(" | ")} |`);
  }
  return lines.join("\n");
}
