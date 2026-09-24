/**
 * OpenAlex API 全局节流（单一模块级时钟）。
 *
 * OpenAlex 硬限 100 req/s，但搜索端点（/works?search=）在匿名/低额度模式下
 * 有更严格的临时限速；保守取 500 ms/req（2 req/s），确保
 * 所有 OpenAlex 调用方共享同一速率预算，不论并发来源。
 *
 * 该节流只控制"发出请求的间隔"，不处理 429 重试——429 由调用方
 * 通过 retryAfter 单独处理。
 *
 * 用法：在每次 httpJsonGet 之前 await openalexThrottle()。
 */

let _lastRequestAt = 0;
/** 间隔 ≥ 500 ms（保守取 100 req/s 的 1/200，避免触发临时限速）。 */
const THROTTLE_MS = 500;

/**
 * 必要时挂起，保证距上次 OpenAlex 请求 ≥ THROTTLE_MS。
 * 首次调用不等待（_lastRequestAt === 0 时 wait 恒为负）。
 */
export async function openalexThrottle(): Promise<void> {
  const wait = THROTTLE_MS - (Date.now() - _lastRequestAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  _lastRequestAt = Date.now();
}
