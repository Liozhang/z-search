/**
 * Google Authentication — official Generative Language API OAuth (advanced).
 *
 * Compliant route: each user registers their OWN Google Cloud "Desktop app"
 * OAuth client (console.cloud.google.com → enable Generative Language API →
 * OAuth consent screen → create Desktop client) and pastes the client id
 * into the Google provider card. Desktop clients support loopback redirects
 * (http://localhost:<port>) with PKCE. Replicating the Gemini CLI's
 * first-party client id is deliberately NOT implemented — Google bans
 * third-party users of that client (2026-02 ToS enforcement wave).
 *
 * The access token is a Bearer for the standard generativelanguage
 * .googleapis.com endpoint (same baseUrl as the api_key path); UnifiedAI
 * Provider injects it and strips x-goog-api-key. Login flips
 * provider.authMode to "google_auth" and logout flips it back —
 * ConfigManager persists that override across restarts.
 */

import { ZSEARCH_HTTP_HEADERS } from "../../utils/httpHeaders";
import { getPrefDynamic, setPrefDynamic } from "../../utils/prefs";

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/generative-language";

const DEFAULT_EXPIRES_IN_S = 3600;

const PREF_CLIENT_ID = "ai.google.oauthClientId";
const PREF_ACCESS_TOKEN = "extensions.zotero.zsearch.ai.google.accessToken";
const PREF_REFRESH_TOKEN = "extensions.zotero.zsearch.ai.google.refreshToken";
import {
  getSecret,
  setSecret,
  deleteSecret,
  SECRET_USERNAMES,
} from "../../utils/secretStore";

// Refresh token canonical store = OS keychain（内存镜像桥接首次异步写入窗口，
// 旧 pref 作为 keychain 失败时的回退——与 CodexAuth 同制）。
let memoryRefreshToken = "";

export function getStoredClientId(): string {
  return String(getPrefDynamic(PREF_CLIENT_ID) ?? "").trim();
}

export function setStoredClientId(clientId: string): void {
  setPrefDynamic(PREF_CLIENT_ID, clientId.trim());
}

function getStoredRefreshToken(): string {
  if (memoryRefreshToken) return memoryRefreshToken;
  const fromKeychain = getSecret(SECRET_USERNAMES.googleRefresh);
  if (fromKeychain) return fromKeychain;
  return (Zotero.Prefs.get(PREF_REFRESH_TOKEN, true) as string) || "";
}

function setStoredTokens(accessToken: string, refreshToken: string): void {
  Zotero.Prefs.set(PREF_ACCESS_TOKEN, accessToken, true);
  memoryRefreshToken = refreshToken;
  void setSecret(SECRET_USERNAMES.googleRefresh, refreshToken).then((ok) => {
    if (!ok) Zotero.Prefs.set(PREF_REFRESH_TOKEN, refreshToken, true);
  });
}

export function clearStoredTokens(): void {
  Zotero.Prefs.clear(PREF_ACCESS_TOKEN, true);
  memoryRefreshToken = "";
  void deleteSecret(SECRET_USERNAMES.googleRefresh);
  Zotero.Prefs.clear(PREF_REFRESH_TOKEN, true);
}

export function isLoggedIn(): boolean {
  return !!getStoredRefreshToken();
}

let cachedAccessToken: { token: string; expiresAt: number } | null = null;
let pendingTokenRefresh: Promise<string> | null = null;

export function clearTokenCache(): void {
  cachedAccessToken = null;
  pendingTokenRefresh = null;
}

/**
 * Compose the Google consent URL. access_type=offline + prompt=consent
 * force a refresh token on every authorization (otherwise Google only
 * issues one on first consent and silent re-logins would break).
 */
export function buildLoginUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const query = [
    `client_id=${encodeURIComponent(params.clientId)}`,
    `redirect_uri=${encodeURIComponent(params.redirectUri)}`,
    "response_type=code",
    `scope=${encodeURIComponent(SCOPE)}`,
    `state=${encodeURIComponent(params.state)}`,
    `code_challenge=${encodeURIComponent(params.codeChallenge)}`,
    "code_challenge_method=S256",
    "access_type=offline",
    "prompt=consent",
  ].join("&");
  return `${AUTHORIZE_URL}?${query}`;
}

export interface GoogleTokenSet {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/**
 * Exchange the authorization code for access + refresh tokens.
 * Desktop (installed-app) clients: client_id only, no secret.
 */
export async function exchangeCodeForTokens(params: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  clientId: string;
}): Promise<GoogleTokenSet> {
  const response = await Zotero.HTTP.request("POST" as any, TOKEN_URL, {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...ZSEARCH_HTTP_HEADERS,
    },
    body: [
      "grant_type=authorization_code",
      `code=${encodeURIComponent(params.code)}`,
      `redirect_uri=${encodeURIComponent(params.redirectUri)}`,
      `client_id=${encodeURIComponent(params.clientId)}`,
      `code_verifier=${encodeURIComponent(params.codeVerifier)}`,
    ].join("&"),
    responseType: "text",
    timeout: 30000,
  });

  const payload = JSON.parse(response.response as string);
  const accessToken =
    typeof payload.access_token === "string" ? payload.access_token.trim() : "";
  const refreshToken =
    typeof payload.refresh_token === "string"
      ? payload.refresh_token.trim()
      : "";
  if (!accessToken || !refreshToken) {
    throw new Error(
      "Google token exchange returned incomplete tokens (check that the OAuth client is a Desktop app and the Generative Language API is enabled).",
    );
  }
  const expiresIn =
    typeof payload.expires_in === "number" && payload.expires_in > 0
      ? payload.expires_in
      : DEFAULT_EXPIRES_IN_S;

  setStoredTokens(accessToken, refreshToken);
  cachedAccessToken = {
    token: accessToken,
    expiresAt: Date.now() + expiresIn * 1000,
  };
  return { accessToken, refreshToken, expiresIn };
}

/**
 * Refresh the access token. An invalid/expired refresh token (typically the
 * consent screen left in Testing mode past its 7-day window) clears storage
 * — the honest signal is "please re-login", not a stuck retry loop.
 */
async function refreshAccessToken(): Promise<GoogleTokenSet> {
  const refreshToken = getStoredRefreshToken();
  const clientId = getStoredClientId();
  if (!refreshToken || !clientId) {
    throw new Error("Google not logged in. Please sign in again.");
  }

  // Without successCodes, HTTP.request rejects on ANY non-2xx; we need to
  // read 400/401 bodies ourselves (RepoBackend convention).
  const response = await Zotero.HTTP.request("POST" as any, TOKEN_URL, {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...ZSEARCH_HTTP_HEADERS,
    },
    body: [
      "grant_type=refresh_token",
      `refresh_token=${encodeURIComponent(refreshToken)}`,
      `client_id=${encodeURIComponent(clientId)}`,
    ].join("&"),
    responseType: "text",
    timeout: 30000,
    successCodes: [200, 400, 401],
  } as any);

  const status = response.status as number;
  if (status !== 200) {
    clearStoredTokens();
    throw new Error("Google refresh token expired. Please re-login.");
  }

  const payload = JSON.parse(response.response as string);
  const accessToken =
    typeof payload.access_token === "string" ? payload.access_token.trim() : "";
  if (!accessToken) {
    throw new Error("Google token refresh returned empty access token.");
  }
  const expiresIn =
    typeof payload.expires_in === "number" && payload.expires_in > 0
      ? payload.expires_in
      : DEFAULT_EXPIRES_IN_S;

  setStoredTokens(accessToken, refreshToken);
  return { accessToken, refreshToken, expiresIn };
}

/**
 * Get a valid access token, refreshing when the cached one is within 60s of
 * expiry. Concurrent callers share one refresh (pending dedupe).
 */
export async function getValidAccessToken(): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedAccessToken.token;
  }

  if (!getStoredRefreshToken()) {
    throw new Error("Google not logged in. Please sign in again.");
  }

  if (pendingTokenRefresh) {
    return pendingTokenRefresh;
  }

  pendingTokenRefresh = (async () => {
    try {
      const { accessToken, expiresIn } = await refreshAccessToken();
      cachedAccessToken = {
        token: accessToken,
        expiresAt: Date.now() + expiresIn * 1000,
      };
      return accessToken;
    } finally {
      pendingTokenRefresh = null;
    }
  })();

  return pendingTokenRefresh;
}
