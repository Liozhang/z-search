/**
 * Zotero Progress API Integration
 *
 * Independent progress window for long-running operations
 */

import { getString } from "../../utils/locale";
import { safeDebug } from "../../utils/logger";

/**
 * 进度窗来源小字（品牌标识）。Zotero 的 changeHeadline 只接受 CSS 图标键，
 * 不接受图片 URI，所以标题行没有品牌图标——只有这个小字（2026-09-23）。
 */
const BRAND_SOURCE = "z-search";

export interface ProgressLine {
  text: string;
  icon?: string;
  type?: "default" | "success" | "error" | "warning";
}

export interface ProgressWindowOptions {
  title?: string;
  headless?: boolean;
  canClose?: boolean;
  onClosed?: () => void;
}

export type EmbeddingProgressPhase = "init" | "embedding" | "done" | "error";

export interface EmbeddingProgressHandle {
  /** Update progress and refresh rate/ETA display. Returns false if cancelled. */
  updateProgress(current: number, total: number, fileName?: string): boolean;
  /** Mark the operation as completed. */
  done(): void;
  /** Mark the operation as failed. */
  error(message?: string): void;
  /** Check if the user closed the ProgressWindow via X button. */
  isCancelled(): boolean;
  /** Close the window (no status change). */
  close(): void;
}

class ProgressWindowManager {
  private activeWindows: Map<number, Zotero.ProgressWindow> = new Map();
  private itemProgress: Map<number, any> = new Map();
  private nextID = 1;

  create(options: ProgressWindowOptions = {}): number {
    // iframe bundle（Hub/聊天窗 reactBundle）无 Zotero 主进程全局：原生进度窗属主进程，
    // iframe 侧经 bridge action（zoteroNotify）路由，这里显式降级不靠 shim 形状。
    if (
      typeof Zotero === "undefined" ||
      typeof Zotero.getMainWindow !== "function"
    ) {
      return 0;
    }
    try {
      const win = Zotero.getMainWindow();
      if (!win) {
        throw new Error("No active window");
      }

      const progressWindow = new win.Zotero.ProgressWindow();
      const windowID = this.nextID++;

      if (options.title) {
        // changeHeadline(text, cssIconKey, postText)：注意第二个参数是
        // Zotero 的 CSS 图标键（'collection'/'library' 这类），不是图片
        // URI——传 chrome://...svg 会被拼成 icon-chrome://... 这个不存在的
        // 类，静默不画（2026-09-23 实机核实）。故这里只传标题 + 来源小字，
        // 图标不传。
        progressWindow.changeHeadline(options.title, "", BRAND_SOURCE);
      }
      if (options.canClose !== undefined) {
        (progressWindow as any).canClose = options.canClose;
      }

      progressWindow.show();
      this.activeWindows.set(windowID, progressWindow);

      return windowID;
    } catch (_e) {
      // 吞错修复（清理审计 2026-09-17）：iframe 降级已在上方提前 return 0，
      // 走到这里即真实异常，此前静默返回 0 无法排查。至少留一行日志。
      safeDebug("[z-search] ProgressWindowManager.create failed: " + _e);
      return 0;
    }
  }

  addLines(windowID: number, lines: string | ProgressLine[]): void {
    const win = this.activeWindows.get(windowID);
    if (!win) return;

    let linesArray: string[];
    if (typeof lines === "string") {
      linesArray = [lines];
    } else {
      // Convert ProgressLine[] to string[]
      linesArray = lines.map((l) => {
        if (typeof l === "string") return l;
        const progressLine = l as ProgressLine;
        if (progressLine.icon) {
          return `${progressLine.icon} ${progressLine.text}`;
        }
        return progressLine.text;
      });
    }

    // Zotero 9 ProgressWindow.addLines(labels, icons) expects two array arguments
    (win as any).addLines(
      linesArray,
      linesArray.map((): undefined => undefined),
    );
  }

  setProgress(windowID: number, percent: number): void {
    const win = this.activeWindows.get(windowID);
    if (!win) return;

    const pct = Math.max(0, Math.min(100, Math.round(percent)));
    try {
      let ip = this.itemProgress.get(windowID);
      if (!ip) {
        ip = new (win as any).ItemProgress(undefined, "Progress");
        this.itemProgress.set(windowID, ip);
      }
      ip.setProgress(pct);
    } catch (e) {
      safeDebug("[z-search] ProgressWindowManager.setProgress failed: " + e);
    }
  }

  /**
   * Create a single ItemProgress row (Zotero's "update-in-place" model).
   * Use {@link setItemProgressText} to update its label without accumulating rows.
   * Returns false if the window or ItemProgress could not be created.
   */
  createItemProgress(
    windowID: number,
    text: string,
    itemType?: string,
  ): boolean {
    const win = this.activeWindows.get(windowID);
    if (!win) return false;
    try {
      const ip = new (win as any).ItemProgress(itemType, text);
      this.itemProgress.set(windowID, ip);
      return true;
    } catch (e) {
      safeDebug("[z-search] createItemProgress failed: " + e);
      return false;
    }
  }

  /**
   * Update the text of the window's ItemProgress row (created via
   * {@link createItemProgress}). No-op if the row doesn't exist.
   */
  setItemProgressText(windowID: number, text: string): void {
    const ip = this.itemProgress.get(windowID);
    if (!ip) return;
    try {
      ip.setText(text);
    } catch (e) {
      safeDebug("[z-search] setItemProgressText failed: " + e);
    }
  }

  startLoading(windowID: number): void {
    this.addLines(windowID, [
      {
        type: "default",
        text: getString("progress-status-processing"),
        icon: "⏳",
      },
    ]);
  }

  showSuccess(windowID: number, message: string): void {
    this.addLines(windowID, [{ type: "success", text: message, icon: "✓" }]);
  }

  showError(windowID: number, message: string): void {
    this.addLines(windowID, [{ type: "error", text: message, icon: "✗" }]);
  }

  showWarning(windowID: number, message: string): void {
    this.addLines(windowID, [{ type: "warning", text: message, icon: "⚠" }]);
  }

  close(windowID: number): void {
    const win = this.activeWindows.get(windowID);
    if (win) {
      win.close();
      this.activeWindows.delete(windowID);
      this.itemProgress.delete(windowID);
    }
  }

  closeAll(): void {
    for (const [, win] of this.activeWindows) {
      win.close();
    }
    this.activeWindows.clear();
    this.itemProgress.clear();
  }

  /**
   * Check if a windowID still refers to an active ProgressWindow.
   */
  isActive(windowID: number): boolean {
    return this.activeWindows.has(windowID);
  }

  /**
   * Poll every 500ms; invoke callback when windowID is no longer active.
   * Used to detect user-initiated close (X button).
   *
   * Returns a handle with a `cancel()` method so callers can stop the
   * polling timer when the operation completes normally — otherwise the
   * timer keeps running until the window is closed, which never happens
   * for long operations whose window is auto-closed via `close()`.
   */
  onWindowClose(
    windowID: number,
    callback: () => void,
  ): { cancel: () => void } {
    let cancelled = false;
    let callbackFired = false;
    const timer = (globalThis as any).setInterval(() => {
      if (cancelled) return;
      if (!this.isActive(windowID)) {
        (globalThis as any).clearInterval(timer);
        if (!callbackFired) {
          callbackFired = true;
          try {
            callback();
          } catch (e) {
            safeDebug("[z-search] onWindowClose callback failed: " + e);
          }
        }
      }
    }, 500);
    return {
      cancel: () => {
        if (cancelled) return;
        cancelled = true;
        (globalThis as any).clearInterval(timer);
      },
    };
  }

  /**
   * Show an embedding-specific progress window.
   *
   * Returns a handle whose methods track phase, rate (items/s) and ETA.
   * The handle uses `progressWindowManager` (singleton) instead of `this`
   * because inside the returned object, `this` refers to the handle.
   *
   * Returns null if the window could not be created.
   */
  showEmbeddingProgress(
    options: { title?: string } = {},
  ): EmbeddingProgressHandle | null {
    const windowID = progressWindowManager.create({
      title: options.title,
      canClose: true,
    });
    if (!windowID) return null;

    let phase: EmbeddingProgressPhase = "init";
    let startTime = 0;
    let lastCurrent = 0;
    let lastTotal = 0;
    let cancelled = false;

    // Single ItemProgress row that gets updated in place (Zotero's
    // ItemProgress model) — avoids the previous bug where every updateProgress
    // call addLines'd a new row, producing N stacked rows for N items.
    progressWindowManager.createItemProgress(
      windowID,
      getString("embedding-progress-init"),
    );
    progressWindowManager.setProgress(windowID, 0);

    // Detect user-initiated close (X button). Hold the cancel handle so
    // done/error/close can stop the polling timer once the operation ends.
    const closePollCancel = progressWindowManager.onWindowClose(
      windowID,
      () => {
        cancelled = true;
      },
    );

    const handle: EmbeddingProgressHandle = {
      updateProgress(
        current: number,
        total: number,
        fileName?: string,
      ): boolean {
        if (cancelled) return false;
        if (!progressWindowManager.isActive(windowID)) {
          cancelled = true;
          return false;
        }

        if (phase === "init") {
          phase = "embedding";
          startTime = Date.now();
        }
        if (phase !== "embedding") return true;

        lastCurrent = current;
        lastTotal = total;

        const pct =
          total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
        progressWindowManager.setProgress(windowID, pct);

        // Calculate rate and ETA.
        const now = Date.now();
        const elapsedSec = startTime > 0 ? (now - startTime) / 1000 : 0;
        const rate = elapsedSec > 0 ? current / elapsedSec : 0;
        const remaining = total > current ? total - current : 0;
        const etaSec = rate > 0 ? Math.round(remaining / rate) : 0;

        const parts: string[] = [`[${current}/${total}]`];
        if (fileName) {
          parts.push(fileName);
        }
        if (rate > 0) {
          parts.push(`${rate.toFixed(1)} items/s`);
        }
        if (remaining > 0 && etaSec > 0) {
          parts.push(
            getString("embedding-progress-eta", {
              args: { eta: String(etaSec) },
            }),
          );
        }
        // Update the single ItemProgress row in place — no row accumulation.
        progressWindowManager.setItemProgressText(windowID, parts.join(" "));

        return true;
      },

      done(): void {
        if (cancelled || !progressWindowManager.isActive(windowID)) return;
        phase = "done";
        closePollCancel.cancel();
        const elapsed =
          startTime > 0 ? ((Date.now() - startTime) / 1000).toFixed(1) : "0";
        const countForMsg = lastCurrent > 0 ? lastCurrent : lastTotal;
        const msg = getString("embedding-progress-done", {
          args: { count: String(countForMsg), elapsed },
        });
        progressWindowManager.setProgress(windowID, 100);
        progressWindowManager.showSuccess(windowID, msg);
        (globalThis as any).setTimeout(() => {
          progressWindowManager.close(windowID);
        }, 3000);
      },

      error(message?: string): void {
        if (cancelled || !progressWindowManager.isActive(windowID)) return;
        phase = "error";
        closePollCancel.cancel();
        progressWindowManager.showError(
          windowID,
          message ?? getString("embedding-failed-fallback"),
        );
        (globalThis as any).setTimeout(() => {
          progressWindowManager.close(windowID);
        }, 5000);
      },

      isCancelled(): boolean {
        if (cancelled) return true;
        if (!progressWindowManager.isActive(windowID)) {
          cancelled = true;
        }
        return cancelled;
      },

      close(): void {
        closePollCancel.cancel();
        progressWindowManager.close(windowID);
      },
    };

    return handle;
  }
}

const progressWindowManager = new ProgressWindowManager();

export default progressWindowManager;
