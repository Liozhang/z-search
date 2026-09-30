/**
 * rateLimit — 429 限流统一原语（自兄弟仓库 leadero 搬入，见
 * docs/optimization-from-siblings-2026-09-30.md 第 1 项）。
 *
 * 密钥源（tavily、serper 等）此前为裸 Zotero.HTTP.request，429 直接冒泡
 * 成工具失败。本模块提供共享的解析/退避/文案原语：
 *   - Retry-After 解析：HTTP 头优先（Zotero 原始 CRLF 串或 Record 均可），
 *     body JSON 兜底（OpenAlex 形状：retryAfter | meta.headers["retry-after"]）
 *   - 退避：头值直接用（超上限=放弃等待），无头按 5s×2^(n-1) ±20% jitter；
 *     抖动数学唯一实现于 backoffDelayMs
 *   - 文案：限流退避后仍失败 ≠ 普通 HTTP 失败——工具层用专门文案披露
 *
 * 纯函数、零依赖，单测直接覆盖（tests/unit/utils/rateLimit.test.ts）。
 *
 * @module utils/rateLimit
 */

export interface RetryAfterInput {
  /** Zotero response.responseHeaders（CRLF 原始串）或 SDK 错误的 Record 形态 */
  headers?: string | Record<string, string>;
  /** 响应体（兜底解析 OpenAlex 形状的 JSON retryAfter） */
  body?: string;
}

/** HTTP 头原始串 → 小写键 Record（Zotero 的 responseHeaders 是 CRLF 串）。 */
function normalizeHeaders(raw?: string): Record<string, string> {
  if (!raw) return {};
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const k = line.slice(0, idx).trim().toLowerCase();
    const v = line.slice(idx + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

/**
 * 解析 Retry-After（秒）。头优先、body JSON 兜底；HTTP-日期形态不解析
 * （各网关均回秒数；日期形态返回 null 走指数退避兜底，不猜时区算术）。
 */
export function parseRetryAfterSec(input: RetryAfterInput): number | null {
  let headerVal: string | undefined;
  if (typeof input.headers === "string") {
    headerVal = normalizeHeaders(input.headers)["retry-after"];
  } else if (input.headers && typeof input.headers === "object") {
    const rec = Object.fromEntries(
      Object.entries(input.headers).map(([k, v]) => [k.toLowerCase(), v]),
    );
    headerVal = rec["retry-after"];
  }
  if (headerVal != null) {
    const sec = parseInt(String(headerVal).trim(), 10);
    if (Number.isFinite(sec) && sec > 0) return sec;
  }
  if (input.body) {
    try {
      const parsed = JSON.parse(input.body);
      const ra = Number(
        parsed?.retryAfter ?? parsed?.meta?.headers?.["retry-after"],
      );
      if (Number.isFinite(ra) && ra > 0) return ra;
    } catch {
      /* 非 JSON body —— 无兜底值 */
    }
  }
  return null;
}

export interface RateLimitDelayOpts {
  /** Retry-After 超过此值视为「对方要求等太久」，放弃等待直接失败（默认 300s，OpenAlex 既有口径） */
  maxRetryAfterSec?: number;
  /** 指数退避基准（默认 5000ms；第 n 次重试 = base×2^(n-1)） */
  baseMs?: number;
  /** 指数退避上限（默认 60000ms） */
  maxBackoffMs?: number;
}

/**
 * 纯指数退避原语（不含 Retry-After 语义）：
 * min(maxBackoffMs, baseMs×2^max(0, n-1)) 再乘 ±20% jitter（防齐射）。
 */
export function backoffDelayMs(
  attempt: number,
  opts: Pick<RateLimitDelayOpts, "baseMs" | "maxBackoffMs"> = {},
): number {
  const baseMs = opts.baseMs ?? 5000;
  const maxBackoffMs = opts.maxBackoffMs ?? 60000;
  const raw = Math.min(
    maxBackoffMs,
    baseMs * Math.pow(2, Math.max(0, attempt - 1)),
  );
  return raw * (0.8 + Math.random() * 0.4);
}

/**
 * 计算退避延迟。返回 null = 不该等（Retry-After 超上限）——调用方应
 * 直接把 429 作为终态返回，别把长等待塞进工具调用
 * （调用链上游的总闸会先杀掉它）。
 */
export function rateLimitDelayMs(
  retryAfterSec: number | null,
  attempt: number,
  opts: RateLimitDelayOpts = {},
): number | null {
  const maxRetryAfterSec = opts.maxRetryAfterSec ?? 300;
  if (retryAfterSec != null) {
    if (retryAfterSec > maxRetryAfterSec) return null;
    return retryAfterSec * 1000;
  }
  // 无头 → 指数退避兜底（共享原语，见 backoffDelayMs 头注）
  return backoffDelayMs(attempt, opts);
}

/**
 * 限流终态的专门文案（工具层/台账用）：与普通 HTTP 失败可分辨——
 * 「退避已做但仍限流」是可预期状态，不该长得像 bug。
 */
export function rateLimitErrorText(
  source: string,
  attempts: number,
  retryAfterSec: number | null,
): string {
  const hint =
    retryAfterSec != null
      ? `server asks retry after ${retryAfterSec}s`
      : "no Retry-After given";
  return `[rate-limited] ${source}: 429 after ${attempts} attempt(s) with backoff (${hint}); try again later`;
}
