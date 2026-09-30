/**
 * rateLimit 统一原语单测（2026-09-28 审计批）——解析三形态/上限语义/
 * 退避档位/专门文案。
 */

import { describe, expect, it } from "vitest";
import {
  parseRetryAfterSec,
  rateLimitDelayMs,
  rateLimitErrorText,
} from "../../../src/utils/rateLimit";

describe("parseRetryAfterSec", () => {
  it("Zotero 原始 CRLF 头串（大小写不敏感）", () => {
    expect(
      parseRetryAfterSec({
        headers: "Content-Type: application/json\r\nRetry-After: 30\r\nX-B: 1",
      }),
    ).toBe(30);
    expect(parseRetryAfterSec({ headers: "retry-after: 7" })).toBe(7);
  });

  it("Record 形态（SDK 错误 responseHeaders）键归一小写", () => {
    expect(parseRetryAfterSec({ headers: { "Retry-After": "12" } })).toBe(12);
    expect(parseRetryAfterSec({ headers: { "RETRY-AFTER": "12" } })).toBe(12);
  });

  it("body JSON 兜底（OpenAlex 形状：retryAfter | meta.headers）", () => {
    expect(parseRetryAfterSec({ body: '{"retryAfter": 42}' })).toBe(42);
    expect(
      parseRetryAfterSec({ body: '{"meta":{"headers":{"retry-after": 9}}}' }),
    ).toBe(9);
  });

  it("头优先于 body", () => {
    expect(
      parseRetryAfterSec({
        headers: "Retry-After: 5",
        body: '{"retryAfter": 99}',
      }),
    ).toBe(5);
  });

  it("无值/坏值/HTTP 日期形态 → null（走指数退避兜底）", () => {
    expect(parseRetryAfterSec({})).toBeNull();
    expect(parseRetryAfterSec({ headers: "Retry-After: 0" })).toBeNull();
    expect(parseRetryAfterSec({ headers: "Retry-After: abc" })).toBeNull();
    expect(
      parseRetryAfterSec({
        headers: "Retry-After: Wed, 21 Oct 2026 07:28:00 GMT",
      }),
    ).toBeNull();
    expect(parseRetryAfterSec({ body: "not json" })).toBeNull();
    expect(parseRetryAfterSec({ body: '{"retryAfter": -3}' })).toBeNull();
  });
});

describe("rateLimitDelayMs", () => {
  it("Retry-After 直接用（秒→毫秒）", () => {
    expect(rateLimitDelayMs(30, 1)).toBe(30000);
  });

  it("超上限 → null（放弃等待的终态信号）", () => {
    expect(rateLimitDelayMs(301, 1)).toBeNull();
    expect(rateLimitDelayMs(121, 1, { maxRetryAfterSec: 120 })).toBeNull();
    expect(rateLimitDelayMs(300, 1)).toBe(300000); // 等于上限=仍等（OpenAlex 口径）
  });

  it("无头指数退避 ±20% jitter，第 n 次 = base×2^(n-1)", () => {
    const d1 = rateLimitDelayMs(null, 1)!;
    expect(d1).toBeGreaterThanOrEqual(4000); // 5000×0.8
    expect(d1).toBeLessThanOrEqual(6000); // 5000×1.2
    const d2 = rateLimitDelayMs(null, 2)!;
    expect(d2).toBeGreaterThanOrEqual(8000);
    expect(d2).toBeLessThanOrEqual(12000);
  });

  it("退避上限 60s（大 attempt 不无限涨）", () => {
    const d5 = rateLimitDelayMs(null, 5)!;
    expect(d5).toBeLessThanOrEqual(72000); // 60000×1.2
  });
});

describe("rateLimitErrorText", () => {
  it("限流终态文案与普通失败可分辨", () => {
    const t = rateLimitErrorText("arXiv", 2, 30);
    expect(t).toContain("[rate-limited]");
    expect(t).toContain("arXiv");
    expect(t).toContain("2 attempt");
    expect(t).toContain("30s");
    expect(rateLimitErrorText("serper", 2, null)).toContain("no Retry-After");
  });
});
