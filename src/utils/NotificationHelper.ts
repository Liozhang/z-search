/**
 * NotificationHelper — thin wrappers around Zotero's desktop + in-app
 * notification surfaces.
 *
 * @module utils/NotificationHelper
 */

import progressWindowManager from "../core/progress/ProgressWindowManager";
import { toErrorMessage } from "./error";
import { safeDebug } from "./logger";

/**
 * Show a native desktop notification via nsIAlertsService.
 * No-ops if the service is unavailable (e.g. headless Linux without a
 * notification daemon) — callers must not rely on the toast appearing.
 */
export function showDesktopNotification(title: string, body: string): void {
  try {
    const alertsService = Components.classes[
      "@mozilla.org/alerts-service;1"
    ].getService(Components.interfaces.nsIAlertsService);
    alertsService.showAlertNotification(
      "chrome://zsearch/content/icons/icon.svg", // 品牌图标（补 T）
      title,
      body,
      false, // alert clickable
      "", // cookie
      null, // alert listener
    );
  } catch (e) {
    safeDebug("[z-search] NotificationHelper: " + e);
    // Notification daemon unavailable — silently degrade.
  }
}

/**
 * Show an in-app progress-window notification with one or more line items.
 * Auto-closes after a short delay; does not block the caller.
 */
export function showProgressNotification(
  title: string,
  items: string | string[],
): void {
  try {
    const windowID = progressWindowManager.create({
      title,
      canClose: true,
    });
    if (!windowID) return;

    progressWindowManager.addLines(
      windowID,
      Array.isArray(items) ? items.map((text) => ({ text, icon: "·" })) : items,
    );

    (globalThis as any).setTimeout(() => {
      progressWindowManager.close(windowID);
    }, 5000);
  } catch (e) {
    // Progress window unavailable — fall back to debug log.
    try {
      safeDebug(
        "[z-search] showProgressNotification failed: " + toErrorMessage(e),
      );
    } catch (_) {
      // Zotero.debug itself unavailable — nothing more we can do.
    }
  }
}
