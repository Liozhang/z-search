/**
 * Lightweight logger wrapping Zotero.debug.
 *
 * Output is HUMAN-READABLE (not JSON): Zotero's Debug Output Viewer renders
 * Zotero.debug strings line-by-line as readable text, so JSON lines would make
 * interactive debugging harder. Instead, the structured helpers below emit a
 * single line per event prefixed with `trace=<id>` so a full agent run
 * (ai.request → tool.invoke → ai.request) can be correlated by grepping one id.
 *
 * `log` / `logError` are kept for backward compatibility (log() is currently
 * dead code — 0 call sites — but retained to avoid breaking imports).
 */

function debugPrefEnabled(): boolean {
  try {
    return !!Zotero.Prefs.get(
      "extensions.zotero.leadero.advanced.debugLog",
      true,
    );
  } catch (e) {
    rawDebug("[z-search] " + e);
    return false;
  }
}

/** Guarded Zotero.debug — logging must never throw. vitest 沙箱会把
 *  globalThis.Zotero 换成窄桩甚至 undefined（错误路径测试常这么造场景），
 *  裸调会把"处理错误"变成"抛出新错误"。 */
function rawDebug(message: string, stackFrame?: number): void {
  try {
    if (stackFrame !== undefined) {
      Zotero.debug(message, stackFrame);
    } else {
      Zotero.debug(message);
    }
  } catch {
    /* ignore — logging must never throw */
  }
}

/** True when verbose logging should be emitted (dev build OR debug pref on). */
function verboseEnabled(): boolean {
  return __env__ === "development" || debugPrefEnabled();
}

/**
 * Emit a single correlated log line: `[z-search] trace=<id> level=<L> event=<e> <fields>`.
 * `fields` values are stringified inline as `key=value` pairs for readability.
 */
function emit(
  level: string,
  event: string,
  fields?: Record<string, unknown>,
  traceId?: string,
): void {
  const parts: string[] = [];
  if (traceId) parts.push(`trace=${traceId}`);
  parts.push(`level=${level}`);
  parts.push(`event=${event}`);
  if (fields) {
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined || v === null) continue;
      const vs = typeof v === "string" ? v : safeStringify(v);
      parts.push(`${k}=${vs}`);
    }
  }
  rawDebug(`[z-search] ${parts.join(" ")}`);
}

function safeStringify(v: unknown): string {
  try {
    return typeof v === "object" ? JSON.stringify(v) : String(v);
  } catch (e) {
    rawDebug("[z-search] " + e);
    return String(v);
  }
}

/**
 * Structured event logger at INFO level. Always emitted (info is not gated).
 * @param event  short event name, e.g. "ai.request.start"
 * @param fields optional key/value payload (rendered as key=value)
 * @param traceId optional correlation id (typically the agent sessionId)
 */
export function info(
  event: string,
  fields?: Record<string, unknown>,
  traceId?: string,
): void {
  emit("info", event, fields, traceId);
}

/** Structured WARN level. Always emitted. */
export function warn(
  event: string,
  fields?: Record<string, unknown>,
  traceId?: string,
): void {
  emit("warn", event, fields, traceId);
}

/** Structured ERROR level. Always emitted at stack frame 2 so Zotero logs it. */
export function error(
  event: string,
  fields?: Record<string, unknown>,
  traceId?: string,
): void {
  emit("error", event, fields, traceId);
  // Mark as error severity for Zotero's debug output filtering.
  rawDebug(
    `[Leadero ERROR] event=${event}` + (traceId ? ` trace=${traceId}` : ""),
    2,
  );
}

/** Structured DEBUG level — gated by dev build OR the debugLog pref. */
export function debug(
  event: string,
  fields?: Record<string, unknown>,
  traceId?: string,
): void {
  if (!verboseEnabled()) return;
  emit("debug", event, fields, traceId);
}

// ── Backward-compatible free-form helpers ──────────────────────────────

export function log(...args: any[]) {
  if (verboseEnabled()) {
    rawDebug(`[z-search] ${args.map(String).join(" ")}`);
  }
}

export function logError(...args: any[]) {
  rawDebug(`[Leadero ERROR] ${args.map(String).join(" ")}`, 2);
}

/** Iframe/standalone-safe debug logger. Unlike the legacy direct `Zotero.debug(...)`
 * calls scattered in core modules, this never throws when the Zotero global is
 * absent — it falls through the same try/catch as the structured logger. */
export function safeDebug(message: string): void {
  rawDebug(message);
}
