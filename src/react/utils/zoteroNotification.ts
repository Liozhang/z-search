/**
 * zoteroNotification — Zotero-native notification helper for React.
 *
 * iframe 模式（Hub 窗 reactBundle）里 Zotero 原生面板不可达（无真 Zotero
 * 全局），改走 bridge notify（zoteroNotify 上行事件）→ 宿主
 * HubWindowBridge.handleNotify 代发原生 ProgressWindow toast。
 */

import { showProgressNotification } from "../../utils/NotificationHelper";
import { runningInIframe, sendToBackend } from "./bridge";

/**
 * Show a one-shot Zotero-native notification.
 */
export function zoteroNotify(message: string): void {
  if (runningInIframe()) {
    sendToBackend("zoteroNotify", { message });
    return;
  }
  showProgressNotification("z-search", message);
}
