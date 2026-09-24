/**
 * PostMessageBridge — Communication layer between iframe (React) and parent (XUL) via postMessage.
 *
 * API mirrors BridgeTransport for drop-in replacement:
 * - `request<T>(type, payload)` → Promise<T>
 * - `notify(type, payload)` → void
 * - `on(type, handler)` → unsubscribe function
 *
 * Protocol:
 *   iframe → parent:  { type: 'zsearch-req', id, method, payload }
 *   parent → iframe:  { type: 'zsearch-res', id, payload }
 *   parent → iframe:  { type: 'zsearch-notify', event, payload }
 */

import { z } from "zod";
import { checkInbound, replyOrigin } from "./originGate";
import { safeDebug } from "../utils/logger";

let _idCounter = 0;
function nextId(): string {
  return `pm-${++_idCounter}-${Date.now()}`;
}

/** Sentinel to preserve undefined across structured clone (undefined → null) */
const UNDEFINED_SENTINEL = { __zsearch_undefined__: true };

const RequestEnvelopeSchema = z.object({
  type: z.literal("zsearch-req"),
  id: z.string(),
  method: z.string(),
  payload: z.any(),
});

const ResponseEnvelopeSchema = z.object({
  type: z.literal("zsearch-res"),
  id: z.string(),
  payload: z.any(),
});

const NotifyEnvelopeSchema = z.object({
  type: z.literal("zsearch-notify"),
  event: z.string(),
  payload: z.any(),
});

export function replaceUndefined(obj: any): any {
  if (obj === undefined) return UNDEFINED_SENTINEL;
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(replaceUndefined);
  const out: any = {};
  for (const k of Object.keys(obj)) {
    out[k] = replaceUndefined(obj[k]);
  }
  return out;
}

export function restoreUndefined(obj: any): any {
  if (
    obj &&
    typeof obj === "object" &&
    obj.__zsearch_undefined__ === true &&
    Object.keys(obj).length === 1
  )
    return undefined;
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(restoreUndefined);
  const out: any = {};
  for (const k of Object.keys(obj)) {
    out[k] = restoreUndefined(obj[k]);
  }
  return out;
}

const _LEADERO_ENVELOPE_SCHEMAS = [
  RequestEnvelopeSchema,
  ResponseEnvelopeSchema,
  NotifyEnvelopeSchema,
] as const;

export class PostMessageBridge {
  private parent: Window;
  private origin: string;
  private pending = new Map<
    string,
    { resolve: (v: any) => void; reject: (r: any) => void; timer: number }
  >();
  private handlers = new Map<string, Set<(payload: any) => void>>();
  private boundListener: ((e: MessageEvent) => void) | null = null;
  private destroyed = false;

  constructor(parentWindow?: Window) {
    this.parent = parentWindow ?? window.parent;
    // 2026-09-10 安全批：回包 targetOrigin 由固定 '*' 改为**精确 origin**。
    // 从 parent 自身 location 推导，故不可能失配；推导不出（跨源/opaque）时
    // replyOrigin 降级返回 '*'，保持既有行为。旧注释「Use '*' for chrome://
    // same-origin」不再需要——精确 origin 同样满足同源通信，且不再广播。
    this.origin = replyOrigin(this.parent);
    this.boundListener = (e: MessageEvent) => this.handleMessage(e);
    window.addEventListener("message", this.boundListener);
  }

  /**
   * Send a request to parent and wait for response.
   */
  request<T = any>(
    method: string,
    payload?: any,
    timeoutMs = 30000,
  ): Promise<T> {
    if (this.destroyed)
      return Promise.reject(new Error("PostMessageBridge destroyed"));
    this.ensureListener();
    return new Promise((resolve, reject) => {
      const id = nextId();
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`PostMessageBridge request timeout: ${method}`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      this.parent.postMessage(
        { type: "zsearch-req", id, method, payload: replaceUndefined(payload) },
        this.origin,
      );
    });
  }

  /**
   * Send a one-way notification to parent.
   */
  notify(event: string, payload?: any): void {
    if (this.destroyed) return;
    this.parent.postMessage(
      { type: "zsearch-notify", event, payload: replaceUndefined(payload) },
      this.origin,
    );
  }

  /**
   * Register a handler for notifications from parent.
   * Returns an unsubscribe function.
   */
  on(event: string, handler: (payload: any) => void): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
    this.ensureListener();
    return () => {
      const set = this.handlers.get(event);
      if (set) {
        set.delete(handler);
        if (set.size === 0) {
          this.handlers.delete(event);
          // Remove window listener when no handlers and no pending requests remain
          if (
            this.handlers.size === 0 &&
            this.pending.size === 0 &&
            this.boundListener
          ) {
            window.removeEventListener("message", this.boundListener);
            this.boundListener = null;
          }
        }
      }
    };
  }

  /** Re-attach window message listener if it was removed (e.g. all handlers unsubscribed). */
  private ensureListener(): void {
    if (!this.boundListener) {
      this.boundListener = (e: MessageEvent) => this.handleMessage(e);
      window.addEventListener("message", this.boundListener);
    }
  }

  /** Destroy all listeners and pending requests. */
  destroy(): void {
    this.destroyed = true;
    if (this.boundListener) {
      window.removeEventListener("message", this.boundListener);
      this.boundListener = null;
    }
    for (const [, { timer }] of this.pending) {
      clearTimeout(timer);
    }
    this.pending.clear();
    this.handlers.clear();
  }

  private handleMessage(e: MessageEvent): void {
    const data = e.data;
    if (!data || typeof data !== "object") return;

    // 2026-09-10 安全批：入站来源闸门。此前子侧不校验来源——任何拿到本 iframe
    // 窗口句柄的窗口都能伪造 leadero-res（伪造工具结果/通知进 UI）或
    // leadero-req。判据用 origin 字符串（XPCNativeWrapper 陷阱见 originGate.ts
    // 头注）；origin 不可判定时按降级契约放行。
    const verdict = checkInbound(e.origin, this.parent);
    if (!verdict.accept) {
      safeDebug(
        `[PostMessageBridge] dropped message from unexpected origin: ${verdict.reason}`,
      );
      return;
    }
    // Validate by message type prefix instead of e.source reference comparison.
    // In Firefox chrome:// privileged context, e.source returns XPCNativeWrapper
    // objects that never === window.parent, silently dropping all messages.
    const t = (data.type as string) || "";
    if (!t.startsWith("zsearch-")) return;

    // Runtime schema validation: reject malformed envelopes before dispatch.
    // Uses Zod so violations are caught early in debug output instead of
    // surfacing as cryptic undefined errors downstream.
    const schema =
      t === "zsearch-req"
        ? RequestEnvelopeSchema
        : t === "zsearch-res"
          ? ResponseEnvelopeSchema
          : t === "zsearch-notify"
            ? NotifyEnvelopeSchema
            : null;
    if (schema) {
      const parsed = schema.safeParse(data);
      if (!parsed.success) {
        console.warn(
          "[PostMessageBridge] Invalid envelope:",
          parsed.error.issues,
          data,
        );
        return;
      }
    }

    // Response to a pending request
    if (data.type === "zsearch-res" && data.id) {
      const pending = this.pending.get(data.id);
      if (pending) {
        this.pending.delete(data.id);
        window.clearTimeout(pending.timer);
        pending.resolve(restoreUndefined(data.payload));
      }
      return;
    }

    // Notification from parent
    if (data.type === "zsearch-notify" && data.event) {
      const handlers = this.handlers.get(data.event);
      if (handlers) {
        const payload = restoreUndefined(data.payload);
        for (const handler of handlers) {
          try {
            handler(payload);
          } catch (_e) {
            safeDebug(
              "[z-search] PostMessageBridge: handler error for " +
                data.event +
                ": " +
                _e,
            );
          }
        }
      }
      // Wildcard — intentionally dispatched AFTER specific handlers.
      // Callers registering both a specific event and '*' will receive two
      // notifications. This matches BridgeTransport.ts:112-118 wildcard-dispatch behavior.
      const wildcard = this.handlers.get("*");
      if (wildcard) {
        for (const handler of wildcard) {
          try {
            handler(data);
          } catch (_e) {
            safeDebug(
              "[z-search] PostMessageBridge: wildcard handler error: " + _e,
            );
          }
        }
      }
    }
  }
}
