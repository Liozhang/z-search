/**
 * SecretStore — thin wrapper over the Gecko LoginManager (Services.logins).
 *
 * Why not prefs: provider API keys and OAuth refresh tokens are bearer
 * credentials. prefs.js is plaintext on disk and rides along in profile
 * backups/sync; the login manager stores behind the OS credential vault
 * (the same mechanism Zotero uses for its own WebDAV password).
 *
 * In-repo precedent: PDFFinderInstitutional (positional findLogins — the
 * searchLoginsAsync matchData field names differ across Gecko versions,
 * so positional lookup is preferred).
 *
 * Host-side only: `Services` does not exist in iframe/test contexts —
 * getters return "" and writes resolve false instead of throwing.
 *
 * @module utils/secretStore
 */

import { safeDebug } from "./logger";

const SECRET_ORIGIN = "chrome://zsearch";
const SECRET_REALM = "Leadero AI Secrets";

/** Stable usernames within the realm. Provider keys use `provider:<id>`. */
export const SECRET_USERNAMES = {
  codexRefresh: "codex-refresh",
  googleRefresh: "google-refresh",
  copilotToken: "copilot-token",
} as const;

export function providerSecretKey(providerId: string): string {
  return `provider:${providerId}`;
}

function getLoginsService(): any | null {
  try {
    return (globalThis as any).Services?.logins ?? null;
  } catch (e) {
    safeDebug("[z-search] SecretStore: Services.logins unavailable: " + e);
    return null;
  }
}

function makeLoginInfo(username: string, password: string): any {
  const Ctor = (Components as any).Constructor(
    "@mozilla.org/login-manager/loginInfo;1",
    (Components as any).interfaces.nsILoginInfo,
    "init",
  );
  // (origin, formActionOrigin, httpRealm, username, password, usernameField, passwordField)
  return new Ctor(
    SECRET_ORIGIN,
    null,
    SECRET_REALM,
    username,
    password,
    "",
    "",
  );
}

function findLogin(username: string): any | null {
  const logins = getLoginsService();
  if (!logins) return null;
  try {
    // Positional findLogins — see module doc (Gecko matchData inconsistency).
    const all = logins.findLogins(SECRET_ORIGIN, null, SECRET_REALM) as any[];
    return all.find((l) => l.username === username) ?? null;
  } catch (e) {
    safeDebug(`[z-search] SecretStore: findLogins failed: ${e}`);
    return null;
  }
}

/**
 * Read a secret synchronously (LoginManager lookups are sync).
 * Returns "" when absent or when the keychain is unavailable.
 */
export function getSecret(username: string): string {
  const login = findLogin(username);
  return login?.password ? String(login.password) : "";
}

/**
 * Create or update a secret. When a login already exists this is a
 * synchronous modifyLogin (readable immediately after); the first-ever
 * write goes through async addLoginAsync — callers that read back
 * immediately should tolerate the tiny race (access tokens are cached
 * in memory, so auth flows only hit this on first login).
 * Resolves false when the keychain is unavailable or the write failed.
 */
export async function setSecret(
  username: string,
  password: string,
): Promise<boolean> {
  if (!password) return deleteSecret(username);
  const logins = getLoginsService();
  if (!logins) return false;
  try {
    const existing = findLogin(username);
    const info = makeLoginInfo(username, password);
    if (existing) {
      logins.modifyLogin(existing, info);
      return true;
    }
    await logins.addLoginAsync(info);
    return true;
  } catch (e) {
    safeDebug(`[z-search] SecretStore: setSecret(${username}) failed: ${e}`);
    return false;
  }
}

/** Remove a secret. No-op when absent or keychain unavailable. */
export function deleteSecret(username: string): Promise<boolean> {
  const logins = getLoginsService();
  const login = findLogin(username);
  if (!logins || !login) return Promise.resolve(false);
  try {
    logins.removeLogin(login);
    return Promise.resolve(true);
  } catch (e) {
    safeDebug(`[z-search] SecretStore: deleteSecret(${username}) failed: ${e}`);
    return Promise.resolve(false);
  }
}

/** True when at least one secret for the realm can be resolved (diagnostics). */
export function hasSecretFor(username: string): boolean {
  return getSecret(username) !== "";
}
