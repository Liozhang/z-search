/**
 * OpenDataLoaderJsonAdapter — Map OpenDataLoader JSON output to Leadero PdfIR.
 *
 * OpenDataLoader's `--format json` emits a schema described by `schema.json`:
 *   - top-level: file name, number of pages, author, title, creation date,
 *     modification date, kids[]
 *   - kids[] elements: heading, paragraph, table, image, list, caption,
 *     headerFooter, textBlock
 *   - each element carries: type, id, page number, bounding box [left,bottom,right,top],
 *     plus type-specific fields (font/fontSize/textColor/content for text,
 *     rows/cells for tables, etc.)
 *
 * This adapter converts that shape into Leadero's PdfIR types so the
 * PdfAnalyzerPipeline / tool handlers can consume OpenDataLoader as the
 * single PDF analysis backend.
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
  ChartType,
  RepeatedElement,
  RepeatedRegionType,
  BBox,
  LayoutRegion,
  LayoutRole,
  PdfCitation,
} from "./PdfIR";

import { parseItemPdfToJson } from "../tool/builtin/atomic/opendataloader-pdf-parser";
import { PdfParseError, classifyOdlError } from "./PdfParseError";

// ---------------------------------------------------------------------------
// OpenDataLoader JSON shapes (minimal view of schema.json we care about)
// ---------------------------------------------------------------------------

interface ODLBaseElement {
  type: string;
  id: number;
  pageNumber: number;
  boundingBox: [number, number, number, number]; // [left, bottom, right, top]
}

interface ODLTextProperties {
  font: string;
  fontSize: number;
  textColor: string;
  content: string;
  hiddenText?: boolean;
}

interface ODLHeading extends ODLBaseElement, ODLTextProperties {
  type: "heading";
  headingLevel: number;
  level?: string; // Doctitle / H1 / H2 ...
}

interface ODLParagraph extends ODLBaseElement, ODLTextProperties {
  type: "paragraph";
}

interface ODLTableCell extends ODLBaseElement {
  type: "table cell";
  rowNumber: number;
  columnNumber: number;
  rowSpan: number;
  columnSpan: number;
  kids: ODLContentElement[];
}

interface ODLTableRow {
  type: "table row";
  rowNumber: number;
  cells: ODLTableCell[];
}

interface ODLTable extends ODLBaseElement {
  type: "table";
  numberOfRows: number;
  numberOfColumns: number;
  previousTableId?: number;
  nextTableId?: number;
  rows: ODLTableRow[];
}

interface ODLImage extends ODLBaseElement {
  type: "image";
  source?: string;
  data?: string; // base64 data URI when image-output=embedded
  format?: "png" | "jpeg";
}

interface ODLFormula extends ODLBaseElement {
  type: "formula";
  latex?: string;
  text?: string;
  isDisplay?: boolean;
}

interface ODLCitation extends ODLBaseElement, ODLTextProperties {
  type: "citation";
  doi?: string;
  url?: string;
}

interface ODLChart extends ODLBaseElement {
  type: "chart";
  source?: string;
  data?: string;
  format?: "png" | "jpeg";
  chartType?: "bar" | "line" | "pie" | "scatter" | "unknown";
}

interface ODLHeaderFooter extends ODLBaseElement {
  type: "header" | "footer";
  kids: ODLContentElement[];
}

interface ODLCaption extends ODLBaseElement, ODLTextProperties {
  type: "caption";
  linkedContentId?: number;
}

interface ODLTextBlock extends ODLBaseElement {
  type: "textBlock";
  kids: ODLContentElement[];
}

interface ODLList extends ODLBaseElement {
  type: "list";
  numberingStyle: string;
  numberOfListItems: number;
  listItems: ODLListItem[];
}

interface ODLListItem extends ODLBaseElement, ODLTextProperties {
  type: "list item";
  kids: ODLContentElement[];
}

type ODLContentElement =
  | ODLHeading
  | ODLParagraph
  | ODLTable
  | ODLImage
  | ODLFormula
  | ODLCitation
  | ODLChart
  | ODLHeaderFooter
  | ODLCaption
  | ODLTextBlock
  | ODLList
  | ODLListItem
  | ODLTableCell;

interface ODLDocumentRoot {
  "file name": string;
  "number of pages": number;
  author: string | null;
  title: string | null;
  "creation date": string | null;
  "modification date": string | null;
  kids: ODLContentElement[];
}

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

/**
 * OpenDataLoader JSON uses snake_case keys with spaces (e.g. "page number",
 * "bounding box", "font size"). Normalize them to the camelCase names used
 * by the TypeScript interfaces so the rest of the adapter can rely on typed
 * property access.
 */
const KEY_NORMALIZATION_MAP: Record<string, string> = {
  "page number": "pageNumber",
  "bounding box": "boundingBox",
  "font size": "fontSize",
  "text color": "textColor",
  "heading level": "headingLevel",
  "row number": "rowNumber",
  "column number": "columnNumber",
  "row span": "rowSpan",
  "column span": "columnSpan",
  // ODL nests list children under "list items" (space-separated). Without this
  // mapping the adapter's `ODLList.listItems` field stayed undefined, so every
  // list's children were silently dropped (b.json lost 6.2% of its text this way).
  "list items": "listItems",
  "number of list items": "numberOfListItems",
  "numbering style": "numberingStyle",
};

function normalizeOdlElement(el: any): void {
  if (!el || typeof el !== "object") return;
  for (const [from, to] of Object.entries(KEY_NORMALIZATION_MAP)) {
    if (from in el) {
      el[to] = el[from];
    }
  }
  if (Array.isArray(el.kids)) {
    for (const kid of el.kids) {
      normalizeOdlElement(kid);
    }
  }
  // Recurse into list items so their snake_case keys get normalized too.
  // Without this, list item content/bbox/font were left under their original
  // space-separated keys and never read by the typed accessors downstream.
  if (Array.isArray(el.listItems)) {
    for (const item of el.listItems) {
      normalizeOdlElement(item);
    }
  }
  if (Array.isArray(el.rows)) {
    for (const row of el.rows) {
      if (Array.isArray(row.cells)) {
        for (const cell of row.cells) {
          normalizeOdlElement(cell);
        }
      }
    }
  }
}

function toBBox(box: [number, number, number, number]): BBox {
  const [left, bottom, right, top] = box;
  return {
    x: left,
    y: bottom,
    width: right - left,
    height: top - bottom,
  };
}

/**
 * Infer the real page dimension from a content extent. OpenDataLoader JSON
 * carries no MediaBox, so we only know how far the content reaches. A standard
 * page (US Letter, A4, Legal) with 72pt (1 inch) margins on both sides has a
 * known content-area width/height. If the observed content extent fits within
 * that content area (i.e. is <= it and not absurdly smaller), we snap to that
 * standard page. `candidates` is a list of `[pageSize, contentArea]` pairs.
 *
 * Returns the standard page size, or 0 if no standard is plausible (caller
 * falls back to the raw content extent).
 */
function inferStandardPage(
  contentExtent: number,
  candidates: Array<[number, number]>,
): number {
  if (contentExtent <= 0) return 0;
  // Accept a standard page if the content extent is at least 60% of its content
  // area and at most 100% (content shouldn't exceed the printable area, but
  // allow a little slack for full-bleed elements).
  for (const [pageSize, contentArea] of candidates) {
    if (
      contentExtent >= contentArea * 0.6 &&
      contentExtent <= contentArea * 1.1
    ) {
      return pageSize;
    }
  }
  return 0;
}

function textPropsToBlock(
  el: ODLHeading | ODLParagraph | ODLListItem,
  _role: LayoutRole,
): PdfTextBlock {
  return {
    text: el.content,
    bbox: toBBox(el.boundingBox),
    fontSize: el.fontSize,
    fontName: el.font,
    hasEOL: false,
    ...(el.textColor != null ? { textColor: el.textColor } : {}),
  };
}

function isHeading(el: ODLContentElement): el is ODLHeading {
  return el.type === "heading";
}

function isParagraph(el: ODLContentElement): el is ODLParagraph {
  return el.type === "paragraph";
}

function isTable(el: ODLContentElement): el is ODLTable {
  return el.type === "table";
}

function isImage(el: ODLContentElement): el is ODLImage {
  return el.type === "image";
}

function isHeaderFooter(el: ODLContentElement): el is ODLHeaderFooter {
  return el.type === "header" || el.type === "footer";
}

function isCaption(el: ODLContentElement): el is ODLCaption {
  return el.type === "caption";
}

function isTextBlock(el: ODLContentElement): el is ODLTextBlock {
  return el.type === "textBlock";
}

function isListItem(el: ODLContentElement): el is ODLListItem {
  return el.type === "list item";
}

function isList(el: ODLContentElement): el is ODLList {
  return el.type === "list";
}

function isFormula(el: ODLContentElement): el is ODLFormula {
  return el.type === "formula";
}

function isCitation(el: ODLContentElement): el is ODLCitation {
  return el.type === "citation";
}

function isChart(el: ODLContentElement): el is ODLChart {
  return el.type === "chart";
}

// ---------------------------------------------------------------------------
// Public adapter
// ---------------------------------------------------------------------------

/**
 * Convert an OpenDataLoader JSON document root into Leadero's PdfDocumentAnalysis.
 *
 * The conversion is intentionally lossy where OpenDataLoader does not provide
 * the same signal as the pdf.js pipeline:
 *   - formulas: only kept if the JSON explicitly contains `type === "formula"`
 *     (via hybrid/backend enrichment); otherwise formula arrays are empty
 *   - chartAreas: images are mapped to generic `unknown` chart areas; OpenDataLoader
 *     does not classify bar/line/pie/scatter
 *   - columns: not explicitly emitted by OpenDataLoader; left null
 *   - citations: not emitted; left empty
 */
export function adaptOpenDataLoaderJson(
  root: ODLDocumentRoot,
): PdfDocumentAnalysis {
  const totalPages = root["number of pages"];
  const pages: PdfPageAnalysis[] = [];

  // Normalize snake_case / spaced keys from raw JSON into the camelCase names
  // expected by the TypeScript interfaces and the code below.
  for (const kid of root.kids) {
    normalizeOdlElement(kid);
  }

  // Group kids by page number, preserving original order within each page.
  // OpenDataLoader already sorts by reading order when --reading-order=xycut.
  const byPage = new Map<number, ODLContentElement[]>();
  for (const kid of root.kids) {
    const arr = byPage.get(kid.pageNumber) || [];
    arr.push(kid);
    byPage.set(kid.pageNumber, arr);
  }

  const allTables: PdfTable[] = [];
  const allFormulas: PdfFormula[] = [];
  const allChartAreas: PdfChartArea[] = [];
  const allCitations: PdfCitation[] = [];

  // We'll collect filtered markdown and text across all pages.
  const filteredTextParts: string[] = [];
  const filteredMarkdownParts: string[] = [];
  // E1 片段定位：页界记账。pushFilteredText 与文末 join("\n\n") 的增量
  // 长度严格一致（首段无分隔符，其后每段 +2），页首段起点即页 span.start。
  const filteredPageSpans: Array<{
    pageNumber: number;
    start: number;
    end: number;
  }> = [];
  let filteredAcc = 0;
  let openPageSpan: { pageNumber: number; start: number; end: number } | null =
    null;
  const pushFilteredText = (content: string, pageNo: number) => {
    // E1 回归修复：ba4283c2 重构时丢了 filteredTextParts.push，filteredText
    // 从此恒为空串（全库 PDF 走 no-text skip）。收集点收敛回本函数——
    // 所有调用点都是应进 filteredText 的正文，+2 记账与 join("\n\n") 严格一致。
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

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const kids = byPage.get(pageNum) || [];
    const textBlocks: PdfTextBlock[] = [];
    const tables: PdfTable[] = [];
    const formulas: PdfFormula[] = [];
    const chartAreas: PdfChartArea[] = [];
    const repeatedElements: RepeatedElement[] = [];
    const regions: LayoutRegion[] = [];

    let pageWidth = 0;
    let pageHeight = 0;
    // Track the content extent's LOWER edges too, so we can estimate the real
    // page size from the content range + typical margins. OpenDataLoader's JSON
    // does NOT carry a MediaBox, so the previous code (max right/top only)
    // under-sized pages whenever content didn't fill the page (e.g. the last
    // page of a paper). For a.pdf the estimate was 540×682 vs the real 612×792.
    let minLeft = Infinity;
    let minBottom = Infinity;

    for (const kid of kids) {
      // Track page dimensions from any bbox.
      const [left, bottom, right, top] = kid.boundingBox;
      pageWidth = Math.max(pageWidth, right);
      pageHeight = Math.max(pageHeight, top);
      if (left < minLeft) minLeft = left;
      if (bottom < minBottom) minBottom = bottom;

      if (isHeading(kid)) {
        const block = textPropsToBlock(kid, "heading");
        textBlocks.push(block);
        pushFilteredText(kid.content, pageNum);
        filteredMarkdownParts.push(
          `${"#".repeat(kid.headingLevel)} ${kid.content}`,
        );
        regions.push({
          role: "heading",
          bbox: block.bbox,
          pageNumber: kid.pageNumber,
          confidence: 1,
          content: [block],
        });
      } else if (isParagraph(kid)) {
        const block = textPropsToBlock(kid, "body");
        textBlocks.push(block);
        pushFilteredText(kid.content, pageNum);
        filteredMarkdownParts.push(kid.content);
        regions.push({
          role: "body",
          bbox: block.bbox,
          pageNumber: kid.pageNumber,
          confidence: 1,
          content: [block],
        });
      } else if (isTable(kid)) {
        const table = adaptTable(kid);
        tables.push(table);
        allTables.push(table);
        filteredMarkdownParts.push(tableToMarkdown(table));
      } else if (isChart(kid)) {
        // ODL explicitly emits chart type with optional chartType field.
        const bbox = toBBox(kid.boundingBox);
        const detectedType: ChartType =
          kid.chartType === "bar"
            ? "bar-chart"
            : kid.chartType === "line"
              ? "line-chart"
              : kid.chartType === "pie"
                ? "pie-chart"
                : kid.chartType === "scatter"
                  ? "scatter"
                  : "unknown";
        chartAreas.push({
          pageNumber: kid.pageNumber,
          bbox,
          detectedType,
          hasAxes: ["bar-chart", "line-chart", "scatter"].includes(
            detectedType,
          ),
          hasLegend: ["pie-chart", "bar-chart", "line-chart"].includes(
            detectedType,
          ),
          confidence: 0.8,
        });
        allChartAreas.push(chartAreas[chartAreas.length - 1]);
      } else if (isImage(kid)) {
        const bbox = toBBox(kid.boundingBox);
        const chartArea: PdfChartArea = {
          pageNumber: kid.pageNumber,
          bbox,
          detectedType: "unknown",
          hasAxes: false,
          hasLegend: false,
          confidence: 0.6,
        };
        if (kid.data) {
          chartArea.imageDataUri = kid.data;
        }
        chartAreas.push(chartArea);
        allChartAreas.push(chartArea);
      } else if (isFormula(kid)) {
        const bbox = toBBox(kid.boundingBox);
        const formula: PdfFormula = {
          pageNumber: kid.pageNumber,
          bbox,
          textRepresentation: kid.latex || kid.text || "",
          isDisplay: kid.isDisplay ?? true,
          confidence: 0.9,
        };
        formulas.push(formula);
        allFormulas.push(formula);
      } else if (isCitation(kid)) {
        const bbox = toBBox(kid.boundingBox);
        const citation: PdfCitation = {
          text: kid.content,
          pageNumber: kid.pageNumber,
          bbox,
          style: "unknown",
          ...(kid.doi ? { doi: kid.doi } : {}),
          ...(kid.url ? { url: kid.url } : {}),
        };
        allCitations.push(citation);
        // NOTE: citations (e.g. "[1]", "(Smith, 2020)") are NOT pushed into
        // textBlocks. They should be preserved verbatim, not translated.
        // Downstream text consumers read them via `allCitations` / the
        // document-level `filteredText` aggregate instead.
      } else if (isHeaderFooter(kid)) {
        const regionType: RepeatedRegionType =
          kid.type === "header" ? "header" : "footer";
        const text = kid.kids
          .map((c) => ("content" in c ? c.content : ""))
          .join(" ")
          .trim();
        repeatedElements.push({
          text,
          region: regionType,
          pageNumber: kid.pageNumber,
          bbox: toBBox(kid.boundingBox),
          occurrences: 1,
        });
        // NOTE: headers/footers (page numbers, running heads) are NOT pushed
        // into textBlocks. They were previously emitted with fontSize:0 (then
        // clamped to 10pt) and got translated — producing translated page
        // numbers and re-translating the same running head on every page.
        // They remain available via `repeatedElements` for filtering/analysis.
      } else if (isCaption(kid)) {
        const block: PdfTextBlock = {
          text: kid.content,
          bbox: toBBox(kid.boundingBox),
          fontSize: kid.fontSize,
          fontName: kid.font,
          hasEOL: false,
        };
        textBlocks.push(block);
        regions.push({
          role: "caption",
          bbox: block.bbox,
          pageNumber: kid.pageNumber,
          confidence: 1,
          content: [block],
        });
      } else if (isTextBlock(kid)) {
        // Recursively flatten textBlock kids into this page's structures.
        // textBlock is a grouping node; its children are the real content.
        flattenTextBlock(kid, pageNum, textBlocks, regions, tables, formulas);
      } else if (isListItem(kid)) {
        const block = textPropsToBlock(kid, "body");
        textBlocks.push(block);
        pushFilteredText(kid.content, pageNum);
        filteredMarkdownParts.push(`- ${kid.content}`);
        regions.push({
          role: "body",
          bbox: block.bbox,
          pageNumber: kid.pageNumber,
          confidence: 1,
          content: [block],
        });
      } else if (isList(kid)) {
        // ODL nests the actual text under list → list items[]. Without this
        // branch the list container was skipped entirely and its children were
        // never flattened into textBlocks, silently dropping ~6% of b.json's
        // text content. Each list item carries content/bbox/font exactly like
        // a paragraph, so we reuse textPropsToBlock. Nested paragraph kids
        // inside an item are flattened too (rare but present in real docs).
        const items = kid.listItems ?? [];
        for (const item of items) {
          const itemText = (item.content || "").trim();
          if (itemText) {
            const block = textPropsToBlock(item, "body");
            textBlocks.push(block);
            pushFilteredText(itemText, pageNum);
            filteredMarkdownParts.push(`- ${itemText}`);
            regions.push({
              role: "body",
              bbox: block.bbox,
              pageNumber: kid.pageNumber,
              confidence: 1,
              content: [block],
            });
          }
          // Some list items nest further paragraph kids (observed in b.json).
          if (Array.isArray(item.kids)) {
            for (const nested of item.kids) {
              if (isParagraph(nested) || isCaption(nested)) {
                const nestedBlock = textPropsToBlock(nested as any, "body");
                textBlocks.push(nestedBlock);
                pushFilteredText((nested as any).content, pageNum);
                filteredMarkdownParts.push((nested as any).content);
              }
            }
          }
        }
      }
    }

    // Estimate the real page size. ODL JSON carries no MediaBox, and the raw
    // `max right/top` underestimates whenever content doesn't fill the page
    // (last page of a paper, sparse pages). We compute the content extent
    // (max-min) and use it as a LOWER BOUND: a real page is at least as wide/tall
    // as its content, and most documents use one consistent page size throughout.
    // The final per-page value is reconciled against the document-wide median in
    // `adaptOpenDataLoaderJson` after all pages are processed (see below). This
    // only affects the WHITE-PAGE fallback render path; overlay mode (the
    // default) uses the source PDF's real MediaBox.
    const contentW = minLeft !== Infinity ? pageWidth - minLeft : pageWidth;
    const contentH =
      minBottom !== Infinity ? pageHeight - minBottom : pageHeight;

    pages.push({
      pageNumber: pageNum,
      width: contentW || 612,
      height: contentH || 792,
      textBlocks,
      regions,
      tables,
      chartAreas,
      formulas,
      repeatedElements,
      citations: [],
    });
  }

  // Reconcile per-page sizes: most documents use ONE consistent page size
  // throughout, but ODL gives us only content extent per page. Sparse pages
  // (last page, section breaks) report a much smaller extent than full pages.
  // Take the MEDIAN content extent across all pages as the document's content
  // footprint, then SNAP to the nearest standard paper size whose content area
  // (page minus two 72pt margins) could contain that footprint. This is a
  // fallback for the WHITE-PAGE render path only; overlay mode (the default)
  // reads the real MediaBox from the source PDF.
  if (pages.length > 0) {
    const ws = pages.map((p) => p.width).sort((a, b) => a - b);
    const hs = pages.map((p) => p.height).sort((a, b) => a - b);
    const medianW = ws[Math.floor(ws.length / 2)];
    const medianH = hs[Math.floor(hs.length / 2)];
    const finalW =
      inferStandardPage(medianW, [
        [612, 468],
        [595, 451],
        [612, 468],
      ]) ||
      medianW ||
      612;
    const finalH =
      inferStandardPage(medianH, [
        [792, 648],
        [842, 698],
        [1008, 864],
      ]) ||
      medianH ||
      792;
    for (const p of pages) {
      p.width = finalW;
      p.height = finalH;
    }
  }

  if (openPageSpan) filteredPageSpans.push(openPageSpan);

  return {
    source: "tier2-opendataloader-pdf",
    totalPages,
    pages,
    allTables,
    allFormulas,
    allChartAreas,
    allCitations,
    filteredText: filteredTextParts.join("\n\n"),
    filteredPageSpans,
    filteredMarkdown: filteredMarkdownParts.join("\n\n"),
    confidence: 0.9,
    processingMs: 0,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function adaptTable(odl: ODLTable): PdfTable {
  const rows: PdfTableRow[] = [];
  for (const row of odl.rows) {
    const cells: PdfTableCell[] = row.cells.map((cell) => {
      // Recover per-cell font size / name / color from the first child that
      // carries them. ODL table cells contain paragraph kids; without this
      // the translate renderer hard-codes all cells to 9pt.
      const styled = cell.kids.find(
        (k) => "fontSize" in k && typeof k.fontSize === "number",
      ) as
        | (ODLContentElement & {
            fontSize?: number;
            font?: string;
            textColor?: string;
          })
        | undefined;
      return {
        text: cell.kids
          .map((k) => ("content" in k ? k.content : ""))
          .join(" ")
          .trim(),
        colspan: cell.columnSpan,
        rowspan: cell.rowSpan,
        bbox: toBBox(cell.boundingBox),
        ...(styled?.fontSize ? { fontSize: styled.fontSize } : {}),
        ...(styled?.font ? { fontName: styled.font } : {}),
        ...(styled?.textColor ? { textColor: styled.textColor } : {}),
      };
    });
    rows.push({ cells });
  }
  return {
    pageNumber: odl.pageNumber,
    bbox: toBBox(odl.boundingBox),
    rows,
    caption: undefined,
    confidence: 1,
  };
}

function tableToMarkdown(table: PdfTable): string {
  if (table.rows.length === 0) return "";
  const cols = table.rows[0].cells.length;
  const lines: string[] = [];
  for (let i = 0; i < table.rows.length; i++) {
    const row = table.rows[i];
    const line = row.cells.map((c) => `| ${c.text.trim()} `).join("") + "|";
    lines.push(line);
    if (i === 0) {
      lines.push("|" + " --- |".repeat(cols));
    }
  }
  return lines.join("\n");
}

function flattenTextBlock(
  block: ODLTextBlock,
  pageNumber: number,
  textBlocks: PdfTextBlock[],
  regions: LayoutRegion[],
  tables: PdfTable[],
  formulas: PdfFormula[],
): void {
  for (const kid of block.kids) {
    if (isHeading(kid)) {
      textBlocks.push(textPropsToBlock(kid, "heading"));
      regions.push({
        role: "heading",
        bbox: toBBox(kid.boundingBox),
        pageNumber: kid.pageNumber,
        confidence: 1,
        content: [textBlocks[textBlocks.length - 1]],
      });
    } else if (isParagraph(kid)) {
      textBlocks.push(textPropsToBlock(kid, "body"));
      regions.push({
        role: "body",
        bbox: toBBox(kid.boundingBox),
        pageNumber: kid.pageNumber,
        confidence: 1,
        content: [textBlocks[textBlocks.length - 1]],
      });
    } else if (isTable(kid)) {
      tables.push(adaptTable(kid));
    } else if (isCaption(kid)) {
      textBlocks.push({
        text: kid.content,
        bbox: toBBox(kid.boundingBox),
        fontSize: kid.fontSize,
        fontName: kid.font,
        hasEOL: false,
      });
    } else if (isImage(kid)) {
      // images inside textBlock are treated as chart areas.
      // handled at caller level if needed; skip here to avoid duplicates.
    } else if (isTextBlock(kid)) {
      flattenTextBlock(kid, pageNumber, textBlocks, regions, tables, formulas);
    }
    // Other nested types are ignored in Phase 1.
  }
}

// ---------------------------------------------------------------------------
// Zotero-item-level wrapper
// ---------------------------------------------------------------------------

/**
 * Analyze a Zotero item's PDF via OpenDataLoader JSON output.
 *
 * This is the only analysis path: it resolves the PDF attachment, invokes
 * `parseItemPdfToJson`, and adapts the resulting JSON into PdfDocumentAnalysis.
 *
 * @throws PdfParseError when OpenDataLoader is disabled/unavailable or the
 *   parse/adapt step fails.
 * @throws AbortError (name === "AbortError") when the caller's signal fired —
 *   M-20: cancellation propagates as an AbortError instead of a fake "empty
 *   analysis" (which downstream converted to no-text / triggered fallback).
 */
export async function analyzePdfFromOpenDataLoader(
  itemId: number,
  options?: { startPage?: number; endPage?: number; signal?: AbortSignal },
): Promise<PdfDocumentAnalysis> {
  const startTime = Date.now();

  // M-20: cancelled before we started — propagate, don't fabricate an empty
  // analysis (it used to surface as PdfParseError("no-text") downstream).
  if (options?.signal?.aborted) {
    throw Object.assign(new Error("OpenDataLoader analysis aborted"), {
      name: "AbortError",
    });
  }

  const result = await parseItemPdfToJson(itemId, options);

  // M-20: cancelled mid-run (runProcess resolves "aborted" via the signal) —
  // surface it as an AbortError, not a generic parse failure.
  if (options?.signal?.aborted) {
    throw Object.assign(new Error("OpenDataLoader analysis aborted"), {
      name: "AbortError",
    });
  }

  if (!result.success || !result.data) {
    throw new PdfParseError(
      classifyOdlError(result.error || "OpenDataLoader JSON parsing failed"),
    );
  }

  let analysis: PdfDocumentAnalysis;
  try {
    analysis = adaptOpenDataLoaderJson(result.data);
  } catch (e: any) {
    throw new PdfParseError(
      "parse-failed",
      `failed to adapt OpenDataLoader JSON: ${e?.message ?? e}`,
    );
  }

  if (analysis.pages.length === 0 && !analysis.filteredText.trim()) {
    throw new PdfParseError("no-text");
  }

  return {
    ...analysis,
    processingMs: Date.now() - startTime,
  };
}
