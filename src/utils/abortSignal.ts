/**
 * abortSignal — Zotero 10 沙箱可用的超时/合并信号垫片。
 *
 * 背景（2026-09-30 实机验证）：Zotero 10 引导沙箱不暴露 `AbortSignal` 全局，
 * 裸调 `AbortSignal.timeout` 会毫秒级抛 ReferenceError——翻译引擎全链路因此
 * 双双失败过一次。MinerU 本地解析路径当时残留了同款裸调（2026-10-11 审计
 * 清出）。本模块统一三层回退：宿主 AbortSignal.timeout → AbortController +
 * setTimeout → 放弃超时（返回 undefined）。宁可没有超时，也不能让请求直接炸。
 *
 * @module utils/abortSignal
 */

/** 超时信号：宿主 AbortSignal.timeout → AbortController 回退 → undefined。 */
export function timeoutSignal(ms: number): AbortSignal | undefined {
  const G = globalThis as any;
  try {
    if (typeof G.AbortSignal?.timeout === "function") {
      return G.AbortSignal.timeout(ms);
    }
    if (typeof G.AbortController === "function") {
      const ctl = new G.AbortController();
      setTimeout(() => ctl.abort(), ms);
      return ctl.signal;
    }
  } catch {
    /* fall through */
  }
  return undefined;
}

/**
 * 合并「调用方取消信号」与「超时信号」：任一触发即中止。
 *
 * 三层回退：宿主 AbortSignal.any → 手工桥接（监听双方 abort，转发到外层
 * AbortController）→ 两信号都拿不到超时侧时退回调用方信号。返回值永不为
 * null——最坏情况只丢超时语义，不丢调用方的取消能力。
 */
export function withTimeout(
  signal: AbortSignal | undefined,
  ms: number,
): AbortSignal | undefined {
  const G = globalThis as any;
  const timeout = timeoutSignal(ms);
  if (!signal) return timeout;
  if (!timeout) return signal;
  if (typeof G.AbortSignal?.any === "function") {
    try {
      return G.AbortSignal.any([signal, timeout]);
    } catch {
      /* fall through */
    }
  }
  if (typeof G.AbortController === "function") {
    try {
      const ctl = new G.AbortController();
      const forward = (src: AbortSignal) => {
        if (ctl.signal.aborted) return;
        try {
          ctl.abort((src as any).reason);
        } catch {
          ctl.abort();
        }
      };
      // abort 事件只在状态跃迁时触发：传入信号在进入本函数前已经中止，
      // 监听器永远不会回调，调用方的取消会被静默丢弃、请求跑满超时——
      // 挂监听前先判即时状态。
      if (signal.aborted) {
        forward(signal);
        return ctl.signal;
      }
      signal.addEventListener("abort", () => forward(signal), { once: true });
      timeout.addEventListener("abort", () => forward(timeout), {
        once: true,
      });
      return ctl.signal;
    } catch {
      /* fall through */
    }
  }
  return signal;
}
