/**
 * NotificationHelper — thin wrapper around Zotero's in-app notification surface.
 *
 * @module utils/NotificationHelper
 */

import progressWindowManager from "../core/progress/ProgressWindowManager";
import { toErrorMessage } from "./error";
import { safeDebug } from "./logger";

/**
 * Show an in-app progress-window notification with one or more line items.
 * Auto-closes after a short delay; does not block the caller.
 */
export function showProgressNotification(
  title: string,
  items: string | string[],
): void {
  try {
    const windowID = progressWindowManager.create({ title });
    if (!windowID) return;

    progressWindowManager.addLines(windowID, items);

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
