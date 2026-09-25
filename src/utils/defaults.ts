/**
 * Named preference-default constants.
 *
 * 2026-09-25 审计 P2-6 清理：原文件的 DEFAULT_PREFS 全量映射（约百键，
 * 大半是 leadero 遗留的 chat/agent/mcp/a2a/brain 等未落地功能）既无运行时
 * 消费方，宣称的 prefs.js 一致性对拍测试也不存在——"single source of
 * truth" 的头注是不成立的声明。删除映射，只保留真实被消费的命名常量
 * （decision 域与 PDF/embedding 常量的消费方见各自 import）。
 */

// ==================== Named constants ====================

/** Default local embedding model (384-dim, bilingual ZH+EN, CPU-friendly). */
export const DEFAULT_EMBEDDING_LOCAL_MODEL = "Xenova/multilingual-e5-small";

/** Default translation engine. "google" works keyless out of the box (free
 *  endpoint, with a keyless Bing web fallback when Google is unreachable);
 *  "ai" delegates to the modelRouter feature path and needs explicit model
 *  configuration, so it is a user choice, not the default. */
export const DEFAULT_TRANSLATE_ENGINE_TYPE = "google";

/** Default PDF parser backend (primary engine; fallback chain handled at runtime). */
export const DEFAULT_PDF_PARSER_BACKEND = "opendataloader";

/** Default embedding mode ("local"; ONNX multilingual-e5-small is zero-config
 *  out of the box — first use auto-downloads the model, mirroring the ODL
 *  JRE download flow. API mode is opt-in for users who prefer their provider/key.) */
export const DEFAULT_EMBEDDING_MODE = "local";

/** Decision model (System 1 / JEV-class via the OpenRouter Decisions API).
 *  Off by default: decision states carry library/user content to a remote
 *  endpoint, so this is strictly opt-in. The model slug is pinned (not the
 *  ~latest alias) — screening verdicts must not drift silently with upstream
 *  redirects. */
export const DEFAULT_DECISION_MODE = "off";
export const DEFAULT_DECISION_MODEL = "typesafe/jev-1.13";
/** Screening triage bands: p >= include keeps the paper without the LLM
 *  evaluation, p <= exclude drops it, the band between goes to the existing
 *  LLM evaluation (ensemble structure). */
export const DEFAULT_DECISION_SCREEN_INCLUDE = 0.8;
export const DEFAULT_DECISION_SCREEN_EXCLUDE = 0.2;
/** Empty = per-mode default: OpenRouter Decisions endpoint for
 *  decision.mode "openrouter", the local shim for "local". Override enables
 *  mirrors (openrouter mode) or a shim on another host/port (local mode). */
export const DEFAULT_DECISION_ENDPOINT = "";
/** Decision-bearer override: a TypeSafe-direct key (api.typesafe.ai) is not an
 *  OpenRouter key, so it cannot ride the provider keychain entry. Empty =
 *  openrouter mode falls back to the OpenRouter provider key; local mode
 *  never sends auth. Plain-pref storage follows the translate.custom.apiKey
 *  precedent (comparable-risk single-purpose key). */
export const DEFAULT_DECISION_API_KEY = "";
export const DEFAULT_DECISION_LOCAL_ENDPOINT =
  "http://127.0.0.1:8902/api/alpha/decisions";

/** Default web search provider (keyless fallback — works without API keys). */
export const DEFAULT_SEARCH_PROVIDER = "duckduckgo";
