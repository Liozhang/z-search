/**
 * Patch AbortController/AbortSignal globals.
 *
 * Why this exists: plugin code runs inside the bootstrap `loadSubScript`
 * scope (addon/bootstrap.js) — a sandbox global with JS intrinsics but no
 * Web platform APIs, so `AbortController` is not defined there (same
 * constraint documented in CopilotAuth.ts / PDFCache.ts / ToolResultCache.ts).
 * toolExecutor.ts (M-2 per-tool timeout abort), research-task.ts and
 * splitViewFactory.ts instantiate it at runtime → ReferenceError → every
 * agent tool call returns "[execution_failed] Error: AbortController is
 * not defined".
 *
 * Resolution order (first hit wins):
 *   1. Existing global (Node/tests/dev already provide a native one).
 *   2. `Components.utils.importGlobalProperties(["AbortController"])` — the
 *      canonical way to expose Web APIs in privileged Gecko scopes.
 *   3. Native class from a Zotero main window (real DOM/XUL windows have it).
 *   4. Minimal shim covering the surface leadero actually uses:
 *      `new AbortController()`, `controller.abort()`, `controller.signal`,
 *      `signal.aborted`, `signal.addEventListener/removeEventListener("abort")`.
 *
 * Like polyfills/streams.ts this is a plain side-effect module — no
 * `declare global` (avoids the DOM type pollution noted there).
 */

import { safeDebug } from "../utils/logger";

type AbortListener = (event?: unknown) => void;

class ShimAbortSignal {
  aborted = false;
  private _listeners: AbortListener[] = [];

  addEventListener(type: string, listener: AbortListener): void {
    if (type !== "abort") return;
    this._listeners.push(listener);
  }

  removeEventListener(type: string, listener: AbortListener): void {
    if (type !== "abort") return;
    const i = this._listeners.indexOf(listener);
    if (i !== -1) this._listeners.splice(i, 1);
  }

  _abort(): void {
    if (this.aborted) return;
    this.aborted = true;
    const listeners = this._listeners;
    this._listeners = [];
    for (const listener of listeners) {
      try {
        listener({ type: "abort", target: this });
      } catch (e) {
        safeDebug("[z-search] abortController: " + e);
        // Listener errors must not break the abort chain
      }
    }
  }
}

class ShimAbortController {
  signal = new ShimAbortSignal();
  abort(): void {
    this.signal._abort();
  }
}

function installAbortController(): void {
  const g = globalThis as any;
  if (typeof g.AbortController !== "undefined") return;

  // 2. Canonical privileged-Gecko exposure
  try {
    g.Components?.utils?.importGlobalProperties?.(["AbortController"]);
  } catch (e) {
    safeDebug("[z-search] abortController: " + e);
    /* not available in this scope — try next source */
  }
  if (typeof g.AbortController !== "undefined") return;

  // 3. Native class from a Zotero main window (real DOM windows have it).
  // Cross-compartment constructor calls on native classes are safe.
  try {
    const win = g.Zotero?.getMainWindows?.()?.[0];
    if (typeof win?.AbortController === "function") {
      g.AbortController = win.AbortController;
      return;
    }
  } catch (e) {
    safeDebug("[z-search] abortController: " + e);
    /* fall through to shim */
  }

  // 4. Deterministic shim
  g.AbortController = ShimAbortController;
}

installAbortController();
