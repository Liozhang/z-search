/**
 * Paper Anatomy — Type definitions for the three-layer deep extraction system.
 *
 * Three layers share cross-layer primary keys:
 *   - claimId: hashClaim(claimText) — same claim text → same id across layers
 *   - itemId:  Zotero item ID — PMR is paper-level, Toulmin/Uncertainty trace to it
 *   - conceptId: zsearch_academic_knowledge.id — concept-level modality/uncertainty
 *
 * @module types/paperAnatomy
 */

// ─── Toulmin Argument Layer (claim-level) ─────────────────────────────────

export type ArgumentType =
  "deductive" | "inductive" | "abductive" | "analogical";

/**
 * Claim strength / epistemic modality. Shared across all three layers:
 * - Toulmin qualifier → modality
 * - Uncertainty signal → modality
 * - Concept aggregation → overall modality
 *
 * Ordered from strongest to weakest. Use modalityRank() for comparison.
 */
export type Modality = "definitive" | "probable" | "possible" | "speculative";

export const MODALITY_ORDER: Modality[] = [
  "definitive",
  "probable",
  "possible",
  "speculative",
];

/** Returns 0 (definitive) → 3 (speculative). Lower = stronger. */
export function modalityRank(m: Modality): number {
  return MODALITY_ORDER.indexOf(m);
}

/** Weaker of two modalities (higher rank). */
export function weakerModality(a: Modality, b: Modality): Modality {
  return modalityRank(a) >= modalityRank(b) ? a : b;
}

/** The "raw" extraction shape produced by the LLM / parser. */
export interface ExtractedArgument {
  /** MUST match a claim text in claim-evidence-links (for hashClaim alignment). */
  claimText: string;
  datum?: string;
  warrant?: string;
  backing?: string;
  qualifier?: string;
  rebuttal?: string;
  argumentType?: ArgumentType;
  modality: Modality;
  confidence: number;
  section?: string;
  locationHint?: string;
}

/** Stored Toulmin argument row (has id + claimId + sourceItemId). */
export interface ToulminArgument {
  id: number;
  claimId: string;
  claimText: string;
  sourceItemId: number | null;
  datum: string | null;
  warrant: string | null;
  backing: string | null;
  qualifier: string | null;
  rebuttal: string | null;
  argumentType: ArgumentType | null;
  modality: Modality;
  confidence: number;
  section: string | null;
  locationHint: string | null;
  createdAt: number;
  updatedAt: number;
}

// ─── PMR Structure Layer (paper-level singleton) ──────────────────────────

export interface ResultMetric {
  name: string;
  value: string;
  unit?: string;
  ci?: string;
  significance?: string;
}

// ─── Method Parameters Layer (P0 参数化 Methods) ─────────────────────────

/**
 * 方法参数类别（P0 立法：跨文献可比性的第一根轴）。
 * procedure 是最不承诺的桶 —— 抽取回退路径上无法定类的参数落这里，
 * 不丢弃（与 zod 硬门路径的严格枚举不同，见 paperAnatomySchema）。
 */
export type MethodParamCategory =
  | "sample"
  | "instrument"
  | "reagent"
  | "hyperparameter"
  | "procedure"
  | "statistical"
  | "environment";

export const METHOD_PARAM_CATEGORIES: MethodParamCategory[] = [
  "sample",
  "instrument",
  "reagent",
  "hyperparameter",
  "procedure",
  "statistical",
  "environment",
];

/** quote 最短锚定长度（< 4 chars 的"引用"是无上下文碎片；zod 门 + 归一化门共用）。 */
export const METHOD_PARAM_QUOTE_MIN = 4;

/** 单篇参数数上限（payload 膨胀护栏，同 resultMetrics 50 上限思路）。 */
export const METHOD_PARAMS_PER_PAPER_CAP = 80;

/**
 * Methods 章节的一个结构化参数事实。
 * 立法：quote 必填 —— 无原文锚定的参数是幻觉（zod 硬门 +
 * 归一化层双门，与 ConstraintPayload 的 condition 立法同型）。
 * name 是跨文献检索键（规范化 snake_case 由 prompt 约定 + 归一化层钳制）；
 * value 保真原文，valueNumeric 是可选的可比较投影（meta 分析入口）。
 */
export interface MethodParameter {
  name: string;
  /** 原文叫法（name 被规范化时保留原词）。 */
  rawName?: string;
  category: MethodParamCategory;
  value: string;
  valueNumeric?: number;
  unit?: string;
  range?: { min?: string; max?: string };
  /** 原文模糊限定词（"approximately" / "at least"）。 */
  qualifier?: string;
  /** 原文锚定（≤400 chars，必填）。 */
  quote: string;
  page?: number | null;
  section?: string | null;
}

export interface ReproducibilityInfo {
  codeUrl?: string;
  dataUrl?: string;
  preregistered?: boolean;
  seed?: string;
}

/** Raw extraction shape. */
export interface ExtractedPaperStructure {
  itemId: number;
  problem?: string;
  problemKeywords?: string[];
  method?: string;
  methodKeywords?: string[];
  methodType?: string;
  result?: string;
  resultMetrics?: ResultMetric[];
  limitation?: string;
  designType?: string;
  /** Domain-specific overlay: PICO, hyperparams, experiment conditions, etc. */
  domainOverlay?: Record<string, any>;
  reproducibility?: ReproducibilityInfo;
  /** P0 参数化 Methods：Methods 章节的结构化参数表（双轨的展示轨）。 */
  methodParameters?: MethodParameter[];
}

/** Stored PMR row. */
export interface PaperStructure {
  id: number;
  itemId: number;
  problem: string | null;
  problemKeywords: string[] | null;
  method: string | null;
  methodKeywords: string[] | null;
  methodType: string | null;
  result: string | null;
  resultMetrics: ResultMetric[] | null;
  limitation: string | null;
  designType: string | null;
  domainOverlay: Record<string, any> | null;
  reproducibility: ReproducibilityInfo | null;
  methodParameters: MethodParameter[] | null;
  extractedAt: number;
}

// ─── Uncertainty Layer (claim/concept/result level) ───────────────────────

export type UncertaintySignalType =
  | "hedging"
  | "sample_size"
  | "conflict"
  | "bias"
  | "limitation"
  | "reproducibility";

export type UncertaintyTargetType = "claim" | "concept" | "result";

export interface UncertaintySignal {
  targetType: UncertaintyTargetType;
  targetId: string;
  signalType: UncertaintySignalType;
  modality?: Modality;
  hedgingWords?: string[];
  confidence?: number;
  reason: string;
  sourceItemId?: number;
}

/** Stored uncertainty signal row. */
export interface StoredUncertaintySignal extends UncertaintySignal {
  id: number;
  detectedAt: number;
}

// ─── Aggregation Results ──────────────────────────────────────────────────

export interface ConceptAnatomySummary {
  conceptId: number;
  modality: Modality;
  uncertaintyScore: number;
  evidenceStrength: number;
  signals: StoredUncertaintySignal[];
}

export interface ClaimAnatomySummary {
  claimId: string;
  modality: Modality;
  netConfidence: number;
  signals: StoredUncertaintySignal[];
}

/** Report-level aggregation for result-builder. */
export interface UncertaintySummary {
  /** Modality distribution across all claims. */
  modalityDistribution: Record<Modality, number>;
  /** Claims with high uncertainty (> 0.6 score). */
  highUncertaintyClaims: string[];
  /** Total signal count. */
  totalSignals: number;
}
