/**
 * BaseWindowBridge — Abstract base class for iframe WindowBridge implementations.
 *
 * Provides shared infrastructure for HubWindowBridge and potential future window bridges:
 * - iframe lifecycle (initialize, setIframeWindow, destroy)
 * - postMessage routing (handleIframeMessage, sendResponse)
 * - iframe notification (sendNotifyToIframe, dispatchNotify)
 * - Optional throttle support for high-frequency progress events
 *
 * Subclasses only need to implement handleRequest() with their business logic.
 *
 * NOT used by ChatWindowBridge (dual-mode architecture is fundamentally different).
 */

import { replaceUndefined, restoreUndefined } from "./PostMessageBridge";
import { replyOrigin } from "./originGate";
import { toErrorMessage } from "../utils/error";
import { handleLocaleRequest } from "./localeHelpers";
import { safeDebug } from "../utils/logger";

// Re-export for subclass convenience (avoids double import from PostMessageBridge)
export { restoreUndefined } from "./PostMessageBridge";

export abstract class BaseWindowBridge {
  protected iframeWindow: Window | null = null;
  protected destroyed = false;

  /** Throttle state for high-frequency progress events (optional, used by subclass).
   *  Per-event-name Map: each event gets its own timer + payload, preventing
   *  cross-event name contamination (the old single-slot bug where event B's
   *  payload was dispatched under event A's name). */
  protected progressThrottleTimer: ReturnType<typeof setTimeout> | null = null;
  protected pendingProgressEvent: any = null;
  protected throttleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  protected throttlePending = new Map<string, any>();

  /**
   * Initialize the bridge on a XUL parent window.
   * @param bridgeKey - Property name to expose on win (e.g. 'brainBridge' → win.__brainBridge)
   */
  protected initialize(win: Window, bridgeKey: string): void {
    (win as any)[`__${bridgeKey}`] = this;
  }

  setIframeWindow(iframeWindow: Window): void {
    this.iframeWindow = iframeWindow;
  }

  /**
   * Handle a postMessage from the iframe.
   * Routes 'zsearch-req' to handleRequest(), 'zsearch-notify' to handleNotify().
   * Uses setTimeout(0) to decouple Promise rejections from Gecko event handlers.
   */
  handleIframeMessage(data: any, source: Window): void {
    if (this.destroyed) return;
    if (!data || typeof data !== "object") return;

    const type = data.type || "";
    if (type === "zsearch-req" && data.id != null) {
      const payload = restoreUndefined(data.payload);
      const method = data.method as string | undefined;

      // Shared locale routing (all Bridges handle locale.* the same way)
      if (method?.startsWith("locale.")) {
        const result = handleLocaleRequest(method, payload);
        if (result !== undefined) {
          this.sendResponse(data.id, result, null, source);
          return;
        }
      }

      if (!method) {
        this.sendResponse(data.id, null, "method is required", source);
        return;
      }

      setTimeout(() => {
        this.handleRequest(method, payload, data.id, source).catch((e: any) => {
          this.sendResponse(data.id, null, toErrorMessage(e), source);
        });
      }, 0);
    } else if (type === "zsearch-notify") {
      const payload = restoreUndefined(data.payload);
      setTimeout(() => {
        try {
          this.handleNotify(data.event, payload);
        } catch (_e) {
          safeDebug(`[z-search] bridge handleNotify error: ${_e}`);
        }
      }, 0);
    }
  }

  /**
   * Handle an incoming request from the iframe.
   * Subclasses must implement their own try/catch and call sendResponse() themselves.
   * The .catch() in handleIframeMessage provides a fallback error response.
   */
  protected abstract handleRequest(
    method: string,
    payload: any,
    id: string | number,
    source: Window,
  ): Promise<void>;

  /** Send a structured response back to the iframe.
   *  2026-09-10 安全批：targetOrigin 由 `'*'` 改为**精确 origin**（从目标窗口
   *  自身 location 推导，故不可能失配；推导不出时降级回 `'*'`）。回包可能携带
   *  明文 API key（getAllProvidersFull），不允许再广播给未知窗口。 */
  protected sendResponse(
    id: string | number,
    result: any,
    error: string | null,
    source: Window,
  ): void {
    if (this.destroyed) return;
    try {
      if (source.closed) return;
      source.postMessage(
        {
          type: "zsearch-res",
          id,
          payload: replaceUndefined(
            error ? { success: false, error } : { success: true, data: result },
          ),
        },
        replyOrigin(source),
      );
    } catch {
      // Zotero integration: Window may have closed
    }
  }

  /** Handle a fire-and-forget notification from the iframe. Default: no-op. */
  protected handleNotify(_event: string, _payload: any): void {}

  /**
   * Push a notification to the iframe via postMessage.
   * Override in subclasses that need throttling.
   */
  sendNotifyToIframe(event: string, payload: any): void {
    if (this.destroyed) return;
    this.dispatchNotify(event, payload);
  }

  /** Low-level dispatch: send a leadero-notify message to the iframe. */
  protected dispatchNotify(event: string, payload: any): void {
    if (this.destroyed) return;
    try {
      const target = this.iframeWindow;
      if (!target || (target as any).closed) {
        // RM-1 可观测：null/closed 目标此前静默 return——深链/进度事件丢失
        // 无任何痕迹。debug 一行（每条丢弃事件一次，量级=丢弃量，可接受）。
        safeDebug(
          `[z-search] dispatchNotify dropped (${event}): iframe window ${
            target ? "closed" : "not attached"
          }`,
        );
        return;
      }
      target.postMessage(
        { type: "zsearch-notify", event, payload: replaceUndefined(payload) },
        replyOrigin(target),
      );
    } catch {
      // Zotero integration: Window may have closed
    }
  }

  /**
   * Throttled notification helper for high-frequency progress events.
   * Leading-edge + trailing-edge throttle: the first event dispatches
   * immediately, subsequent events within 200ms are coalesced and the last
   * one fires at the end of the window. Each event name gets its own slot
   * (per-event Map), preventing cross-event contamination.
   * @param shouldThrottle - Whether this specific event should be throttled
   */
  protected throttleNotify(
    event: string,
    payload: any,
    shouldThrottle: boolean,
  ): void {
    if (this.destroyed) return;

    if (shouldThrottle) {
      // If no timer for this event, dispatch immediately (leading edge) then
      // start the coalescing window.
      if (!this.throttleTimers.has(event)) {
        this.dispatchNotify(event, payload);
        this.throttleTimers.set(
          event,
          setTimeout(() => {
            // Trailing edge: dispatch the last payload received during the window.
            const pending = this.throttlePending.get(event);
            this.throttlePending.delete(event);
            this.throttleTimers.delete(event);
            if (pending && !this.destroyed) {
              this.dispatchNotify(event, pending);
            }
          }, 200),
        );
      } else {
        // Within the window: update pending payload (trailing edge will fire it).
        this.throttlePending.set(event, payload);
      }
      return;
    }

    this.dispatchNotify(event, payload);
  }

  /** Clear all throttle timers and pending events. Call in destroy() before super.destroy(). */
  protected destroyThrottle(): void {
    if (this.progressThrottleTimer) {
      clearTimeout(this.progressThrottleTimer);
      this.progressThrottleTimer = null;
    }
    this.pendingProgressEvent = null;
    for (const timer of this.throttleTimers.values()) {
      clearTimeout(timer);
    }
    this.throttleTimers.clear();
    this.throttlePending.clear();
  }

  /** Destroy the bridge. Subclasses may override; BaseWindowBridge handles
   *  throttle cleanup automatically — subclasses only need to add their own
   *  cleanup (abort controllers, pending operations, etc.). */
  destroy(): void {
    this.destroyThrottle();
    this.destroyed = true;
    this.iframeWindow = null;
  }
}
