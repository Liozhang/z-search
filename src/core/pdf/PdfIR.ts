/**
 * PdfIR — Intermediate Representation for PDF analysis.
 *
 * Defines all types produced by the OpenDataLoader analysis pipeline
 * (OpenDataLoaderJsonAdapter maps the ODL JSON output into this IR),
 * which is then consumed by AI features (translation, context, structure).
 */

export interface BBox {
  x: number; // PDF points from left
  y: number; // PDF points from bottom
  width: number;
  height: number;
}

export interface PdfTextBlock {
  text: string;
  bbox: BBox;
  fontSize: number; // derived from transform[0]
  fontName: string;
  /** True if this item has no visible content (spacing marker) */
  hasEOL: boolean;
  /**
   * Source text color as emitted by OpenDataLoader (e.g. `"[0.0, 0.0, 1.0]"`
   * for blue, `"[0.7]"` for gray). Optional — when absent the renderer falls
   * back to black. Parsed downstream by `parseTextColor`. Added so body
   * paragraphs (not just table cells) can recover their original color.
   */
  textColor?: string;
}

export type LayoutRole =
  | "body"
  | "title"
  | "abstract"
  | "heading"
  | "caption"
  | "footnote"
  | "table"
  | "figure"
  | "formula"
  | "header"
  | "footer"
  | "page-number"
  | "sidebar"
  | "margin-note"
  | "reference-entry"
  | "citation";

export interface LayoutRegion {
  role: LayoutRole;
  bbox: BBox;
  pageNumber: number;
  confidence: number;
  children?: LayoutRegion[];
  content?: PdfTextBlock[];
}

export interface PdfTable {
  pageNumber: number;
  bbox: BBox;
  rows: PdfTableRow[];
  caption?: string;
  confidence: number;
}

export interface PdfTableRow {
  cells: PdfTableCell[];
}

export interface PdfTableCell {
  text: string;
  colspan: number;
  rowspan: number;
  bbox: BBox;
  /**
   * Font size recovered from the cell's first child paragraph, when available.
   * Optional — the translate renderer falls back to a 9pt default when absent.
   * Added so translated table cells don't all render at a fixed 9pt.
   */
  fontSize?: number;
  /** Source font name, for bold/italic recovery. Optional. */
  fontName?: string;
  /** Source text color string (parsed downstream). Optional. */
  textColor?: string;
}

export type ChartType =
  "bar-chart" | "line-chart" | "pie-chart" | "scatter" | "diagram" | "unknown";

export interface PdfChartArea {
  pageNumber: number;
  bbox: BBox;
  detectedType: ChartType;
  hasAxes: boolean;
  hasLegend: boolean;
  confidence: number;
  /** Embedded base64 image data URI (from OpenDataLoader JSON `image.data`) */
  imageDataUri?: string;
}

export interface PdfFormula {
  pageNumber: number;
  bbox: BBox;
  /** Extracted text (from StructTree or raw characters) */
  textRepresentation?: string;
  /** Display (centered block) vs inline formula */
  isDisplay: boolean;
  confidence: number;
}

export type RepeatedRegionType =
  "header" | "footer" | "page-number" | "running-head";

export interface RepeatedElement {
  text: string;
  region: RepeatedRegionType;
  pageNumber: number;
  bbox: BBox;
  /** How many pages contain this same text in the same position */
  occurrences: number;
}

export interface PdfCitation {
  /** Raw citation string (e.g., "[1]", "(Smith, 2020)") */
  text: string;
  pageNumber: number;
  bbox: BBox;
  /** Citation style detected */
  style: "numeric" | "author-year" | "superscript" | "unknown";
}

export interface PdfPageAnalysis {
  pageNumber: number;
  width: number;
  height: number;
  textBlocks: PdfTextBlock[];
  regions: LayoutRegion[];
  tables: PdfTable[];
  chartAreas: PdfChartArea[];
  formulas: PdfFormula[];
  repeatedElements: RepeatedElement[];
  citations: PdfCitation[];
}

export interface PdfDocumentAnalysis {
  source: "tier2-opendataloader-pdf" | "tier2-mineru-api";
  totalPages: number;
  pages: PdfPageAnalysis[];

  // Cross-page aggregates
  allTables: PdfTable[];
  allFormulas: PdfFormula[];
  allChartAreas: PdfChartArea[];
  allCitations: PdfCitation[];

  /** Body text only, reading-order sorted, with headers/footers removed */
  filteredText: string;
  /**
   * E1 片段定位：filteredText 坐标系下每页的 [start, end) 字符区间（页序，
   * 与 filteredTextParts.join("\n\n") 的拼接记账严格一致）。由两个 adapter
   * 在页循环内随 push 记账产出；缺失（旧缓存/未升级）时消费方按整篇无页界
   * 降级。可选字段：测试夹具与旧构造点无需补齐。
   */
  filteredPageSpans?: Array<{ pageNumber: number; start: number; end: number }>;
  /** Rich markdown rendering of the full IR */
  filteredMarkdown: string;
  /** Overall pipeline confidence (0–1) */
  confidence: number;

  processingMs: number;
}

export interface AnalyzeOptions {
  maxPages?: number;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  /**
   * Restrict parsing to the local OpenDataLoader backend and disable the
   * cross-backend fallback to MinerU (a remote VLM service). Used by
   * background auto-actions that must stay local / non-AI; infra failures
   * throw PdfParseError instead of reaching for the network.
   */
  localOnly?: boolean;
}
