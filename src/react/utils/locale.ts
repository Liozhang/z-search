/**
 * Locale utility — wraps getString() via bridge API.
 * Falls back to the key itself if API is not available.
 *
 * In iframe mode: uses a pre-populated locale cache (sync read).
 * In legacy mode: delegates to window.leaderoAPI.locale (sync).
 */

import { runningInIframe } from "./bridge";
import { friendlyErrorKey } from "../../utils/errorMessages";
import { formatDate } from "../../utils/dateFormat";
import { safeDebug } from "../../utils/logger";

/** Locale cache populated at init time in iframe mode */
let _localeCache: Map<string, string> | null = null;
let _localeLoaded = false;

/**
 * BCP47 locale tag (e.g. "zh-CN") for Intl-based formatters (dates, numbers).
 * Populated alongside the string cache in iframe mode; read from the host API
 * or Zotero global otherwise. Null until first successful resolution.
 */
let _localeTag: string | null = null;

/**
 * Resolve the current locale tag for Intl formatters.
 * Order: iframe bridge cache → leaderoAPI.getLocale → Zotero.global → null.
 */
export function getLocaleTag(): string | null {
  if (_localeTag) return _localeTag;
  try {
    const api = (window as any).leaderoAPI;
    if (api?.locale?.getLocale) {
      _localeTag = api.locale.getLocale();
      if (_localeTag) return _localeTag;
    }
  } catch (e) {
    safeDebug("[z-search] locale: leaderoAPI.getLocale failed: " + e);
    // fall through
  }
  try {
    const z = (globalThis as any).Zotero;
    if (z?.locale) {
      _localeTag = z.locale;
      return _localeTag;
    }
  } catch (e) {
    safeDebug("[z-search] locale: locale tag read failed: " + e);
    // fall through
  }
  return null;
}

/**
 * Initialize locale cache from bridge (iframe mode).
 * Called once from index.tsx after bridge is set up.
 */
export async function initLocaleCache(): Promise<void> {
  if (!runningInIframe() || _localeLoaded) return;

  try {
    const bridge = (window as any).__bridge;
    if (!bridge) return;

    // Fetch all locale strings used in the React UI
    // The backend returns a map of key → translated string
    const result = await bridge.request("locale.getAll");
    if (result?.success && result?.data && typeof result.data === "object") {
      _localeCache = new Map(Object.entries(result.data));
    }

    // Fetch the locale tag for Intl formatters (dates/numbers). Non-fatal:
    // formatters fall back to "en-US" when unavailable.
    try {
      const tagResult = await bridge.request("locale.getLocale");
      const tag = tagResult?.success ? tagResult?.data : tagResult;
      if (typeof tag === "string" && tag) _localeTag = tag;
    } catch {
      // tag unavailable — formatters use getLocaleTag()'s other sources
    }
  } catch (e) {
    try {
      (globalThis as any).Zotero?.debug?.("[z-search] " + e);
    } catch (_) {
      // Locale cache unavailable — fallback to keys
    }
  }
  _localeLoaded = true;
}

function getFromCache(key: string, args?: Record<string, unknown>): string {
  if (!_localeCache) return key;
  let value = _localeCache.get(key);
  if (value === undefined) {
    logMissingKeyOnce(key);
    return key;
  }

  // Simple interpolation for {var} and Fluent { $var } placeholders
  // Supports both flat args: { count: 5 } and Zotero-style wrapped: { args: { count: 5 } }
  if (args) {
    const flatArgs =
      (args as any).args && typeof (args as any).args === "object"
        ? (args as any).args
        : args;
    for (const [k, v] of Object.entries(flatArgs as Record<string, unknown>)) {
      // L-31: function-form replacer — String.replace treats `$&`, `$'`, `$\``
      // in a STRING replacement specially, so user-controlled values (e.g.
      // verification-mismatch fields) corrupted the output.
      value = value.replace(new RegExp(`\\{\\s*\\$?\\s*${k}\\s*\\}`, "g"), () =>
        String(v),
      );
    }
  }
  return value;
}

// M-37: rate-limited miss logging — the react tree's getString is weakly
// typed (dynamic template keys make FluentMessageId impractical here), so a
// missing FTL key silently renders the bare key. Logging makes the drift
// visible in the console instead.
const _missLogSeen = new Set<string>();
function logMissingKeyOnce(key: string): void {
  if (_missLogSeen.has(key)) return;
  _missLogSeen.add(key);
  try {
    (globalThis as any).Zotero?.debug?.(
      `[z-search] react getString: locale key missing, rendering bare key: ${key}`,
    );
  } catch (_) {
    // debug unavailable or threw; never let logging crash render
  }
}

export function getString(key: string, args?: Record<string, unknown>): string {
  try {
    if (runningInIframe()) {
      return getFromCache(key, args);
    }
    const api = (window as any).leaderoAPI;
    if (api?.locale?.getString) {
      return api.locale.getString(key, args);
    }
  } catch (e) {
    try {
      (globalThis as any).Zotero?.debug?.("[z-search] " + e);
    } catch (_) {
      // debug unavailable or threw; never let logging crash render
    }
  }
  return key;
}

export function formatRelativeTime(timestamp: number): string {
  try {
    if (runningInIframe()) {
      // Use cached locale strings for relative time
      const diff = Date.now() - timestamp;
      const minutes = Math.floor(diff / 60000);
      const hours = Math.floor(diff / 3600000);
      const days = Math.floor(diff / 86400000);
      if (minutes < 1) return getFromCache("time-just-now");
      if (minutes < 60)
        return getFromCache("time-minutes-ago", { count: minutes });
      if (hours < 24) return getFromCache("time-hours-ago", { count: hours });
      if (days < 7) return getFromCache("time-days-ago", { count: days });
      // H-4（2026-09-15 部署包评审）：此前走 toLocaleDateString()，与任务列表的
      // formatDate 形成「2026/9/8 vs 2026-09-04」两种格式；统一到 leaf 模块。
      return formatDate(timestamp);
    }
    const api = (window as any).leaderoAPI;
    if (api?.locale?.formatRelativeTime) {
      return api.locale.formatRelativeTime(timestamp);
    }
  } catch (e) {
    try {
      (globalThis as any).Zotero?.debug?.("[z-search] " + e);
    } catch (_) {
      // debug unavailable or threw; never let logging crash render
    }
  }
  return new Date(timestamp).toLocaleString();
}

/**
 * Get localized soul/agent name. Tries 'soul-name-<id>' locale key first,
 * falls back to the original English name.
 */
export function getSoulName(soulId: string, fallback: string): string {
  const localized = getString(`soul-name-${soulId}`);
  // getString 在 key 缺失时返回 key 本身，但形态因运行环境而异：
  //   - iframe（react getFromCache）：返回无前缀 'soul-name-<id>'
  //   - XUL sidebar（主进程 _getString）：返回带 addon 前缀 'leadero-soul-name-<id>'
  // 两种 miss 形态都要识别，否则会把裸 key 当成名字渲染。
  const key = `soul-name-${soulId}`;
  return localized === key || localized === `leadero-${key}`
    ? fallback
    : localized;
}

/**
 * Convert raw API error messages into user-friendly localized messages.
 *
 * The classification rules live in src/utils/errorMessages.ts (shared with
 * the host bridge so persisted error messages render the same guidance as
 * live ones); this wrapper only resolves the winning Fluent key against the
 * iframe locale cache.
 */
export function friendlyErrorMessage(rawError: string): string {
  const key = friendlyErrorKey(rawError);
  if (key && key !== "chat-error-generic") return getString(key);
  if (!rawError) return getString("chat-error-generic");

  // Return truncated raw error with prefix if no pattern matched
  return getString("chat-error-with-detail", { error: rawError.slice(0, 120) });
}
