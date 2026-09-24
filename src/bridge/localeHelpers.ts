/**
 * localeHelpers — Shared locale request handling for all WindowBridge implementations.
 *
 * Centralizes the repetitive locale.* routing. Subclasses call
 * handleLocaleRequest() for any method starting with 'locale.'.
 *
 * @module bridge/localeHelpers
 */

import { getString, formatRelativeTime } from "../utils/locale";
import { resolveAllLocaleKeys } from "./localeBatch";

/**
 * Handle a locale.* request from the iframe.
 * Returns the result value, or undefined if the method is not a locale request.
 */
export function handleLocaleRequest(event: string, payload: any): any {
  if (event === "locale.getString") {
    return getString(payload?.key, { args: payload?.args });
  }
  if (event === "locale.getAll") {
    return resolveAllLocaleKeys();
  }
  if (event === "locale.formatRelativeTime") {
    return formatRelativeTime(payload?.ts);
  }
  if (event === "locale.getLocale") {
    // BCP47 locale tag (e.g. "zh-CN") for Intl formatters inside the iframe —
    // the iframe has no Zotero global, so Intl defaults to the browser locale
    // instead of the Zotero/app locale.
    return (Zotero as any).locale || "en-US";
  }
  return undefined;
}
