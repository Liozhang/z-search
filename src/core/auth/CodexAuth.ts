/**
 * Codex (ChatGPT) Authentication
 *
 * Implements OpenAI OAuth Device Code flow for in-app login.
 * Falls back to reading ~/.codex/auth.json for CLI users.
 * Tokens are persisted in Zotero prefs (preferred) or auth.json (fallback).
 *
 * Flow: Device Code → User authorizes → authorization_code → access_token + refresh_token
 * access_token is cached in memory, auto-refreshed before expiry.
 */

const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const DEVICE_AUTH_USERCODE_URL =
  "https://auth.openai.com/api/accounts/deviceauth/usercode";
const DEVICE_AUTH_TOKEN_URL =
  "https://auth.openai.com/api/accounts/deviceauth/token";
const OAUTH_TOKEN_URL = "https://auth.openai.com/oauth/token";
const DEVICE_VERIFICATION_URL = "https://auth.openai.com/codex/device";
const DEVICE_REDIRECT_URI = "https://auth.openai.com/deviceauth/callback";

const PREF_ACCESS_TOKEN = "extensions.zotero.zsearch.ai.codex.accessToken";
const PREF_REFRESH_TOKEN = "extensions.zotero.zsearch.ai.codex.refreshToken";
import { ZSEARCH_HTTP_HEADERS } from "../../utils/httpHeaders";
import {
  getSecret,
  setSecret,
  deleteSecret,
  SECRET_USERNAMES,
} from "../../utils/secretStore";
import { safeDebug } from "../../utils/logger";

// Refresh token canonical store = OS keychain. The legacy pref is only a
// fallback: read when the keychain copy is absent (pre-migration users),
// written when the keychain write fails so a login is never silently lost.
let memoryRefreshToken = "";

function getStoredRefreshToken(): string {
  if (memoryRefreshToken) return memoryRefreshToken;
  const fromKeychain = getSecret(SECRET_USERNAMES.codexRefresh);
  if (fromKeychain) return fromKeychain;
  return (Zotero.Prefs.get(PREF_REFRESH_TOKEN, true) as string) || "";
}

function setStoredTokens(accessToken: string, refreshToken: string): void {
  Zotero.Prefs.set(PREF_ACCESS_TOKEN, accessToken, true);
  memoryRefreshToken = refreshToken;
  void setSecret(SECRET_USERNAMES.codexRefresh, refreshToken).then((ok) => {
    if (!ok) Zotero.Prefs.set(PREF_REFRESH_TOKEN, refreshToken, true);
  });
}

export function clearStoredTokens(): void {
  Zotero.Prefs.clear(PREF_ACCESS_TOKEN, true);
  memoryRefreshToken = "";
  void deleteSecret(SECRET_USERNAMES.codexRefresh);
  Zotero.Prefs.clear(PREF_REFRESH_TOKEN, true);
}

export function isCodexLoggedIn(): boolean {
  return !!getStoredRefreshToken();
}

let cachedAccessToken: { token: string; expiresAt: number } | null = null;
let pendingTokenRefresh: Promise<string> | null = null;

export function clearTokenCache(): void {
  cachedAccessToken = null;
  pendingTokenRefresh = null;
}

export type CodexDeviceFlowResult = {
  device_auth_id: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
};

/**
 * Start OpenAI Device Code flow.
 * Returns device_auth_id + user_code for the user to authorize in browser.
 */
export async function startDeviceFlow(): Promise<CodexDeviceFlowResult> {
  const response = await Zotero.HTTP.request(
    "POST" as any,
    DEVICE_AUTH_USERCODE_URL,
    {
      headers: {
        "Content-Type": "application/json",
        ...ZSEARCH_HTTP_HEADERS,
      },
      body: JSON.stringify({ client_id: CODEX_CLIENT_ID }),
      responseType: "text",
      timeout: 30000,
    },
  );

  const data = JSON.parse(response.response as string);
  const rawInterval = data.interval;
  const interval =
    typeof rawInterval === "number"
      ? rawInterval
      : typeof rawInterval === "string"
        ? parseInt(rawInterval, 10)
        : 5;

  return {
    device_auth_id: data.device_auth_id,
    user_code: data.user_code,
    verification_uri: DEVICE_VERIFICATION_URL,
    expires_in: data.expires_in || 900,
    interval: Math.max(interval, 1) + 3, // safety margin like cc-switch
  };
}

/**
 * Poll for device auth completion.
 * Two-step: poll returns authorization_code + code_verifier, then exchange for tokens.
 */
export async function pollDeviceAuth(params: {
  deviceAuthId: string;
  userCode: string;
  interval: number;
  expiresIn: number;
  cancelled: { value: boolean };
}): Promise<void> {
  const deadline = Date.now() + params.expiresIn * 1000;

  while (Date.now() < deadline) {
    if (params.cancelled.value) {
      throw new Error("Login cancelled.");
    }

    await new Promise<void>((resolve) =>
      setTimeout(resolve, params.interval * 1000),
    );

    if (params.cancelled.value) {
      throw new Error("Login cancelled.");
    }

    const response = await Zotero.HTTP.request(
      "POST" as any,
      DEVICE_AUTH_TOKEN_URL,
      {
        headers: {
          "Content-Type": "application/json",
          ...ZSEARCH_HTTP_HEADERS,
        },
        body: JSON.stringify({
          device_auth_id: params.deviceAuthId,
          user_code: params.userCode,
        }),
        responseType: "text",
        timeout: 15000,
      },
    );

    const status = response.status as number;

    // 403/404 = not authorized yet, keep polling
    if (status === 403 || status === 404) {
      continue;
    }

    // 410 = expired
    if (status === 410) {
      throw new Error("Device code expired. Please try again.");
    }

    if (status < 200 || status >= 300) {
      throw new Error(`Device auth failed (HTTP ${status})`);
    }

    const payload = JSON.parse(response.response as string);

    if (!payload.authorization_code || !payload.code_verifier) {
      throw new Error(
        "Device auth response missing authorization_code or code_verifier",
      );
    }

    // Step 2: exchange authorization_code for access_token + refresh_token
    const tokenResponse = await Zotero.HTTP.request(
      "POST" as any,
      OAUTH_TOKEN_URL,
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          ...ZSEARCH_HTTP_HEADERS,
        },
        body: [
          "grant_type=authorization_code",
          `code=${payload.authorization_code}`,
          `redirect_uri=${encodeURIComponent(DEVICE_REDIRECT_URI)}`,
          `client_id=${encodeURIComponent(CODEX_CLIENT_ID)}`,
          `code_verifier=${encodeURIComponent(payload.code_verifier)}`,
        ].join("&"),
        responseType: "text",
        timeout: 30000,
      },
    );

    const tokenPayload = JSON.parse(tokenResponse.response as string);
    const accessToken =
      typeof tokenPayload.access_token === "string"
        ? tokenPayload.access_token.trim()
        : "";
    const refreshToken =
      typeof tokenPayload.refresh_token === "string"
        ? tokenPayload.refresh_token.trim()
        : "";

    if (!accessToken) {
      throw new Error("Token exchange returned empty access token");
    }

    // Persist tokens
    setStoredTokens(accessToken, refreshToken);

    // Cache access token
    const expiresIn =
      typeof tokenPayload.expires_in === "number"
        ? tokenPayload.expires_in
        : 3600;
    cachedAccessToken = {
      token: accessToken,
      expiresAt: Date.now() + expiresIn * 1000,
    };

    return;
  }

  throw new Error("Device code expired. Please try again.");
}

/**
 * Refresh access_token using refresh_token via form-urlencoded POST.
 */
async function refreshAccessToken(): Promise<{
  accessToken: string;
  refreshToken: string;
}> {
  const refreshToken = getStoredRefreshToken();
  if (!refreshToken) {
    throw new Error("Codex not logged in. No refresh token available.");
  }

  const response = await Zotero.HTTP.request("POST" as any, OAUTH_TOKEN_URL, {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...ZSEARCH_HTTP_HEADERS,
    },
    body: [
      "grant_type=refresh_token",
      `refresh_token=${encodeURIComponent(refreshToken)}`,
      `client_id=${encodeURIComponent(CODEX_CLIENT_ID)}`,
      "scope=openid profile email",
    ].join("&"),
    responseType: "text",
    timeout: 30000,
  });

  const status = response.status as number;
  if (status === 401 || status === 403) {
    clearStoredTokens();
    throw new Error("Codex refresh token expired. Please re-login.");
  }

  const payload = JSON.parse(response.response as string);
  const accessToken =
    typeof payload.access_token === "string" ? payload.access_token.trim() : "";
  if (!accessToken) {
    throw new Error("Codex token refresh returned empty access token");
  }

  const newRefresh =
    typeof payload.refresh_token === "string" && payload.refresh_token.trim()
      ? payload.refresh_token.trim()
      : refreshToken;

  // Update persisted tokens
  setStoredTokens(accessToken, newRefresh);

  return { accessToken, refreshToken: newRefresh };
}

/**
 * Get a valid access token, refreshing if needed.
 * Checks: Zotero prefs → fallback ~/.codex/auth.json.
 */
export async function getValidAccessToken(): Promise<string> {
  // Check cache
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedAccessToken.token;
  }

  // Deduplicate concurrent refreshes
  if (pendingTokenRefresh) {
    return pendingTokenRefresh;
  }

  pendingTokenRefresh = (async () => {
    try {
      // Try refresh via stored refresh_token
      const { accessToken } = await refreshAccessToken();
      const expiresIn = 3600; // default if not provided
      cachedAccessToken = {
        token: accessToken,
        expiresAt: Date.now() + expiresIn * 1000,
      };
      return accessToken;
    } catch (prefError) {
      // Fallback: try ~/.codex/auth.json
      try {
        const token = await tryAuthJsonFallback();
        cachedAccessToken = { token, expiresAt: Date.now() + 3600 * 1000 };
        return token;
      } catch (jsonError) {
        // Both paths failed — surface both reasons so the user can diagnose
        // which step broke (previously threw only prefError, masking the
        // auth.json failure entirely).
        throw new Error(
          `Codex auth failed: token refresh (${prefError instanceof Error ? prefError.message : prefError}) ` +
            `and auth.json fallback (${jsonError instanceof Error ? jsonError.message : jsonError})`,
          { cause: jsonError },
        );
      }
    } finally {
      pendingTokenRefresh = null;
    }
  })();

  return pendingTokenRefresh;
}

type CodexAuthJson = {
  tokens?: { access_token?: string; refresh_token?: string };
  [key: string]: unknown;
};

async function tryAuthJsonFallback(): Promise<string> {
  let homeDir: string;
  try {
    homeDir = Components.classes["@mozilla.org/file/directory-service;1"]
      .getService(Components.interfaces.nsIProperties)
      .get("Home", Components.interfaces.nsIFile).path;
  } catch (e) {
    // Zotero integration: Codex not logged in
    throw new Error("Codex not logged in.", { cause: e });
  }

  const path = PathUtils.join(homeDir, ".codex", "auth.json");
  let content: string;
  try {
    content = (await Zotero.File.getContentsAsync(path)) as string;
  } catch (e) {
    safeDebug("[z-search] CodexAuth: " + e);
    throw new Error("Codex not logged in.", { cause: e });
  }

  const auth = JSON.parse(content) as CodexAuthJson;
  const accessToken = auth?.tokens?.access_token;
  if (typeof accessToken === "string" && accessToken.trim()) {
    return accessToken.trim();
  }

  throw new Error("Codex not logged in.");
}
