/**
 * NCBI E-utilities 全局节流（单一模块级时钟）。
 *
 * NCBI 无 API key 硬限 3 req/s；本守卫保守取 334 ms/req，确保
 * 所有 NCBI 调用方共享同一速率预算，不论并发来源。
 *
 * 用法：在每次 Zotero.HTTP.request / httpJsonGet 之前 await ncbiThrottle()。
 */

let _lastRequestAt = 0;
/** 间隔 ≥ 334 ms（3 req/s 上限的保守折半 + 少量余量）。 */
const THROTTLE_MS = 334;

/**
 * 必要时挂起，保证距上次 NCBI 请求 ≥ THROTTLE_MS。
 * 首次调用不等待（_lastRequestAt === 0 时 wait 恒为负）。
 */
export async function ncbiThrottle(): Promise<void> {
  const wait = THROTTLE_MS - (Date.now() - _lastRequestAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  _lastRequestAt = Date.now();
}
