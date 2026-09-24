/**
 * GitHub Copilot Authentication
 *
 * Implements OAuth Device Flow for GitHub Copilot API access.
 * Uses Zotero.HTTP.request (no native fetch in sandbox).
 *
 * Flow: Device Code → User authorizes in browser → GitHub token → Copilot JWT
 * JWT expires every ~25 minutes and is refreshed automatically.
 */

const COPILOT_CLIENT_ID = "Iv1.b507a08c87ecfe98";
const DEVICE_CODE_URL = "https://github.com/login/device/code";
const OAUTH_TOKEN_URL = "https://github.com/login/oauth/access_token";
const JWT_URL = "https://api.github.com/copilot_internal/v2/token";
const MODELS_URL = "https://api.githubcopilot.com/models";
const GITHUB_TOKEN_PREF = "extensions.zotero.zsearch.ai.copilot.githubToken";
import { ZSEARCH_HTTP_HEADERS } from "../../utils/httpHeaders";
import {
  getSecret,
  setSecret,
  deleteSecret,
  SECRET_USERNAMES,
} from "../../utils/secretStore";
import { safeDebug } from "../../utils/logger";

// GitHub token canonical store = OS keychain（内存镜像 + 旧 pref 回退，
// 与 CodexAuth/GoogleAuth 同制）。
let memoryGithubToken = "";

function getStoredGithubToken(): string {
  if (memoryGithubToken) return memoryGithubToken;
  const fromKeychain = getSecret(SECRET_USERNAMES.copilotToken);
  if (fromKeychain) return fromKeychain;
  return (Zotero.Prefs.get(GITHUB_TOKEN_PREF, true) as string) || "";
}

export function setStoredGithubToken(token: string): void {
  memoryGithubToken = token;
  void setSecret(SECRET_USERNAMES.copilotToken, token).then((ok) => {
    if (!ok) Zotero.Prefs.set(GITHUB_TOKEN_PREF, token, true);
  });
}

export function clearStoredGithubToken(): void {
  memoryGithubToken = "";
  void deleteSecret(SECRET_USERNAMES.copilotToken);
  Zotero.Prefs.clear(GITHUB_TOKEN_PREF, true);
}

export function isCopilotLoggedIn(): boolean {
  return !!getStoredGithubToken();
}

let cachedJwt: { token: string; expiresAt: number } | null = null;
let pendingJwt: Promise<string> | null = null;

export function clearJwtCache(): void {
  cachedJwt = null;
  pendingJwt = null;
}

export type DeviceFlowResult = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  interval: number;
  expires_in: number;
};

/**
 * Start GitHub OAuth Device Flow.
 * Returns device_code info for the user to authorize in browser.
 */
export async function startDeviceFlow(): Promise<DeviceFlowResult> {
  const response = await Zotero.HTTP.request("POST" as any, DEVICE_CODE_URL, {
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...ZSEARCH_HTTP_HEADERS,
    },
    body: JSON.stringify({
      client_id: COPILOT_CLIENT_ID,
      scope: "read:user",
    }),
    responseType: "text",
    timeout: 30000,
  });

  const data = JSON.parse(response.response as string);
  return {
    device_code: data.device_code,
    user_code: data.user_code,
    verification_uri: data.verification_uri,
    interval: data.interval || 5,
    expires_in: data.expires_in || 900,
  };
}

/**
 * Poll for device auth completion.
 * Uses Date.now() timeout instead of AbortController (not available in sandbox).
 */
export async function pollDeviceAuth(params: {
  deviceCode: string;
  interval: number;
  expiresIn: number;
  cancelled: { value: boolean };
}): Promise<string> {
  const deadline = Date.now() + params.expiresIn * 1000;
  let interval = params.interval * 1000;

  while (Date.now() < deadline) {
    if (params.cancelled.value) {
      throw new Error("Login cancelled.");
    }

    await new Promise<void>((resolve) => setTimeout(resolve, interval));

    if (params.cancelled.value) {
      throw new Error("Login cancelled.");
    }

    const response = await Zotero.HTTP.request("POST" as any, OAUTH_TOKEN_URL, {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...ZSEARCH_HTTP_HEADERS,
      },
      body: JSON.stringify({
        client_id: COPILOT_CLIENT_ID,
        device_code: params.deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
      responseType: "text",
      timeout: 15000,
    });

    const payload = JSON.parse(response.response as string);

    if (payload.access_token) {
      return payload.access_token as string;
    }

    if (payload.error === "authorization_pending") {
      continue;
    }
    if (payload.error === "slow_down") {
      interval += 5000;
      continue;
    }
    if (payload.error === "expired_token") {
      throw new Error("Login expired. Please try again.");
    }
    if (payload.error === "access_denied") {
      throw new Error("Login denied by user.");
    }
    throw new Error(`Unexpected device auth error: ${payload.error}`);
  }

  throw new Error("Login expired. Please try again.");
}

/**
 * Fetch Copilot JWT from GitHub token.
 * JWT is short-lived (~25 min), cache and auto-refresh.
 */
async function fetchJwt(githubToken: string): Promise<string> {
  // Check cache
  if (cachedJwt && cachedJwt.expiresAt > Date.now() + 60_000) {
    return cachedJwt.token;
  }
  // F-33（回退审计 2026-09-11，P3）：60s 缓冲内的"提前刷新"落日志，便于
  // 排查 GitHub 侧 429 速率限制是否由高频缓冲刷新贡献。
  if (cachedJwt) {
    safeDebug(
      "[z-search] CopilotAuth: early JWT refresh (expires within 60s buffer)",
    );
  }

  // Deduplicate concurrent requests
  if (pendingJwt) {
    return pendingJwt;
  }

  pendingJwt = (async () => {
    try {
      const response = await Zotero.HTTP.request("GET" as any, JWT_URL, {
        headers: {
          Authorization: `token ${githubToken}`,
          Accept: "application/json",
          "Editor-Version": "vscode/1.96.0",
          "Editor-Plugin-Version": "copilot-chat/0.24.2",
          "User-Agent": "GithubCopilot/1.246.0",
          ...ZSEARCH_HTTP_HEADERS,
        },
        responseType: "text",
        timeout: 30000,
      });

      const payload = JSON.parse(response.response as string);
      const token =
        typeof payload.token === "string" ? payload.token.trim() : "";
      if (!token) {
        throw new Error("Copilot token exchange returned empty token");
      }

      const expiresAt =
        typeof payload.expires_at === "number"
          ? payload.expires_at * 1000
          : Date.now() + 25 * 60 * 1000;

      cachedJwt = { token, expiresAt };
      return token;
    } finally {
      pendingJwt = null;
    }
  })();

  return pendingJwt;
}

/**
 * Get a valid Copilot JWT, refreshing if needed.
 * Throws if not logged in.
 */
export async function getValidJwt(): Promise<string> {
  const githubToken = getStoredGithubToken();
  if (!githubToken) {
    throw new Error("Copilot not logged in");
  }
  return fetchJwt(githubToken);
}

/**
 * Build Copilot-specific headers for API requests.
 */
export function buildCopilotHeaders(jwt: string): Record<string, string> {
  return {
    Authorization: `Bearer ${jwt}`,
    "Copilot-Integration-Id": "vscode-chat",
    "Editor-Version": "vscode/1.96.0",
    "Editor-Plugin-Version": "copilot-chat/0.24.2",
    "Openai-Intent": "conversation-panel",
  };
}

type CopilotModelEntry = {
  id?: string;
  name?: string;
  model_picker_enabled?: boolean;
  model_picker_category?: string;
  capabilities?: {
    type?: string;
    supports?: {
      chat?: boolean;
      tool_calls?: boolean;
    };
  };
  policy?: {
    state?: string;
  };
  supported_endpoints?: string[];
};

export type CopilotModelInfo = {
  id: string;
  name: string;
};

function isCopilotModelUsable(m: CopilotModelEntry): boolean {
  if (m.capabilities?.type && m.capabilities.type !== "chat") return false;
  if (m.policy?.state === "disabled") return false;
  if (
    Array.isArray(m.supported_endpoints) &&
    !m.supported_endpoints.includes("/chat/completions") &&
    !m.supported_endpoints.includes("/responses")
  ) {
    return false;
  }
  if (m.model_picker_enabled === false && !m.model_picker_category)
    return false;
  if (typeof m.id === "string" && /-codex($|-)/i.test(m.id)) return false;
  if (typeof m.id === "string" && /^oswe-/i.test(m.id)) return false;
  if (typeof m.id === "string" && /^grok-code/i.test(m.id)) return false;
  return true;
}

/**
 * Fetch available models from Copilot API.
 */
export async function fetchModelList(): Promise<CopilotModelInfo[]> {
  const jwt = await getValidJwt();
  const response = await Zotero.HTTP.request("GET" as any, MODELS_URL, {
    headers: {
      ...buildCopilotHeaders(jwt),
      ...ZSEARCH_HTTP_HEADERS,
    },
    responseType: "text",
    timeout: 30000,
  });

  const payload = JSON.parse(response.response as string);
  return (payload.data || [])
    .filter(
      (m: CopilotModelEntry) =>
        typeof m.id === "string" && m.id.trim() && isCopilotModelUsable(m),
    )
    .map((m: CopilotModelEntry) => ({
      id: (m.id as string).trim(),
      name: (m.name || m.id || "").trim(),
    }));
}
