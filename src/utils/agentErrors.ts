/**
 * Agent error classification, extraction, and retry logic.
 *
 * Pure functions extracted from AgentEngine — no instance state dependency.
 *
 * 位置（C-2，2026-09-16 第四轮审计 R4 §5.1）：本件原住编排域 core/agent/，
 * 但被打包外的 ai/RequestQueue（isRateLimitError）与 ai/XhrWireMiddleware
 * （buildHttpError）反向 import——通用「HTTP 错误原语」住在编排层是 C-2 的错置。
 * 故与 C-1/C-10 同法下沉至横切 utils/（只依赖同层 truncate/error）。语义零改：
 * 分类矩阵、大小写敏感、退避数学、statusCode+status 双字段、文案逐字保持。
 */

import { truncate } from "./truncate";
import { toErrorMessage } from "./error";

/**
 * Build a structured HTTP error with status code and optional response metadata.
 * Used by StreamingFetch and ZoteroFetch to propagate HTTP context to the
 * retry layer (isRecoverableError / getRetryDelay).
 */
export function buildHttpError(
  status: number,
  message: string,
  responseBody?: string,
  responseHeaders?: Record<string, string>,
): Error {
  const err = new Error(message) as Error & {
    statusCode: number;
    status: number;
    responseBody?: string;
    responseHeaders?: Record<string, string>;
  };
  err.statusCode = status;
  err.status = status;
  if (responseBody) err.responseBody = responseBody;
  if (responseHeaders) err.responseHeaders = responseHeaders;
  return err;
}

/**
 * Detect rate-limit errors by message content.
 * Shared by isRecoverableError, getRetryDelay, and RequestQueue.
 */
export function isRateLimitError(msg: string): boolean {
  return (
    msg.includes("429") ||
    msg.includes("rate limit") ||
    msg.includes("速率限制") ||
    msg.includes("too many requests")
  );
}

/**
 * Classify whether an error is recoverable (worth retrying).
 * Client/configuration/context errors are never retried.
 */
export function isRecoverableError(e: any): boolean {
  const msg = (e.message || "").toLowerCase();
  const statusCode = e.statusCode || e.status;

  // Client errors — never retry
  if ([400, 401, 403, 404, 422].includes(statusCode)) return false;

  // Configuration errors — never retry
  if (e.code === "API_KEY_MISSING" || msg.includes("not configured"))
    return false;

  // Context/token limit exceeded — retrying won't help
  if (
    msg.includes("context_length_exceeded") ||
    msg.includes("context window") ||
    /max[_ ]?token/.test(msg) ||
    msg.includes("token limit")
  )
    return false;

  // Rate limit — recoverable
  if (isRateLimitError(msg)) return true;

  // Network errors — recoverable
  if (
    msg.includes("timeout") ||
    msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("fetch failed")
  )
    return true;

  // SDK / provider errors that may be transient
  if (msg.includes("invalid json response")) return true;
  if (msg.includes("failed to parse")) return true;

  // Server errors — 500/502/503 are potentially transient
  if (statusCode === 500 || statusCode === 502 || statusCode === 503)
    return true;
  if (msg.includes("500") || msg.includes("502") || msg.includes("503"))
    return true;

  return false;
}

/**
 * Detect context overflow errors across multiple AI providers.
 */
export function isContextOverflowError(e: any): boolean {
  const msg = (e.message || "").toLowerCase();
  const responseBody = (e.responseBody || "").toLowerCase();
  const combined = `${msg} ${responseBody}`;

  // Anthropic
  if (combined.includes("prompt_too_long")) return true;
  // OpenAI
  if (
    combined.includes("maximum context length") ||
    combined.includes("maximum number of tokens")
  )
    return true;
  // Google/Gemini
  if (
    combined.includes("exceeds the maximum number of tokens") ||
    combined.includes("token limit exceeded")
  )
    return true;
  // Common patterns
  if (
    combined.includes("context_length_exceeded") ||
    combined.includes("context window")
  )
    return true;
  if (combined.includes("token limit") && !combined.includes("rate"))
    return true;
  // HTTP 400 with token hints
  const statusCode = e.statusCode || e.status;
  if (
    statusCode === 400 &&
    (combined.includes("token") ||
      combined.includes("context") ||
      combined.includes("input too large"))
  )
    return true;

  return false;
}

/**
 * Extract meaningful error message from SDK errors (APICallError, etc.)
 * which often have the real info in cause/responseBody instead of message.
 */
export function extractErrorMessage(e: any): string {
  const base = toErrorMessage(e);
  // Vercel AI SDK APICallError: responseBody contains the raw server response
  const responseBody = (e as any).responseBody;
  if (responseBody && typeof responseBody === "string") {
    // Truncate large responses to avoid flooding the chat
    const truncated = truncate(responseBody, 500);
    return `${base}\n${truncated}`;
  }
  // Error cause might have additional details
  const cause = e.cause?.message || e.cause?.toString?.();
  if (cause && cause !== base) {
    return `${base}: ${cause}`;
  }
  return base;
}

/**
 * Calculate retry delay with exponential backoff and jitter.
 */
export function getRetryDelay(e: any, attempt: number): number {
  // Honor Retry-After header if present (Vercel AI SDK APICallError)
  // HTTP headers are case-insensitive; normalize keys to lowercase.
  const rawHeaders = e.responseHeaders as Record<string, string> | undefined;
  const headers = rawHeaders
    ? Object.fromEntries(
        Object.entries(rawHeaders).map(([k, v]) => [k.toLowerCase(), v]),
      )
    : undefined;
  const retryAfter = headers?.["retry-after"];
  if (retryAfter) {
    const seconds = parseInt(retryAfter, 10);
    if (!isNaN(seconds) && seconds > 0 && seconds <= 120) {
      return seconds * 1000;
    }
  }

  const msg = (e.message || "").toLowerCase();
  const isRateLimit = isRateLimitError(msg);
  const baseDelay = isRateLimit ? 5000 : 2000;
  const maxDelay = 60000;
  const delay = Math.min(maxDelay, baseDelay * Math.pow(2, attempt - 1));

  // Jitter: ±20% to avoid thundering herd
  return delay * (0.8 + Math.random() * 0.4);
}
