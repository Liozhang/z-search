/**
 * Shared error-message mapping — single source of truth for translating raw
 * backend/provider error strings into localized, actionable Fluent keys.
 *
 * Two environments need this mapping:
 *  - React (src/react/utils/locale.ts friendlyErrorMessage) — iframe locale
 *    cache getString
 *  - Host bridge (src/bridge/handlers/sendMessage.ts) — host getString, used
 *    when PERSISTING the error message that the chat actually renders
 *
 * The mapping itself is pure data so both sides stay in lockstep; string
 * resolution is injected per-environment. A raw error the table cannot
 * classify maps to "" (callers fall back to chat-error-with-detail /
 * chat-error-generic with the truncated original text — real errors keep
 * propagating, never masked).
 */

/** One classification rule: lowercase-substring patterns → Fluent key. */
interface ErrorRule {
  patterns: string[];
  key: string;
}

/**
 * Rules evaluated in order; first match wins.
 *
 * Config-gap rules come FIRST: "No AI provider configured" and the stale
 * model variant are actionable (go assign a model), unlike transport errors,
 * and must not be shadowed by generic network/auth patterns.
 */
const RULES: readonly ErrorRule[] = [
  {
    // AgentExecutionLoop throws this when nothing is assigned to the feature.
    patterns: ["no ai provider configured"],
    key: "chat-error-no-provider",
  },
  {
    // AgentEngine throws this when a feature points at a model whose
    // provider cannot be resolved (deleted model/provider, missing key).
    patterns: ["no provider could be resolved"],
    key: "chat-error-no-provider",
  },
  {
    // Host-side translator guard (translationEngines.createAITranslator).
    // The engine emits FTL strings now, so every locale needs its pattern —
    // matching only the zh-CN wording silently fell through to the generic case.
    patterns: ["翻译未配置", "翻譯未設定", "no ai provider configured"],
    key: "chat-error-no-provider",
  },
  {
    patterns: [
      "unauthorized",
      "invalid api key",
      "invalid x-api-key",
      "authentication",
    ],
    key: "chat-error-auth",
  },
  { patterns: ["forbidden"], key: "chat-error-forbidden" },
  {
    patterns: ["rate limit", "too many requests", "quota"],
    key: "chat-error-rate-limit",
  },
  { patterns: ["internal server error"], key: "chat-error-server" },
  {
    patterns: ["service unavailable", "bad gateway"],
    key: "chat-error-unavailable",
  },
  {
    patterns: ["context_length_exceeded", "token limit", "too many tokens"],
    key: "chat-error-token-limit",
  },
  {
    patterns: ["network", "fetch", "econnrefused", "timeout"],
    key: "chat-error-network",
  },
  { patterns: ["abort", "cancel"], key: "chat-error-cancelled" },
];

/** HTTP 状态码 → Fluent key 直查表；未分类返回 ""（调用方回退原文案）。 */
const HTTP_STATUS_KEYS: Readonly<Record<number, string>> = {
  401: "chat-error-auth",
  403: "chat-error-forbidden",
  429: "chat-error-rate-limit",
  500: "chat-error-server",
  502: "chat-error-unavailable",
  503: "chat-error-unavailable",
};

export function httpStatusErrorKey(status: number): string {
  return HTTP_STATUS_KEYS[status] ?? "";
}

/** Regex-based rules that need more than substring matching. */
const REGEX_RULES: readonly { re: RegExp; key: string }[] = [
  { re: /max[_ ]?token/, key: "chat-error-token-limit" },
];

/**
 * Classify a raw error string to a Fluent key. Returns "" when unclassified
 * (caller falls back to the detail/generic message with the original text).
 */
export function friendlyErrorKey(rawError: string): string {
  if (!rawError) return "chat-error-generic";
  const msg = rawError.toLowerCase();
  const code = parseInt(rawError, 10);
  if (!Number.isNaN(code)) {
    const byStatus = httpStatusErrorKey(code);
    if (byStatus) return byStatus;
  }
  for (const rule of RULES) {
    if (rule.patterns.some((p) => msg.includes(p))) return rule.key;
  }
  for (const rule of REGEX_RULES) {
    if (rule.re.test(msg)) return rule.key;
  }
  return "";
}
