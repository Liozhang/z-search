/**
 * DecisionService — System 1 decision calls (JEV-class) for screening,
 * triage and gating. Transports (decision.mode):
 * - "openrouter": OpenRouter alpha Decisions API (Bearer = the user's
 *   OpenRouter key).
 * - "local": a self-hosted endpoint speaking the same Decisions contract
 *   (e.g. the laya shim) — no auth, `decision.endpoint` overrides the
 *   localhost default.
 *
 * Contract laws:
 * - `decision.mode` "off" (the default) → isAvailable() false and call sites
 *   take their legacy path. This service is strictly opt-in because decision
 *   states carry library/user content to a remote endpoint.
 * - The model pref is a pinned slug (typesafe/jev-1.13), not the ~latest
 *   alias — screening verdicts must not drift silently with upstream
 *   redirects.
 * - Only successful responses are cached; a failed decision never pins a
 *   stale verdict. Config (mode/model/key) is resolved per call, never
 *   cached on the singleton.
 * - Schema mismatches throw DecisionError("schema") — call sites own their
 *   fallback, the service never invents a default verdict.
 */

import ConfigManager from "../../utils/config/ConfigManager";
import { getPrefDynamic } from "../../utils/prefs";
import { ZSEARCH_HTTP_HEADERS } from "../../utils/httpHeaders";
import { getString } from "../../utils/locale";
import { safeDebug } from "../../utils/logger";
import { DEFAULT_DECISION_LOCAL_ENDPOINT } from "../../utils/defaults";
import cache, { CacheKeys } from "../cache/AICache";
import tokenUsageStore from "../ai/TokenUsageStore";
import {
  DecisionAnswers,
  DecisionError,
  DecisionQuestion,
  DecisionState,
  normalizeAnswers,
} from "./decisionTypes";

const OPENROUTER_DECISIONS_ENDPOINT =
  "https://openrouter.ai/api/alpha/decisions";
const OPENROUTER_PROVIDER_ID = "openrouter";
const REQUEST_TIMEOUT_MS = 30000;
/** Local CPU inference of a 421M checkpoint runs 10s+ per call and Leadero's
 *  concurrency-3 queues behind the shim's serialized forward passes — 30s
 *  would time out healthy local calls and trip the breaker. */
const LOCAL_REQUEST_TIMEOUT_MS = 90000;
const MAX_CONCURRENT = 3;
const RETRY_BACKOFF_MS = 1000;
const BREAKER_TRIP_THRESHOLD = 3;
const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Utilities Internal md5, with a length-based fallback for stubbed envs. */
function contentHash(payload: string): string {
  const utils = (Zotero as any)?.Utilities;
  const md5 = utils?.Internal?.md5 ?? utils?.sha1;
  return typeof md5 === "function" ? md5(payload) : `len:${payload.length}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class DecisionService {
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private consecutiveNetworkFailures = 0;
  private breakerTripped = false;

  /**
   * True when a decide() call can plausibly succeed: mode enabled, credentials
   * satisfied for the mode (openrouter needs the OpenRouter key; local talks
   * to a self-hosted shim with no auth) and the breaker is not tripped. Call
   * sites MUST gate on this and otherwise take their legacy path.
   */
  isAvailable(): boolean {
    if (this.breakerTripped) return false;
    const mode = String(getPrefDynamic("decision.mode") ?? "");
    if (mode === "off") return false;
    if (mode === "local") return true;
    return Boolean(this.resolveApiKey());
  }

  /**
   * Bearer for the openrouter mode: `decision.apiKey` (TypeSafe-direct key)
   * wins when set; otherwise the OpenRouter provider key from the keychain.
   */
  private resolveApiKey(): string {
    return (
      String(getPrefDynamic("decision.apiKey") ?? "").trim() ||
      String(ConfigManager.getProvider(OPENROUTER_PROVIDER_ID)?.apiKey ?? "")
    );
  }

  /** Endpoint + credential + timeout per mode; `decision.endpoint` overrides both. */
  private resolveTransport(): {
    endpoint: string;
    apiKey: string;
    timeoutMs: number;
  } {
    const mode = String(getPrefDynamic("decision.mode") ?? "");
    const endpointPref = String(
      getPrefDynamic("decision.endpoint") ?? "",
    ).trim();
    if (mode === "local") {
      return {
        endpoint: endpointPref || DEFAULT_DECISION_LOCAL_ENDPOINT,
        apiKey: "",
        timeoutMs: LOCAL_REQUEST_TIMEOUT_MS,
      };
    }
    return {
      endpoint: endpointPref || OPENROUTER_DECISIONS_ENDPOINT,
      apiKey: this.resolveApiKey(),
      timeoutMs: REQUEST_TIMEOUT_MS,
    };
  }

  /**
   * Ask the decision model one batch of typed questions about one state.
   * Returns answers keyed by question name; throws DecisionError on any
   * failure — callers decide the fallback, the service never degrades
   * silently.
   */
  async decide(
    state: DecisionState,
    questions: Record<string, DecisionQuestion>,
    opts: { sessionId?: string; cacheTtlMs?: number; noCache?: boolean } = {},
  ): Promise<DecisionAnswers> {
    if (!this.isAvailable()) {
      throw new DecisionError(
        this.breakerTripped ? "unavailable" : "not-configured",
        this.breakerTripped
          ? getString("decision-unavailable-error")
          : getString("decision-not-configured-error"),
      );
    }

    const model = String(getPrefDynamic("decision.model") ?? "").trim();
    if (!model) {
      throw new DecisionError(
        "not-configured",
        getString("decision-not-configured-error"),
      );
    }

    const payload: Record<string, unknown> = { model, state, questions };
    if (opts.sessionId) payload.session_id = opts.sessionId.slice(0, 256);

    const cacheKey = `${CacheKeys.decision(contentHash(JSON.stringify({ model, state, questions })))}:${model}`;
    if (!opts.noCache) {
      const hit = await cache.get<DecisionAnswers>(cacheKey);
      if (hit) return hit;
    }

    const raw = await this.requestWithRetry(payload);
    const answers = normalizeAnswers(raw);

    this.consecutiveNetworkFailures = 0;
    if (!opts.noCache) {
      await cache.set(
        cacheKey,
        answers,
        opts.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
      );
    }
    this.recordUsage(model, raw);
    return answers;
  }

  private async requestWithRetry(
    payload: Record<string, unknown>,
  ): Promise<unknown> {
    await this.acquireSlot();
    try {
      try {
        return await this.postDecisions(payload);
      } catch (error) {
        if (error instanceof DecisionError && isTransientError(error)) {
          safeDebug(
            `[z-search] DecisionService: transient ${error.kind}${error.status ? ` (${error.status})` : ""}, retrying once`,
          );
          await delay(RETRY_BACKOFF_MS);
          return await this.postDecisions(payload);
        }
        throw error;
      }
    } finally {
      this.releaseSlot();
    }
  }

  private async postDecisions(
    payload: Record<string, unknown>,
  ): Promise<unknown> {
    const { endpoint, apiKey, timeoutMs } = this.resolveTransport();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...ZSEARCH_HTTP_HEADERS,
    };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    let response: any;
    try {
      response = await (Zotero as any).HTTP.request("POST", endpoint, {
        headers,
        body: JSON.stringify(payload),
        responseType: "json",
        timeout: timeoutMs,
      });
    } catch (error: any) {
      this.noteNetworkFailure();
      throw new DecisionError("network", toErrorMessage(error));
    }

    if (response.status >= 400) {
      const body = response.response;
      const serverMessage = extractServerMessage(body);
      if (response.status === 429) {
        this.noteNetworkFailure();
        throw new DecisionError(
          "rate-limit",
          serverMessage || "rate limited",
          429,
        );
      }
      if (response.status === 402) {
        throw new DecisionError(
          "credits",
          serverMessage || "insufficient credits",
          402,
        );
      }
      if (response.status >= 500 || response.status === 524) {
        this.noteNetworkFailure();
        throw new DecisionError(
          "http",
          serverMessage || `HTTP ${response.status}`,
          response.status,
        );
      }
      throw new DecisionError(
        "http",
        serverMessage || `HTTP ${response.status}`,
        response.status,
      );
    }

    return response.response;
  }

  private async acquireSlot(): Promise<void> {
    if (this.active < MAX_CONCURRENT) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active += 1;
  }

  private releaseSlot(): void {
    this.active -= 1;
    const next = this.waiters.shift();
    if (next) next();
  }

  private noteNetworkFailure(): void {
    this.consecutiveNetworkFailures += 1;
    if (
      this.consecutiveNetworkFailures >= BREAKER_TRIP_THRESHOLD &&
      !this.breakerTripped
    ) {
      this.breakerTripped = true;
      safeDebug(
        `[z-search] DecisionService: breaker tripped after ${this.consecutiveNetworkFailures} consecutive network failures`,
      );
    }
  }

  private recordUsage(model: string, raw: unknown): void {
    const usage = (
      raw as { usage?: { input_tokens?: unknown; output_tokens?: unknown } }
    )?.usage;
    const promptTokens = Number(usage?.input_tokens) || 0;
    const completionTokens = Number(usage?.output_tokens) || 0;
    if (promptTokens === 0 && completionTokens === 0) return;
    // Fire-and-forget, mirroring ApiEmbeddingProvider — usage accounting must
    // never fail a decision call.
    tokenUsageStore.record({
      feature: "decision",
      modelId: model,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      isEstimated: false,
    });
  }
}

/** Transient = worth one retry: rate limits, transport failures, server-side 5xx. 4xx is deterministic and never retried. */
function isTransientError(error: DecisionError): boolean {
  if (error.kind === "rate-limit" || error.kind === "network") return true;
  return error.kind === "http" && (error.status ?? 0) >= 500;
}

function extractServerMessage(body: unknown): string {
  const data = body as any;
  if (data?.error?.message) return String(data.error.message);
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body);
      if (parsed?.error?.message) return String(parsed.error.message);
    } catch {
      /* raw string body */
    }
    return body || "";
  }
  return "";
}

function toErrorMessage(error: any): string {
  return error?.message ? String(error.message) : String(error);
}

export default new DecisionService();
