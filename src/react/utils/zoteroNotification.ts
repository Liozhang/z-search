/**
 * zoteroNotification — Zotero-native notification helpers for React.
 *
 * Wraps two native surfaces:
 *   - Zotero.ProgressWindow (iframe-safe, docked inside Zotero)
 *   - ProgressWindowManager (batch operations with per-item progress)
 *
 * Usage:
 *   import { zoteroNotify, zoteroProgressStart, zoteroProgressAdd, zoteroProgressClose } from '@/utils/zoteroNotification';
 *
 *   // One-shot:
 *   zoteroNotify(getString("save-note-success"));
 *
 *   // Batch:
 *   const winId = zoteroProgressStart(getString("batch-delete-title"));
 *   for (...) {
 *     zoteroProgressAdd(winId, `Deleted ${title}`);
 *   }
 *   zoteroProgressClose(winId);
 */

import { showProgressNotification } from "../../utils/NotificationHelper";
import progressWindowManager from "../../core/progress/ProgressWindowManager";
import { runningInIframe, sendToBackend } from "./bridge";

/**
 * Show a one-shot Zotero-native notification.
 *
 * iframe 模式（Hub 窗 / 聊天窗 reactBundle）里 Zotero 原生面板不可达
 * （无 _globalThis / 真 Zotero 全局，直接调用会静默丢通知），改走 bridge
 * notify → 主进程 handleZoteroNotify 真正弹原生 toast；主进程侧直调。
 */
export function zoteroNotify(message: string): void {
  if (runningInIframe()) {
    sendToBackend("zoteroNotify", { message });
    return;
  }
  showProgressNotification("LeadeRo", message);
}

/** Persistent progress window handle. */
export interface ZoteroProgressHandle {
  addLine(text: string): void;
  close(): void;
}

/** Create a persistent progress window for batch operations. */
export function zoteroProgressStart(title: string): ZoteroProgressHandle {
  const windowID = progressWindowManager.create({ title, canClose: true });
  return {
    addLine(text: string) {
      progressWindowManager.addLines(windowID, [{ text, icon: "·" }]);
    },
    close() {
      progressWindowManager.close(windowID);
    },
  };
}
