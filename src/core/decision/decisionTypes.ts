/**
 * Decision-model contract (System 1 / JEV-class) — pure types, normalization
 * and threshold helpers shared by DecisionService and its call sites.
 *
 * Wire contract follows the OpenRouter alpha Decisions API
 * (POST /api/alpha/decisions). The shapes below are transport-independent on
 * purpose: a future local checkpoint (e.g. self-hosted Laya) implements the
 * same question/answer interface behind a different `decision.mode`.
 *
 * Fail-closed law: `normalizeAnswers` throws on any malformed entry instead
 * of coercing a default branch — call sites own their fallback, never the
 * service.
 */

export type DecisionQuestionType = "noul" | "choice" | "score";

/**
 * Criteria payload by question type:
 * - noul  → `{ true: "when yes", false: "when no" }`
 * - choice → `{ optionId: "when this option" }`
 * - score → `["level 0 desc", "level 1 desc", ...]` (ordinal, index = score)
 */
export type DecisionCriteria = Record<string, string> | string[];

export interface DecisionQuestion {
  type: DecisionQuestionType;
  instructions: string;
  criteria?: DecisionCriteria;
}

export interface DecisionNoulAnswer {
  type: "noul";
  /** Calibrated yes-probability, 0..1. */
  noul: number;
}

export interface DecisionChoiceAnswer {
  type: "choice";
  choice: string;
  confidence?: number;
  probabilities?: Record<string, number>;
}

export interface DecisionScoreAnswer {
  type: "score";
  score: number;
  confidence?: number;
  probabilities?: Record<string, number>;
  legend?: Record<string, string>;
}

export type DecisionAnswer =
  DecisionNoulAnswer | DecisionChoiceAnswer | DecisionScoreAnswer;

export type DecisionAnswers = Record<string, DecisionAnswer>;

export type DecisionState = string | object | unknown[];

export type DecisionErrorKind =
  | "not-configured"
  | "unavailable"
  | "rate-limit"
  | "credits"
  | "schema"
  | "http"
  | "network";

export class DecisionError extends Error {
  readonly kind: DecisionErrorKind;
  readonly status?: number;

  constructor(kind: DecisionErrorKind, message: string, status?: number) {
    super(message);
    this.name = "DecisionError";
    this.kind = kind;
    this.status = status;
  }
}

/**
 * Normalize the raw `answers` object of a Decisions response. Throws
 * DecisionError("schema") on any malformed entry — no per-entry tolerance,
 * so a partial/garbage payload can never be read as a verdict.
 */
export function normalizeAnswers(raw: unknown): DecisionAnswers {
  if (!raw || typeof raw !== "object") {
    throw new DecisionError(
      "schema",
      "decisions response has no answers object",
    );
  }
  const answers = (raw as { answers?: unknown }).answers;
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
    throw new DecisionError(
      "schema",
      "decisions response has no answers object",
    );
  }

  const out: DecisionAnswers = {};
  for (const [name, entry] of Object.entries(
    answers as Record<string, unknown>,
  )) {
    out[name] = normalizeAnswer(name, entry);
  }
  if (Object.keys(out).length === 0) {
    throw new DecisionError(
      "schema",
      "decisions response answers object is empty",
    );
  }
  return out;
}

function normalizeAnswer(name: string, entry: unknown): DecisionAnswer {
  if (!entry || typeof entry !== "object") {
    throw new DecisionError("schema", `answer "${name}" is not an object`);
  }
  const rec = entry as Record<string, unknown>;
  const type = rec.type;
  if (type === "noul") {
    const noul = rec.noul;
    if (typeof noul !== "number" || !Number.isFinite(noul)) {
      throw new DecisionError(
        "schema",
        `noul answer "${name}" has no finite probability`,
      );
    }
    return { type: "noul", noul: Math.min(1, Math.max(0, noul)) };
  }
  if (type === "choice") {
    const choice = rec.choice;
    if (typeof choice !== "string" || choice.length === 0) {
      throw new DecisionError(
        "schema",
        `choice answer "${name}" has no choice value`,
      );
    }
    return {
      type: "choice",
      choice,
      confidence: optionalConfidence(rec),
      probabilities: optionalProbabilities(rec),
    };
  }
  if (type === "score") {
    const score = rec.score;
    if (typeof score !== "number" || !Number.isFinite(score)) {
      throw new DecisionError(
        "schema",
        `score answer "${name}" has no finite score`,
      );
    }
    return {
      type: "score",
      score,
      confidence: optionalConfidence(rec),
      probabilities: optionalProbabilities(rec),
      legend: optionalLegend(rec),
    };
  }
  throw new DecisionError(
    "schema",
    `answer "${name}" has unknown type ${String(type)}`,
  );
}

function optionalConfidence(
  entry: Record<string, unknown>,
): number | undefined {
  const v = entry.confidence;
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function optionalProbabilities(
  entry: Record<string, unknown>,
): Record<string, number> | undefined {
  const v = entry.probabilities;
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const out: Record<string, number> = {};
  for (const [k, p] of Object.entries(v as Record<string, unknown>)) {
    if (typeof p === "number" && Number.isFinite(p)) out[k] = p;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function optionalLegend(
  entry: Record<string, unknown>,
): Record<string, string> | undefined {
  const v = entry.legend;
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, label] of Object.entries(v as Record<string, unknown>)) {
    if (typeof label === "string") out[k] = label;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Two-threshold noul verdict. Returns true at/above `passAt`, false at/below
 * `failAt`, undefined in the uncertain band (or for any non-noul answer) —
 * undefined always means "caller takes its legacy path".
 */
export function noulTri(
  answer: DecisionAnswer | undefined,
  opts: { passAt: number; failAt: number },
): boolean | undefined {
  if (!answer || answer.type !== "noul") return undefined;
  const p = answer.noul;
  if (!Number.isFinite(p)) return undefined;
  if (p >= opts.passAt) return true;
  if (p <= opts.failAt) return false;
  return undefined;
}

/** Type-guard accessor: the noul probability of a named answer, if it is one. */
export function noulOf(answer: DecisionAnswer | undefined): number | undefined {
  return answer && answer.type === "noul" && Number.isFinite(answer.noul)
    ? answer.noul
    : undefined;
}

/** Type-guard accessor: the chosen option of a named answer, if it is one. */
export function choiceOf(
  answer: DecisionAnswer | undefined,
): string | undefined {
  return answer && answer.type === "choice" && answer.choice
    ? answer.choice
    : undefined;
}
