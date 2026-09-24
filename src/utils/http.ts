/**
 * Unified HTTP GET helper for handler-level network calls.
 *
 * Consolidates the repetitive `Zotero.HTTP.request("GET", url, { headers: { Accept, ...ZSEARCH_HTTP_HEADERS }, timeout: 30000, errorDelayMax: 0 })`
 * boilerplate that appeared in academic-search.ts and patent-search.ts.
 *
 * Design:
 * - Always sets `errorDelayMax: 0` (agent loop owns retry policy; Zotero's built-in 5xx backoff
 *   of up to 1 hour must be disabled here).
 * - Returns a discriminated union so callers can branch on specific statuses
 *   (e.g. 401 → clear EPO token cache, 429 → surface rate-limit message).
 * - Does NOT auto-parse JSON: callers that need JSON call `JSON.parse(result.body)`.
 *   `body` is the raw `responseText`; for XML endpoints (EPO OPS, arXiv), use `body` directly.
 *
 * Reserved cases (do NOT migrate):
 * - POST requests (Dimensions, Lens patent search, patentToScholarly, paperToPatents).
 * - Calls needing `responseType: "text"` for DOMParser (arXiv atom+xml, visitWebpage).
 * - Calls with custom retry loops (searchCORE exponential backoff on 5xx).
 * - Calls without `errorDelayMax: 0` (searchGithub — intentional, relies on Github's own backoff).
 * - Calls with no status gating (CrossRef title→DOI probe in importArticle).
 *
 * 位置（C-1，2026-09-16 第四轮审计）：本件原住 `core/tool/builtin/handlers/_shared/http.ts`
 * ——tool **适配层**——却被 tool 域外的 7 个文件消费（tracking/registry ×6 +
 * citation/RefWorksStore），即 tool 适配层已事实上成了共享基础设施层。故与 C-10 的
 * NotificationHelper 同法下沉至横切 utils/（本件只依赖同层的 `httpHeaders`/`error`）。
 * 语义未改一字：`errorDelayMax: 0`、不重试、不自动 parse、不设 `responseType` 均为立法。
 */

import { ZSEARCH_HTTP_HEADERS } from "./httpHeaders";
import { toErrorMessage } from "./error";

export type HttpGetResult =
  | { ok: true; status: number; body: string }
  | { ok: false; status: number; error: string; body?: string };

/**
 * Perform a GET request with standard Leadero HTTP settings.
 *
 * @param url       Target URL (already query-string-encoded by caller).
 * @param headers   Extra headers merged on top of `{ Accept: "application/json", ...ZSEARCH_HTTP_HEADERS }`.
 *                  Pass `Accept` here to override (e.g. `"application/xml"` for EPO OPS).
 * @param timeoutMs Request timeout (default 30000ms; some endpoints use 15000ms).
 *
 * On HTTP failure (status >= 400, or network/parse exception), returns `{ ok: false, status, error }`.
 * On success (status < 400), returns `{ ok: true, status, body }` where `body` is the raw responseText.
 */
export async function httpJsonGet(
  url: string,
  headers?: Record<string, string>,
  timeoutMs: number = 30000,
): Promise<HttpGetResult> {
  try {
    const response = await Zotero.HTTP.request("GET", url, {
      headers: {
        Accept: "application/json",
        ...ZSEARCH_HTTP_HEADERS,
        ...headers,
      },
      timeout: timeoutMs,
      errorDelayMax: 0,
    } as any);

    const status = response.status;
    if (status >= 400) {
      return {
        ok: false,
        status,
        error: `HTTP ${status}`,
        body: response.responseText ?? "",
      };
    }
    return { ok: true, status, body: response.responseText ?? "" };
  } catch (e: any) {
    // Zotero.HTTP.request rejects on network failure, timeout, or non-2xx if not caught above.
    // Preserve any status info attached by Zotero; fall back to the thrown message.
    const status = (e as any)?.status ?? 0;
    return {
      ok: false,
      status,
      error: toErrorMessage(e, "Network request failed"),
    };
  }
}
