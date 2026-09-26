/**
 * translationEngines — Unified translation engine dispatcher.
 *
 * Supports five engine types:
 *   - "google"  → Google Translate HTTP API (default; free endpoint or Cloud
 *                 Translation; falls back to keyless Bing web on failure)
 *   - "ai"      → Leadero's configured AI model (preserves formula tokens)
 *   - "bing"    → Azure Cognitive Services Translator
 *   - "deepl"   → DeepL API
 *   - "custom"  → OpenAI-compatible chat completions endpoint
 *
 * All engines return the same signature as LeaderoAPI.translate.translateText:
 *   { success: true, translatedText: string } or { success: false, error: string }
 *
 * Formula placeholder preservation ({v0}, {v1}, …) is guaranteed ONLY for the AI
 * engine, because it receives an explicit system prompt. Traditional MT APIs have
 * no prompt mechanism, so callers that need formula safety must stay on "ai".
 */

import { z } from "zod";
import type { IAIProvider, AIRequest, AIResponse } from "../../types/ai";
import type {
  ParagraphTranslator,
  BatchTranslator,
  BatchTranslateResult,
} from "../pdf/translation/translateParagraphs";
import { getPrefDynamic } from "../../utils/prefs";
import { parseJsonFromMarkdown } from "../../utils/json";
import { DEFAULT_TRANSLATE_ENGINE_TYPE } from "../../utils/defaults";
import { toErrorMessage } from "../../utils/error";
import { getString } from "../../utils/locale";

export type TranslationEngineType =
  "ai" | "google" | "bing" | "deepl" | "custom" | "zotero-pdf-translate";

export interface GoogleTranslateOptions {
  apiKey?: string;
}

export interface BingTranslateOptions {
  apiKey: string;
  region: string;
}

export interface DeepLTranslateOptions {
  apiKey: string;
  useFreeEndpoint?: boolean;
}

export interface CustomTranslateOptions {
  apiUrl: string;
  apiKey?: string;
  model?: string;
}

/**
 * Map Zotero locale codes to ISO-639-1 codes used by translation APIs.
 */
function toApiSourceLang(code?: string): string {
  if (!code) return "auto";
  // Zotero uses zh-CN / zh-TW / en-US etc. Strip region for most APIs.
  const base = code.split("-")[0];
  if (base === "zh") return code; // keep zh-CN vs zh-TW distinction
  return base;
}

function toApiTargetLang(code: string): string {
  const base = code.split("-")[0];
  if (code.startsWith("zh")) return code; // keep zh-CN / zh-TW
  if (code.startsWith("pt")) return code; // pt-BR / pt-PT
  return base;
}

/**
 * DeepL-specific target language mapping.
 * DeepL expects uppercase without region for zh-CN (ZH), but keeps zh-TW.
 */
function toDeepLTargetLang(code: string): string {
  if (code === "zh-CN") return "ZH";
  if (code === "zh-TW") return "ZH-TW";
  return toApiTargetLang(code).toUpperCase();
}

/**
 * Timeout used for the keyless HTTP endpoints (Google free endpoint, Bing web).
 * A blocked/unreachable endpoint (e.g. Google in mainland China) must fail fast
 * so the fallback chain can take over instead of hanging on the OS network
 * timeout (~60-120s per paragraph).
 */
const KEYLESS_ENDPOINT_TIMEOUT_MS = 10000;

async function httpPost(
  url: string,
  headers: Record<string, string>,
  body: string,
  timeoutMs?: number,
): Promise<Response> {
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body,
    signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`HTTP ${resp.status}: ${text || resp.statusText}`);
  }
  return resp;
}

async function httpPostForm(
  url: string,
  headers: Record<string, string>,
  body: URLSearchParams,
  timeoutMs?: number,
): Promise<Response> {
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...headers,
    },
    body: body.toString(),
    signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`HTTP ${resp.status}: ${text || resp.statusText}`);
  }
  return resp;
}

async function httpGet(url: string, timeoutMs?: number): Promise<Response> {
  const resp = await fetch(url, {
    signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`HTTP ${resp.status}: ${text || resp.statusText}`);
  }
  return resp;
}

/**
 * Google Translate.
 *
 * If apiKey is provided, uses Cloud Translation API v2:
 *   POST https://translation.googleapis.com/language/translate/v2
 *
 * Otherwise falls back to the undocumented free endpoint:
 *   GET https://translate.googleapis.com/translate_a/single?client=gtx&...
 *
 * The free endpoint has rate limits (~5k chars/day) and may break without notice,
 * but requires zero configuration and is useful as a quick fallback.
 */
async function translateWithGoogle(
  text: string,
  targetLanguage: string,
  sourceLanguage?: string,
  opts: GoogleTranslateOptions = {},
): Promise<{ success: boolean; translatedText?: string; error?: string }> {
  const src = toApiSourceLang(sourceLanguage);
  const tgt = toApiTargetLang(targetLanguage);

  try {
    if (opts.apiKey) {
      // Cloud Translation API v2 (paid, requires API key)
      const body = JSON.stringify({
        q: text,
        source: src === "auto" ? undefined : src,
        target: tgt,
        format: "text",
      });
      const resp = await httpPost(
        `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(opts.apiKey)}`,
        {},
        body,
        KEYLESS_ENDPOINT_TIMEOUT_MS,
      );
      const data = (await resp.json()) as any;
      const translated = data?.data?.translations?.[0]?.translatedText;
      if (!translated)
        throw new Error(getString("translation-error-google-empty"));
      return { success: true, translatedText: translated };
    } else {
      // Free undocumented endpoint (no key required)
      const url =
        `https://translate.googleapis.com/translate_a/single?client=gtx&sl=` +
        encodeURIComponent(src) +
        `&tl=` +
        encodeURIComponent(tgt) +
        `&dt=t&q=` +
        encodeURIComponent(text);
      const resp = await httpGet(url, KEYLESS_ENDPOINT_TIMEOUT_MS);
      const data = (await resp.json()) as any;
      // Response shape: [[["translated","original",...]],null,"srcLang"]
      const sentences = data?.[0] ?? [];
      const translated = sentences.map((s: any) => s?.[0] ?? "").join("");
      if (!translated)
        throw new Error(getString("translation-error-google-empty"));
      return { success: true, translatedText: translated };
    }
  } catch (e: any) {
    return { success: false, error: toErrorMessage(e) };
  }
}

/**
 * Bing / Azure Cognitive Services Translator.
 *
 * Requires apiKey (Azure subscription key) and region (e.g. "global", "eastasia").
 * Docs: https://learn.microsoft.com/en-us/azure/cognitive-services/translator/
 */
async function translateWithBing(
  text: string,
  targetLanguage: string,
  sourceLanguage?: string,
  opts: BingTranslateOptions = { apiKey: "", region: "global" },
): Promise<{ success: boolean; translatedText?: string; error?: string }> {
  const src = toApiSourceLang(sourceLanguage);
  const tgt = toApiTargetLang(targetLanguage);

  try {
    const body = JSON.stringify([{ Text: text }]);
    const url =
      `https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&from=` +
      encodeURIComponent(src === "auto" ? "" : src) +
      `&to=` +
      encodeURIComponent(tgt);
    const resp = await httpPost(
      url,
      {
        "Ocp-Apim-Subscription-Key": opts.apiKey,
        "Ocp-Apim-Subscription-Region": opts.region,
      },
      body,
    );
    const data = (await resp.json()) as any;
    const translated = data?.[0]?.translations?.[0]?.text;
    if (!translated) throw new Error(getString("translation-error-bing-empty"));
    return { success: true, translatedText: translated };
  } catch (e: any) {
    return { success: false, error: toErrorMessage(e) };
  }
}

/**
 * Keyless Bing web translator (the Bing Translator web app endpoint, same
 * engine behind bing.com/translator). Reachable in regions where Google is not
 * (e.g. mainland China), which is why it backs the default Google engine. Not
 * exposed as a selectable engine — it only serves as fallback.
 *
 * Request shape reverse-engineered from the live page (2026-08-29):
 *   GET  https://www.bing.com/translator            (redirects to cn.bing.com in CN)
 *     → _G.IG page token, params_AbusePreventionHelper [key, token, expiryMs],
 *       container data-iid
 *   POST {origin}/ttranslatev3?isVertical=1&IG=…&IID=…&SFX=<counter>
 *        &token=…&key=…                              (auth params in the QUERY STRING)
 *     body: fromLang&to&text (form-urlencoded)
 *     ⚠ fromLang=auto is REJECTED by the endpoint (2026-09-26 live probe:
 *       {"statusCode":400,"errorMessage":""} while the same session's
 *       fromLang=en returns normal translations) — callers without an
 *       explicit source language (the UI's abstract translate sends none)
 *       get a script-based guess via detectBingSourceLang() instead.
 *
 * Cookies are intentionally NOT forwarded manually — in Zotero the fetch goes
 * through the Firefox network stack, which keeps the bing.com cookie jar alive
 * between the token-page GET and the translate POST on its own.
 */

interface BingWebSession {
  origin: string;
  ig: string;
  iid: string;
  key: string;
  token: string;
  expiresAt: number;
  sfx: number;
}

let bingWebSession: BingWebSession | null = null;

/** Drop the cached Bing web session (tests; also correct after long suspend). */
export function resetBingWebSession(): void {
  bingWebSession = null;
}

/** Map Zotero locale codes to Bing web language ids (zh-CN → zh-Hans etc.). */
function toBingWebLang(code: string): string {
  if (!code || code === "auto") return "auto";
  if (code === "zh-CN") return "zh-Hans";
  if (code === "zh-TW" || code === "zh-HK") return "zh-Hant";
  return code.split("-")[0];
}

async function fetchBingWebSession(): Promise<BingWebSession> {
  if (bingWebSession && Date.now() < bingWebSession.expiresAt) {
    return bingWebSession;
  }
  const resp = await httpGet(
    "https://www.bing.com/translator",
    KEYLESS_ENDPOINT_TIMEOUT_MS,
  );
  const html = await resp.text();
  const ig = html.match(/IG:"([A-Fa-f0-9]{16,})"/)?.[1] || "";
  const abuse = html.match(
    /params_AbusePreventionHelper\s*=\s*\[\s*(\d+)\s*,\s*"([^"]+)"\s*,\s*(\d+)\s*\]/,
  );
  const iid =
    html.match(/id="rich_tta"\s+data-iid="(translator\.\d+)"/)?.[1] ||
    "translator.5023";
  if (!ig || !abuse) {
    throw new Error(getString("translation-error-bing-token-unavailable"));
  }
  const [, key, token, expiresMs] = abuse;
  bingWebSession = {
    // www.bing.com redirects to cn.bing.com in CN — POST to the final origin.
    origin: new URL(resp?.url || "https://www.bing.com").origin,
    ig,
    iid,
    key,
    token,
    // Refresh a minute ahead of the server-reported expiry (typically 1h).
    expiresAt: Date.now() + Math.max(60000, Number(expiresMs) - 60000),
    sfx: 0,
  };
  return bingWebSession;
}

async function postBingWebTranslate(
  text: string,
  targetLanguage: string,
  sourceLanguage: string,
  session: BingWebSession,
): Promise<{
  success: boolean;
  translatedText?: string;
  error?: string;
  tokenRejected?: boolean;
}> {
  try {
    // SFX is a per-session request counter on the live page (ei++).
    const sfx = session.sfx++;
    const url =
      `${session.origin}/ttranslatev3?isVertical=1` +
      `&IG=${encodeURIComponent(session.ig)}` +
      `&IID=${encodeURIComponent(session.iid)}` +
      `&SFX=${sfx}` +
      `&token=${encodeURIComponent(session.token)}` +
      `&key=${encodeURIComponent(session.key)}`;
    const body = new URLSearchParams({
      fromLang: toBingWebLang(sourceLanguage),
      to: toBingWebLang(targetLanguage),
      text,
      tryFetchingGenderDebiasedTranslations: "false",
    });
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: `${session.origin}/translator`,
      },
      body: body.toString(),
      signal: AbortSignal.timeout(KEYLESS_ENDPOINT_TIMEOUT_MS),
    });
    if (!resp.ok) {
      return {
        success: false,
        error: `HTTP ${resp.status}: ${resp.statusText}`,
        tokenRejected: resp.status === 401 || resp.status === 403,
      };
    }
    const data = (await resp.json()) as any;
    // Two observed shapes: [{ translations: [...] }] and [[{ translations: [...] }]].
    // Bing rejection (e.g. stale token): { statusCode: 400, errorMessage: "" }.
    const entry = Array.isArray(data?.[0])
      ? data[0].find((x: any) => x?.translations)
      : data?.[0];
    const translated = entry?.translations?.[0]?.text;
    if (!translated) {
      return {
        success: false,
        error:
          typeof data?.errorMessage === "string" && data.errorMessage
            ? getString("translation-error-bing-rejected", {
                args: { status: String(data.statusCode ?? 400) },
              })
            : getString("translation-error-bing-empty"),
        tokenRejected: true,
      };
    }
    return { success: true, translatedText: translated };
  } catch (e: any) {
    return { success: false, error: toErrorMessage(e) };
  }
}

/**
 * Bing ttranslatev3 拒绝 fromLang=auto（2026-09-26 实机对照：auto →
 * {"statusCode":400,"errorMessage":""}，同会话 fromLang=en → 正常译文），
 * 而 UI 摘要翻译不传 sourceLanguage（useLiteratureSearch 只发 {text}）——
 * 兜底路径在打到 Bing 前按文字系做轻量源语言判定。翻译场景的常见文种
 * （中日韩/西里尔/阿拉伯/泰/希伯来）按 Unicode 区段即可高置信区分；
 * 拉丁文种默认 en（翻译模型对源语言的容错远高于被 400 直接拒绝）。
 * 返回 Zotero 风格代码，沿用既有 toBingWebLang 映射（zh-CN → zh-Hans）。
 */
function detectBingSourceLang(text: string): string {
  const sample = String(text ?? "").slice(0, 2000);
  if (/[\uac00-\ud7af]/.test(sample)) return "ko";
  if (/[\u3040-\u30ff]/.test(sample)) return "ja";
  if (/[\u4e00-\u9fff]/.test(sample)) return "zh-CN";
  if (/[\u0400-\u04ff]/.test(sample)) return "ru";
  if (/[\u0600-\u06ff]/.test(sample)) return "ar";
  if (/[\u0e00-\u0e7f]/.test(sample)) return "th";
  if (/[\u0590-\u05ff]/.test(sample)) return "he";
  return "en";
}

async function translateWithBingWeb(
  text: string,
  targetLanguage: string,
  sourceLanguage?: string,
): Promise<{ success: boolean; translatedText?: string; error?: string }> {
  let src = toApiSourceLang(sourceLanguage);
  if (src === "auto") src = detectBingSourceLang(text);
  try {
    let result = await postBingWebTranslate(
      text,
      targetLanguage,
      src,
      await fetchBingWebSession(),
    );
    if (!result.success && result.tokenRejected) {
      // Stale/invalid session — refetch the token page once and retry.
      bingWebSession = null;
      result = await postBingWebTranslate(
        text,
        targetLanguage,
        src,
        await fetchBingWebSession(),
      );
    }
    if (!result.success) {
      return {
        success: false,
        error: result.error || getString("translation-error-bing-failed"),
      };
    }
    return { success: true, translatedText: result.translatedText };
  } catch (e: any) {
    return { success: false, error: toErrorMessage(e) };
  }
}

/**
 * DeepL API.
 *
 * Requires apiKey (Auth Key from DeepL Pro/Free plan).
 * - Free tier: https://api-free.deepl.com/v2/translate
 * - Pro tier:   https://api.deepl.com/v2/translate
 *
 * Docs: https://developers.deepl.com/docs
 */
async function translateWithDeepL(
  text: string,
  targetLanguage: string,
  sourceLanguage?: string,
  opts: DeepLTranslateOptions = { apiKey: "" },
): Promise<{ success: boolean; translatedText?: string; error?: string }> {
  const src = toApiSourceLang(sourceLanguage);
  const tgt = toDeepLTargetLang(targetLanguage);

  try {
    const host = opts.useFreeEndpoint ? "api-free.deepl.com" : "api.deepl.com";
    const params = new URLSearchParams();
    params.set("target_lang", tgt);
    if (src !== "auto")
      params.set("source_lang", toApiTargetLang(src).toUpperCase());
    params.set("text", text);

    const resp = await httpPostForm(
      `https://${host}/v2/translate`,
      { Authorization: `DeepL-Auth-Key ${opts.apiKey}` },
      params,
    );
    const data = (await resp.json()) as any;
    const translated = data?.translations?.[0]?.text;
    if (!translated)
      throw new Error(getString("translation-error-deepl-empty"));
    return { success: true, translatedText: translated };
  } catch (e: any) {
    return { success: false, error: toErrorMessage(e) };
  }
}

/**
 * Custom OpenAI-compatible endpoint.
 *
 * Sends a chat completion request asking the model to translate.
 * Useful for self-hosted models (Ollama, LM Studio, vLLM, etc.)
 * or any OpenAI-compatible API.
 */
async function translateWithCustom(
  text: string,
  targetLanguage: string,
  sourceLanguage?: string,
  opts: CustomTranslateOptions = {
    apiUrl: "",
    apiKey: "",
    model: "gpt-3.5-turbo",
  },
): Promise<{ success: boolean; translatedText?: string; error?: string }> {
  const src = sourceLanguage ? toApiSourceLang(sourceLanguage) : "auto-detect";
  const tgt = targetLanguage;

  try {
    const systemPrompt =
      `You are a professional translator. Translate the following text from ${src} to ${tgt}.\n` +
      `Output ONLY the translated text, no explanations.`;

    const body = JSON.stringify({
      model: opts.model || "gpt-3.5-turbo",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ],
      temperature: 0.3,
      max_tokens: Math.min(text.length * 2, 4000),
    });

    // Ensure URL doesn't end with /v1/chat/completions already
    let baseUrl = opts.apiUrl.replace(/\/+$/, "");
    if (!baseUrl.endsWith("/chat/completions")) {
      baseUrl = baseUrl.replace(/\/v1\/?$/, "") + "/v1/chat/completions";
    }

    const resp = await httpPost(
      baseUrl,
      {
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body,
    );
    const data = (await resp.json()) as any;
    const translated = data?.choices?.[0]?.message?.content;
    if (!translated)
      throw new Error(getString("translation-error-custom-empty"));
    return { success: true, translatedText: translated.trim() };
  } catch (e: any) {
    return { success: false, error: toErrorMessage(e) };
  }
}

/**
 * Zotero PDF Translate plugin bridge.
 *
 * Delegates translation to the external zotero-pdf-translate plugin via its
 * public API: `Zotero.PDFTranslate.api.translate(raw, options)`.
 * The call returns a TranslateTask whose `result` is already populated
 * because the API awaits `runTranslationTask` internally.
 */
async function translateWithZoteroPdfTranslate(
  text: string,
  targetLanguage: string,
  sourceLanguage?: string,
): Promise<{ success: boolean; translatedText?: string; error?: string }> {
  try {
    const api = (Zotero as any)?.PDFTranslate?.api;
    if (!api?.translate) {
      return {
        success: false,
        error: getString("translation-error-pdf-translate-missing"),
      };
    }

    const task = await api.translate(text, {
      pluginID: "zsearch@z-search.dev",
      langfrom: sourceLanguage,
      langto: targetLanguage,
    });

    if (task.status === "success" && task.result) {
      return { success: true, translatedText: task.result };
    }

    return {
      success: false,
      error: task.result || getString("translation-error-pdf-translate-failed"),
    };
  } catch (e: any) {
    return { success: false, error: toErrorMessage(e) };
  }
}

export interface EngineConfig {
  engineType: TranslationEngineType;
  googleApiKey?: string;
  bingApiKey?: string;
  bingRegion?: string;
  deeplApiKey?: string;
  deeplUseFree?: boolean;
  customApiUrl?: string;
  customApiKey?: string;
  customModel?: string;
}

/**
 * Read the current engine config from Zotero dynamic prefs.
 */
export function getEngineConfig(): EngineConfig {
  const get = (key: string, fallback?: string) => {
    const v = getPrefDynamic(key);
    return v !== undefined && v !== null ? String(v) : fallback;
  };

  return {
    engineType:
      (get("translate.engineType") as TranslationEngineType) ||
      DEFAULT_TRANSLATE_ENGINE_TYPE,
    googleApiKey: get("translate.google.apiKey") || undefined,
    bingApiKey: get("translate.bing.apiKey") || undefined,
    bingRegion: get("translate.bing.region") || "global",
    deeplApiKey: get("translate.deepl.apiKey") || undefined,
    deeplUseFree: get("translate.deepl.useFree") === "true",
    customApiUrl: get("translate.custom.apiUrl") || undefined,
    customApiKey: get("translate.custom.apiKey") || undefined,
    customModel: get("translate.custom.model") || "gpt-3.5-turbo",
  };
}

/** In-memory LRU cache for translation results.
 *  Eliminates repeat API calls for the same text + language + engine combo.
 *  Session-scoped (not persisted) — translations are cheap to redo on restart. */
const TRANSLATION_CACHE = new Map<string, string>();
const TRANSLATION_CACHE_MAX = 500;

/** Clear the translation cache (e.g. when engine settings change). */
export function clearTranslationCache(): void {
  TRANSLATION_CACHE.clear();
}

/**
 * Create a ParagraphTranslator based on the current prefs.
 *
 * For "ai" engine, delegates to the existing modelRouter path so all
 * formula-preserving prompts and model assignment remain intact.
 *
 * The returned translator is wrapped with an LRU cache so that repeated
 * translations of the same text (e.g. retry, language toggle) return instantly
 * without an additional API call.
 */
export function createTranslator(
  targetLanguage: string,
  sourceLanguage?: string,
): ParagraphTranslator {
  const cfg = getEngineConfig();
  const inner = createTranslatorUncached(targetLanguage, sourceLanguage);

  return async (text: string, tgt: string, src?: string) => {
    // Only cache texts under 5000 chars to avoid memory bloat from long PDFs.
    if (text.length > 5000) return inner(text, tgt, src);

    // L-23: fold the model + API-key fingerprint into the cache key —
    // switching key/model within the same engine type must not serve the
    // previous configuration's cached translations.
    const credKey =
      cfg.engineType === "google"
        ? cfg.googleApiKey
        : cfg.engineType === "bing"
          ? cfg.bingApiKey
          : cfg.engineType === "deepl"
            ? cfg.deeplApiKey
            : cfg.engineType === "custom"
              ? cfg.customApiKey
              : "";
    // The custom engine's endpoint is part of its configuration identity —
    // the same key/model against a different apiUrl serves a different service.
    const apiUrlKey = cfg.engineType === "custom" ? cfg.customApiUrl || "" : "";
    const key = `${cfg.engineType}:${cfg.customModel || ""}:${(credKey || "").slice(-6)}:${apiUrlKey}:${tgt || targetLanguage}:${src || sourceLanguage || "auto"}:${text}`;
    const cached = TRANSLATION_CACHE.get(key);
    if (cached !== undefined) {
      // LRU refresh: delete + re-insert moves entry to end (most recently used).
      TRANSLATION_CACHE.delete(key);
      TRANSLATION_CACHE.set(key, cached);
      return cached;
    }

    const result = await inner(text, tgt, src);
    if (result) {
      // Evict oldest entry (first in Map iteration order) if at capacity.
      if (TRANSLATION_CACHE.size >= TRANSLATION_CACHE_MAX) {
        const oldest = TRANSLATION_CACHE.keys().next().value;
        if (oldest !== undefined) TRANSLATION_CACHE.delete(oldest);
      }
      TRANSLATION_CACHE.set(key, result);
    }
    return result;
  };
}

function createTranslatorUncached(
  targetLanguage: string,
  sourceLanguage?: string,
): ParagraphTranslator {
  const cfg = getEngineConfig();

  switch (cfg.engineType) {
    case "ai":
      return createAITranslator(targetLanguage, sourceLanguage);
    case "google": {
      const googleOnly = async (text: string) => {
        const result = await translateWithGoogle(
          text,
          targetLanguage,
          sourceLanguage,
          {
            apiKey: cfg.googleApiKey,
          },
        );
        if (!result.success)
          throw new Error(
            result.error || getString("translation-error-google-failed"),
          );
        return result.translatedText!;
      };
      // Default-engine resilience: when Google is unreachable (network block,
      // rate limit, outage) fall back to the keyless Bing web endpoint, which
      // is reachable in regions Google is not. Applies to both the keyless and
      // the keyed Google paths — it only ever fires after Google failed.
      return async (text: string) => {
        try {
          return await googleOnly(text);
        } catch (googleErr) {
          const bing = await translateWithBingWeb(
            text,
            targetLanguage,
            sourceLanguage,
          );
          if (!bing.success) {
            throw new Error(
              getString("translation-error-google-fallback-failed", {
                args: {
                  googleError:
                    googleErr instanceof Error
                      ? googleErr.message
                      : String(googleErr),
                  bingError:
                    bing.error || getString("translation-error-unknown"),
                },
              }),
              { cause: googleErr },
            );
          }
          return bing.translatedText!;
        }
      };
    }
    case "bing":
      return async (text: string) => {
        if (!cfg.bingApiKey)
          throw new Error(getString("translation-error-bing-not-configured"));
        const result = await translateWithBing(
          text,
          targetLanguage,
          sourceLanguage,
          {
            apiKey: cfg.bingApiKey,
            region: cfg.bingRegion || "global",
          },
        );
        if (!result.success)
          throw new Error(
            result.error || getString("translation-error-bing-failed"),
          );
        return result.translatedText!;
      };
    case "deepl":
      return async (text: string) => {
        if (!cfg.deeplApiKey)
          throw new Error(getString("translation-error-deepl-not-configured"));
        const result = await translateWithDeepL(
          text,
          targetLanguage,
          sourceLanguage,
          {
            apiKey: cfg.deeplApiKey,
            useFreeEndpoint: cfg.deeplUseFree,
          },
        );
        if (!result.success)
          throw new Error(
            result.error || getString("translation-error-deepl-failed"),
          );
        return result.translatedText || "";
      };
    case "custom":
      return async (text: string) => {
        if (!cfg.customApiUrl)
          throw new Error(getString("translation-error-custom-url-missing"));
        const result = await translateWithCustom(
          text,
          targetLanguage,
          sourceLanguage,
          {
            apiUrl: cfg.customApiUrl,
            apiKey: cfg.customApiKey,
            model: cfg.customModel,
          },
        );
        if (!result.success)
          throw new Error(
            result.error || getString("translation-error-custom-failed"),
          );
        return result.translatedText || "";
      };
    case "zotero-pdf-translate":
      return async (text: string) => {
        const result = await translateWithZoteroPdfTranslate(
          text,
          targetLanguage,
          sourceLanguage,
        );
        if (!result.success)
          throw new Error(
            result.error || getString("translation-error-pdf-translate-failed"),
          );
        return result.translatedText || "";
      };
    default:
      return createAITranslator(targetLanguage, sourceLanguage);
  }
}

/**
 * AI engine — reuses modelRouter + formula-preserving prompt.
 */
function createAITranslator(
  targetLanguage: string,
  sourceLanguage?: string,
): ParagraphTranslator {
  return async (text: string, _tgt: string, _src?: string) => {
    const { default: modelRouter } = await import("../ai/ModelRouter");
    const { formulaPreservingPrompt } =
      await import("../pdf/translation/translateParagraphs");

    const provider = modelRouter.resolve("translate.reader");
    if (!provider) {
      throw new Error(getString("translation-error-ai-not-configured"));
    }

    const LANG_NAMES: Record<string, string> = {
      "zh-CN": "Simplified Chinese",
      "zh-TW": "Traditional Chinese",
      "en-US": "English",
      "ja-JP": "Japanese",
      "ko-KR": "Korean",
      "fr-FR": "French",
      "de-DE": "German",
      "es-ES": "Spanish",
    };

    const targetDesc = LANG_NAMES[targetLanguage] || targetLanguage;
    const sourceDesc = sourceLanguage
      ? LANG_NAMES[sourceLanguage] || sourceLanguage
      : "auto-detect";
    const systemPrompt = formulaPreservingPrompt(targetDesc, sourceDesc);
    const model = modelRouter.resolveModelId?.("translate.reader") || "";

    const result = await provider.execute({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ],
      model,
      maxTokens: Math.min(text.length * 2, 4000),
    });

    if (!result || !result.content) {
      throw new Error(getString("translation-error-ai-empty"));
    }
    return result.content;
  };
}

/**
 * Zod schema for the batch translation response. `generateObject` uses this to
 * enforce structured output on providers that support it (OpenAI), and to
 * validate + extract JSON on the prompt-fallback path (all other providers).
 *
 * A bare string array (not `{id, translation}` objects) keeps the schema simple
 * and reduces the model error surface — alignment is positional, so array order
 * is the source of truth.
 */
const BatchTranslationSchema = z.object({
  translations: z.array(z.string()),
});

/**
 * Handle returned by createAIBatchTranslator — carries the batch translator
 * plus the token-budget parameters the orchestrator needs for chunking.
 */
export interface BatchTranslatorHandle {
  translate: BatchTranslator;
  /** Max input chars per chunk (from contextWindow − system − output reserve). */
  inputBudgetChars: number;
  /** Max estimated output chars per chunk (from maxOutputTokens). */
  outputBudgetChars: number;
}

/**
 * Whether the currently configured engine benefits from batch translation.
 * Only the AI engine does — it reuses generateObject for structured JSON output.
 * Traditional MT APIs (Google/Bing/DeepL) are stateless and accept single text,
 * so per-paragraph dispatch stays appropriate for them.
 */
export function supportsBatching(): boolean {
  return getEngineConfig().engineType === "ai";
}

/**
 * System prompt for batch JSON translation. Instructs the model to output a
 * JSON object with a "translations" string array, preserving formulas and
 * {vn} tokens.
 */
function batchJsonPrompt(targetDesc: string, sourceDesc: string): string {
  return (
    `You are a professional translator. Translate from ${sourceDesc} to ${targetDesc}.\n\n` +
    `You will receive a JSON object: {"segments": ["text1", "text2", ...]}.\n` +
    `Translate each segment and output a JSON object: {"translations": ["translation1", "translation2", ...]}.\n\n` +
    `CRITICAL RULES:\n` +
    `1. The output array MUST contain EXACTLY the same number of elements as the input, in the same order.\n` +
    `2. Do NOT merge, split, add, skip, or reorder segments.\n` +
    `3. Preserve EVERY formula in $...$ or $$...$$ EXACTLY as-is. Never translate or modify content inside dollar signs.\n` +
    `4. Preserve tokens like {v0}, {v1} verbatim.\n` +
    `5. Output ONLY valid JSON, no markdown, no explanations.`
  );
}

/**
 * Replace empty-string translations with their originals and flag them as
 * failed. Prevents silent content loss when the model returns "" for a
 * non-empty input (e.g., it ran out of output budget mid-array and padded
 * the tail with empty strings).
 */
function sanitizeTranslations(
  translations: string[],
  originals: string[],
): BatchTranslateResult {
  const failedIndices: number[] = [];
  const out = translations.map((t, i) => {
    if (!t && originals[i].trim()) {
      failedIndices.push(i);
      return originals[i];
    }
    return t;
  });
  return { translations: out, failedIndices };
}

/** Sentinel message for user-initiated cancellation. */
const CANCELLED = "translation_cancelled";

function isCancelled(e: unknown): boolean {
  return e instanceof Error && e.message === CANCELLED;
}

/**
 * Race a promise against an optional abort signal and optional total timeout.
 * Used for generateObject (which has no streaming → no idleness detection).
 */
function raceAbort<T>(
  work: Promise<T>,
  signal?: AbortSignal,
  timeoutMs?: number,
): Promise<T> {
  if (signal?.aborted) return Promise.reject(new Error(CANCELLED));

  const racers: Promise<unknown>[] = [work];
  let timer: ReturnType<typeof setTimeout> | undefined;

  if (signal) {
    racers.push(
      new Promise<never>((_, reject) =>
        signal.addEventListener("abort", () => reject(new Error(CANCELLED)), {
          once: true,
        }),
      ),
    );
  }
  if (timeoutMs) {
    racers.push(
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      }),
    );
  }

  if (racers.length === 1) return work;
  for (const r of racers) r.catch(() => {});
  return Promise.race(racers).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

/**
 * Execute a provider call with an idleness-based timeout. The idle timer
 * resets on every onStream event (token arrival), so it ONLY fires when the
 * model truly stops producing output — not when a large batch legitimately
 * takes minutes to stream.
 *
 * For OpenAI/Anthropic: onStream fires per-token → true idleness detection.
 * For Google/custom: onStream fires once at the end → idle timer degrades to
 * a generous total timeout (acceptable since most calls complete < idleMs).
 *
 * Also races against the external abort signal for cooperative cancellation.
 */
async function executeWithIdleTimeout(
  provider: IAIProvider,
  request: AIRequest,
  idleMs: number,
  signal?: AbortSignal,
): Promise<AIResponse> {
  if (signal?.aborted) throw new Error(CANCELLED);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const idleP = new Promise<never>((_, reject) => {
    const arm = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(
        () =>
          reject(
            new Error(
              `idle timeout — no tokens for ${Math.round(idleMs / 1000)}s`,
            ),
          ),
        idleMs,
      );
    };
    arm();
    // Wrap onStream: each token event resets the idle timer.
    const prev = request.onStream;
    request.onStream = (ev: any) => {
      arm();
      prev?.(ev);
    };
  });

  const racers: Promise<unknown>[] = [provider.execute(request), idleP];
  if (signal) {
    racers.push(
      new Promise<never>((_, reject) => {
        if (signal.aborted) return reject(new Error(CANCELLED));
        signal.addEventListener("abort", () => reject(new Error(CANCELLED)), {
          once: true,
        });
      }),
    );
  }
  for (const r of racers) r.catch(() => {});

  try {
    return (await Promise.race(racers)) as AIResponse;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Create an AI-powered batch translator that packs multiple paragraphs into a
 * single LLM call via generateObject (structured JSON output).
 *
 * The returned translator NEVER throws — on any failure it degrades:
 *   1. generateObject with BatchTranslationSchema (native structured output or
 *      prompt+parse fallback, one retry)
 *   2. provider.execute + parseJsonFromMarkdown (manual JSON, one retry)
 *   3. Per-paragraph execute (the original single-paragraph path)
 *   4. Original text preserved (marked as failed)
 *
 * At every level the result always contains exactly `texts.length` strings.
 *
 * Also computes the token-budget parameters (inputBudgetChars,
 * outputBudgetChars) from the resolved provider's contextWindow and
 * maxOutputTokens, so the orchestrator can size chunks correctly.
 *
 * @throws if no AI model is configured for the "translation" feature.
 */
export async function createAIBatchTranslator(
  targetLanguage: string,
  sourceLanguage?: string,
): Promise<BatchTranslatorHandle> {
  const { default: modelRouter } = await import("../ai/ModelRouter");
  const { default: tokenBudgetEstimator } =
    await import("../agent/TokenBudgetEstimator");

  const provider = modelRouter.resolve("translate.reader");
  if (!provider) {
    throw new Error(getString("translation-error-ai-not-configured"));
  }
  const model = modelRouter.resolveModelId("translate.reader") || "";

  // ── Language descriptors ──
  const LANG_NAMES: Record<string, string> = {
    "zh-CN": "Simplified Chinese",
    "zh-TW": "Traditional Chinese",
    "en-US": "English",
    "ja-JP": "Japanese",
    "ko-KR": "Korean",
    "fr-FR": "French",
    "de-DE": "German",
    "es-ES": "Spanish",
  };
  const targetDesc = LANG_NAMES[targetLanguage] || targetLanguage;
  const sourceDesc = sourceLanguage
    ? LANG_NAMES[sourceLanguage] || sourceLanguage
    : "auto-detect";

  // ── Token budgets ──
  // Two hard constraints: contextWindow (input + output must fit) and
  // maxOutputTokens (output cap). Output is usually the tighter bottleneck.
  // `||` (not `??`) on both: a 0 return means "unknown", not "zero".
  const contextWindow = provider.getContextWindow?.() || 128000;
  const maxOutput = provider.getMaxOutputTokens?.() || 4096;
  const charsPerToken = tokenBudgetEstimator.getCharsPerToken();
  const SYSTEM_RESERVE_TOKENS = 600; // batch prompt + JSON wrapper overhead
  const SAFETY_MARGIN = 0.15; // 15% for estimation error + delimiter overhead

  const outputBudgetTokens = Math.floor(maxOutput * (1 - SAFETY_MARGIN));
  const outputBudgetChars = Math.max(
    1000,
    Math.floor(outputBudgetTokens * charsPerToken),
  );
  const inputBudgetTokens = Math.max(
    1000,
    contextWindow - SYSTEM_RESERVE_TOKENS - maxOutput,
  );
  const inputBudgetChars = Math.max(
    1000,
    Math.floor(inputBudgetTokens * charsPerToken),
  );

  const prompt = batchJsonPrompt(targetDesc, sourceDesc);
  const singlePrompt =
    `You are a professional translator. Translate from ${sourceDesc} to ${targetDesc}.\n` +
    `Output ONLY the translated text, no explanations.\n` +
    `Preserve formulas in $...$ or $$...$$ and tokens like {v0}, {v1} verbatim.`;

  // ── Timeouts ──
  // generateObject has no streaming → generous total timeout only.
  // execute() with onStream → idle timeout that resets per-token.
  const TOTAL_TIMEOUT_GENOBJ_MS = 180000; // 3 min
  const IDLE_TIMEOUT_BATCH_MS = 120000; // 2 min idle for batch calls
  const IDLE_TIMEOUT_SINGLE_MS = 60000; // 1 min idle for single-paragraph

  // ── Batch translator (multi-level fallback; throws CANCELLED on abort) ──
  const translate: BatchTranslator = async (
    texts: string[],
    signal?: AbortSignal,
  ): Promise<BatchTranslateResult> => {
    const inputJson = JSON.stringify({ segments: texts });

    // Level 1: generateObject (native structured output or prompt+parse).
    // No streaming → no idleness detection → use generous total timeout.
    if (typeof provider.generateObject === "function") {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (signal?.aborted) throw new Error(CANCELLED);
        try {
          const result = (await raceAbort(
            provider.generateObject(
              {
                messages: [
                  { role: "system", content: prompt },
                  { role: "user", content: inputJson },
                ],
                model,
                maxTokens: maxOutput,
                temperature: 0.1,
                feature: "translation",
              },
              BatchTranslationSchema,
            ),
            signal,
            TOTAL_TIMEOUT_GENOBJ_MS,
          )) as {
            object: { translations: string[] };
            usage?: { promptTokens?: number };
          };
          const out = result.object.translations;
          if (out.length === texts.length) {
            if (result.usage?.promptTokens) {
              tokenBudgetEstimator.calibrate(
                inputJson.length,
                result.usage.promptTokens,
              );
            }
            return sanitizeTranslations(out, texts);
          }
          // Count mismatch — retry.
        } catch (e) {
          if (isCancelled(e)) throw e;
          // generateObject threw (parse/validation failure / timeout) — retry.
        }
        if (attempt === 0) await new Promise((r) => setTimeout(r, 500));
      }
    }

    // Level 2: execute with idle-timeout + JSON parse. The onStream callback
    // triggers streaming for OpenAI/Anthropic, giving per-token idleness
    // detection. For other providers it fires once at the end (idle timer
    // acts as a generous total timeout).
    for (let attempt = 0; attempt < 2; attempt++) {
      if (signal?.aborted) throw new Error(CANCELLED);
      try {
        const result = await executeWithIdleTimeout(
          provider,
          {
            messages: [
              { role: "system", content: prompt },
              { role: "user", content: inputJson },
            ],
            model,
            maxTokens: maxOutput,
            temperature: 0.1,
            feature: "translation",
            onStream: () => {}, // presence triggers streaming for OpenAI/Anthropic
          },
          IDLE_TIMEOUT_BATCH_MS,
          signal,
        );
        if (result?.usage?.promptTokens) {
          tokenBudgetEstimator.calibrate(
            inputJson.length,
            result.usage.promptTokens,
          );
        }
        const parsed = parseJsonFromMarkdown(result?.content ?? "");
        const arr = Array.isArray(parsed) ? parsed : parsed?.translations;
        if (Array.isArray(arr) && arr.length === texts.length) {
          const translations = arr.map((x: any) =>
            typeof x === "string" ? x : (x?.translation ?? x?.text ?? ""),
          );
          return sanitizeTranslations(translations, texts);
        }
      } catch (e) {
        if (isCancelled(e)) throw e;
        // idle timeout or error — retry
      }
      if (attempt === 0) await new Promise((r) => setTimeout(r, 500));
    }

    // Level 3: per-paragraph fallback with idle timeout.
    const translations: string[] = [];
    const failedIndices: number[] = [];
    for (let i = 0; i < texts.length; i++) {
      if (signal?.aborted) throw new Error(CANCELLED);
      try {
        const result = await executeWithIdleTimeout(
          provider,
          {
            messages: [
              { role: "system", content: singlePrompt },
              { role: "user", content: texts[i] },
            ],
            model,
            maxTokens: Math.min(texts[i].length * 2, 4000),
            temperature: 0.1,
            feature: "translation",
            onStream: () => {},
          },
          IDLE_TIMEOUT_SINGLE_MS,
          signal,
        );
        const content = result?.content || "";
        translations.push(content || texts[i]);
        if (!content && texts[i].trim()) failedIndices.push(i);
      } catch (e) {
        if (isCancelled(e)) throw e;
        translations.push(texts[i]);
        failedIndices.push(i);
      }
    }
    return { translations, failedIndices };
  };

  return { translate, inputBudgetChars, outputBudgetChars };
}
