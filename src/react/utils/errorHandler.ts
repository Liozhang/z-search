/**
 * Unified UI error handler.
 *
 * Consolidates the repeated pattern of:
 *   safeDebug(...) + friendlyErrorMessage
 *
 * Usage:
 *   // Return error string for banner/state
 *   catch (e) {
 *     const msg = handleUiError(e);
 *     setError(msg);
 *   }
 *
 *   // Silent — no notification, caller handles display
 *   catch (e) {
 *     const msg = handleUiError(e, { silent: true });
 *     setError(msg);
 *   }
 *
 * Decision rule for when to use which option:
 *   - { silent: true }: error will be shown via ErrorBanner or other persistent UI
 */

import { safeDebug } from "../../utils/logger";
import { getString } from "../../utils/locale";

export interface HandleUiErrorOptions {
  /** Suppress toast — caller handles display */
  silent?: boolean;
}

/** PostMessageBridge 的超时拒绝串（bridge/PostMessageBridge.ts）——原样上
 *  UI 是内部英文裸串（2026-09-16 审计 A3）。在统一漏斗映射成本地化文案，
 *  方法名保留括注以便定位；其余错误仍原样透传。 */
const BRIDGE_TIMEOUT_RE = /^PostMessageBridge request timeout: (.+)$/;

/**
 * Normalize error → debug log → return error string.
 *
 * @returns The human-readable error message for the caller to use
 *   (e.g., setError state, ErrorBanner message, etc.)
 */
export function handleUiError(
  error: unknown,
  _opts: HandleUiErrorOptions = {},
): string {
  const errMsg = error instanceof Error ? error.message : String(error);
  safeDebug(`[z-search] ${errMsg}`);
  const method = BRIDGE_TIMEOUT_RE.exec(errMsg)?.[1];
  if (method) return getString("error-bridge-timeout", { args: { method } });
  return errMsg;
}
