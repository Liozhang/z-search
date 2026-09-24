/**
 * Bridge helper — provides typed send/receive utilities.
 *
 * In iframe mode: uses PostMessageBridge (postMessage to parent).
 * In legacy mode: uses BridgeTransport (CustomEvent on window).
 * Auto-detects mode based on available globals.
 *
 * 术语表（D5，2026-08-26 补）——两条通道语义不同，勿混用：
 * - transport（RPC 请求/响应）：`bridgeRequest(method, payload)` 一次性调用，
 *   有超时、有返回值；前端→后端的命令式动作（读配置、执行操作）走这里。
 * - event bus（事件订阅）：`onBackendEvent(type, handler)` 长驻监听，无返回值；
 *   后端→前端的推送（消息落库、状态变化、进度更新）走这里。
 * 简记：要答案用 transport，等通知用 event bus。
 */

import type { PostMessageBridge } from "../../bridge/PostMessageBridge";
import { safeDebug } from "../../utils/logger";

interface BridgeLike {
  request<T = any>(
    method: string,
    payload?: any,
    timeoutMs?: number,
  ): Promise<T>;
  notify(type: string, payload?: any): void;
  on(type: string, handler: (payload: any) => void): () => void;
}

/** Detect and return the active bridge (PostMessageBridge or BridgeTransport) */
export function getBridge(): BridgeLike | null {
  // Hub iframe mode: HubWindowBridge sets window.__hubBridge
  const hubBridge = (window as any).__hubBridge;
  if (hubBridge && typeof hubBridge.request === "function") {
    return hubBridge;
  }

  // Standalone iframe mode: PostMessageBridge set by index.tsx
  const pmBridge = (window as any).__bridge as PostMessageBridge | undefined;
  if (pmBridge && typeof pmBridge.request === "function") {
    return pmBridge;
  }

  // Legacy mode: BridgeTransport set by ChatWindowBridge on window
  const transport = (window as any).__bridgeTransport;
  if (transport && typeof transport.on === "function") {
    return transport;
  }

  return null;
}

/**
 * Send a notification to the backend.
 */
export function sendToBackend(type: string, payload?: any): void {
  const bridge = getBridge();
  if (bridge) {
    bridge.notify(type, payload);
  } else {
    // Fallback: direct CustomEvent
    window.dispatchEvent(
      new CustomEvent(`leadero:${type}`, { detail: payload }),
    );
  }
}

/**
 * Subscribe to backend events.
 */
export function onBackendEvent(
  type: string,
  handler: (payload: any) => void,
): () => void {
  const bridge = getBridge();
  if (bridge) {
    return bridge.on(type, handler);
  }

  // Fallback: direct CustomEvent listener
  const eventHandler = (e: Event) => {
    handler((e as CustomEvent).detail);
  };
  window.addEventListener(`leadero:${type}`, eventHandler);
  return () => window.removeEventListener(`leadero:${type}`, eventHandler);
}

/**
 * Shared bridge request — unwraps { success, data?, error? } envelope.
 * Returns data on success, null when no bridge / no data, throws on error.
 *
 * 内层 success 校验：host 侧 hubPrefWriter 等写入函数失败时返回 {success:false,error}
 * 而非抛错，被 BaseWindowBridge 包成外层 {success:true, data:{success:false,error}}。
 * 只看外层 error 会让这类失败被静默吞掉（前端 catch 永不触发、toast 永不出现）。
 * 这里把内层 data.success===false 也识别为错误并抛出，使所有 settings 写入失败可见。
 */
export async function bridgeRequest<T = any>(
  method: string,
  payload?: any,
  timeoutMs: number = 10000,
): Promise<T | null> {
  const bridge = getBridge();
  if (!bridge) return null;
  const res = await bridge.request<{
    success?: boolean;
    data?: T;
    error?: string;
  }>(method, payload, timeoutMs);
  if (res?.error) throw new Error(res.error);
  // 内层失败校验：data 自身携带 {success:false,error} 的写入结果（见上方注释）
  const inner = res?.data as any;
  if (
    inner &&
    typeof inner === "object" &&
    inner.success === false &&
    inner.error
  ) {
    throw new Error(inner.error);
  }
  if (res?.success && res.data != null) return res.data;
  return null;
}

/**
 * Fire-and-forget bridge notification — no return value needed.
 * Does not throw on error.
 */
export async function bridgeNotify(
  method: string,
  payload?: any,
  timeoutMs?: number,
): Promise<void> {
  try {
    await bridgeRequest(method, payload, timeoutMs);
  } catch (e) {
    safeDebug("[z-search] " + e);
    /* fire-and-forget */
  }
}

/**
 * Check if running in iframe mode.
 */
export function runningInIframe(): boolean {
  return !!(window as any).__bridge || !!(window as any).__hubBridge;
}

// ── 桥 attach 通知（2026-09-14 架构批）─────────────────────────────────
// iframe 的 __bridge 由 mountDashboard 在收到 init 消息时同步挂上（先于
// render），但消费方（如 HubShell 深链订阅）仍可能在桥缺席的窗口期 mount
// （keep-alive 重挂 / init 迟到）。此前各消费方自己写 200ms×N 轮询——
// 初始化顺序债转嫁给每个消费者。现在挂载点统一广播一次，等待者事件驱动。

type BridgeReadyListener = () => void;
const bridgeReadyListeners = new Set<BridgeReadyListener>();

/**
 * Subscribe to bridge attachment. If a bridge is already present the
 * callback runs synchronously and the returned unsubscribe is a no-op.
 */
export function onBridgeReady(cb: BridgeReadyListener): () => void {
  if (getBridge()) {
    cb();
    return () => {};
  }
  bridgeReadyListeners.add(cb);
  return () => {
    bridgeReadyListeners.delete(cb);
  };
}

/** Called by the mount points that create/attach a bridge (mountDashboard).
 *  Wakes every pending subscriber exactly once. */
export function notifyBridgeAttached(): void {
  const pending = [...bridgeReadyListeners];
  bridgeReadyListeners.clear();
  for (const cb of pending) {
    try {
      cb();
    } catch (e) {
      safeDebug("[z-search] bridge-ready callback failed: " + e);
    }
  }
}
