/**
 * EpoOAuthClient — EPO OPS OAuth2 token management
 *
 * EPO OPS uses client_credentials OAuth2 flow:
 *   POST https://ops.epo.org/3.2/auth/accesstoken
 *   with Basic auth (consumerKey:consumerSecret)
 *   body: grant_type=client_credentials
 *   response: application/x-www-form-urlencoded (access_token, expires_in)
 *
 * Token is cached IN-MEMORY ONLY — never persisted to Zotero.Prefs/SQLite
 * (sensitive credential, must not leak). Refresh 30s before expiry to avoid
 * boundary races. Concurrent requests share a single in-flight refresh.
 *
 * ⚠ 学习模式贡献点：并发去重策略（pendingRequest）
 *    当 search-patents 和 get-patent-details 同时触发 EPO 调用且 token 过期时，
 *    若无去重会发起两次并行 token 请求。当前用单 in-flight Promise 去重。
 *    备选策略：队列 + 广播 / 全局锁 / 每-N-秒只刷一次。当前选 in-flight Promise
 *    因为最简单且零额外开销。
 */

import { getPrefDynamic } from "../../utils/prefs";
import { ZSEARCH_HTTP_HEADERS } from "../../utils/httpHeaders";

const EPO_TOKEN_URL = "https://ops.epo.org/3.2/auth/accesstoken";
const TOKEN_REFRESH_MARGIN_MS = 30 * 1000; // 提前 30s 刷新
const MAX_RETRIES = 2;

interface CachedToken {
  token: string;
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;
// Concurrent dedup: while one refresh is in-flight, callers await the same promise.
let pendingRequest: Promise<string> | null = null;

/** Check if EPO credentials are configured. */
export function isEpoConfigured(): boolean {
  const key = getPrefDynamic("apis.epo.consumerKey") as string;
  const secret = getPrefDynamic("apis.epo.consumerSecret") as string;
  return !!(key && secret);
}

/**
 * Get a valid EPO access token, refreshing if necessary.
 * @throws Error if credentials are missing or token fetch fails after retries.
 */
export async function getEpoAccessToken(): Promise<string> {
  // Cache hit (with refresh margin)
  if (
    cachedToken &&
    Date.now() < cachedToken.expiresAt - TOKEN_REFRESH_MARGIN_MS
  ) {
    return cachedToken.token;
  }

  // Concurrent dedup: if a refresh is in-flight, await it
  if (pendingRequest) {
    return pendingRequest;
  }

  pendingRequest = fetchNewToken(1);
  try {
    return await pendingRequest;
  } finally {
    pendingRequest = null;
  }
}

async function fetchNewToken(attempt: number): Promise<string> {
  const key = getPrefDynamic("apis.epo.consumerKey") as string;
  const secret = getPrefDynamic("apis.epo.consumerSecret") as string;

  if (!key || !secret) {
    throw new Error(
      "EPO OAuth credentials not configured. Set apis.epo.consumerKey and apis.epo.consumerSecret in preferences.",
    );
  }

  try {
    // Basic auth: base64(consumerKey:consumerSecret)
    const basicAuth = btoa(`${key}:${secret}`);
    const response = await Zotero.HTTP.request("POST", EPO_TOKEN_URL, {
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
        ...ZSEARCH_HTTP_HEADERS,
      },
      body: "grant_type=client_credentials",
      timeout: 30000,
      errorDelayMax: 0,
    } as any);

    if (response.status >= 400) {
      throw new Error(`EPO token request failed: HTTP ${response.status}`);
    }

    // EPO returns application/x-www-form-urlencoded, not JSON
    const text = response.responseText || "";
    const params = new URLSearchParams(text);
    const token = params.get("access_token");
    const expiresInStr = params.get("expires_in");

    if (!token) {
      throw new Error("EPO token response missing access_token");
    }

    const expiresIn = parseInt(expiresInStr || "1200", 10);
    cachedToken = {
      token,
      expiresAt: Date.now() + expiresIn * 1000,
    };

    return token;
  } catch (e: any) {
    // Clear stale cache on failure
    cachedToken = null;

    // Retry once (CLAUDE.md: catch must retry, but bounded)
    if (attempt < MAX_RETRIES) {
      return fetchNewToken(attempt + 1);
    }
    throw new Error(
      `EPO OAuth failed after ${MAX_RETRIES} attempts: ${e.message}`,
      { cause: e },
    );
  }
}

/** Clear cached token (e.g., on credential change or for testing). */
export function clearEpoTokenCache(): void {
  cachedToken = null;
  pendingRequest = null;
}
