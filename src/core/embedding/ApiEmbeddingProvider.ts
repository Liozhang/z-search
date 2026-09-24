/**
 * ApiEmbeddingProvider — remote embedding via OpenAI-compatible /v1/embeddings.
 *
 * Mirrors how LLM/Agent providers work: credentials + endpoint resolved
 * per-call from ConfigManager feature config (`ai.selection.embedding`).
 * Works with any OpenAI-compatible endpoint: OpenAI, vLLM, Ollama, SiliconFlow,
 * LM Studio, etc. (any provider with `adapter: "openai"`).
 *
 * Opt-in (NOT the default): the default embedding path is local ONNX
 * (LocalEmbeddingProvider). This provider activates only when the user
 * explicitly selects `embedding.mode === "api"`.
 *
 * @module core/embedding/ApiEmbeddingProvider
 */

import type { EmbeddingProvider, EmbedMode } from "./EmbeddingProvider";
import { requiresE5Prefix, API_MODEL_DIMENSIONS } from "./EmbeddingProvider";
import { ZoteroFetch } from "../ai/ZoteroFetch";
import { toErrorMessage } from "../../utils/error";
import { safeDebug } from "../../utils/logger";

class ApiEmbeddingProvider implements EmbeddingProvider {
  readonly isLocal = false;

  /** Lazily-created ZoteroFetch instance (reused across calls). */
  private zoteroFetch = new ZoteroFetch();

  /**
   * The configured API embedding model's ConfigManager id (e.g.
   * "openai-text-embedding-3-small"). Falls back to "" when unconfigured —
   * callers check isReady() before embed().
   */
  get name(): string {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- 同步 shim：esbuild 内联 require 防环形依赖；此上下文无法 await import
      const ConfigManager = require("../../utils/config/ConfigManager").default;
      return ConfigManager.getModelForFeature("embedding") || "";
    } catch (e) {
      safeDebug("[z-search] ApiEmbeddingProvider: " + e);
      return "";
    }
  }

  /**
   * Best-known output dimension for the configured model. 0 = unknown (the
   * actual dimension is discovered at runtime; EmbeddingStore keys by model
   * name, not dimension, so 0 does not affect correctness).
   */
  get dimension(): number {
    const modelId = this.name;
    if (!modelId) return 0;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- 同步 shim：esbuild 内联 require 防环形依赖；此上下文无法 await import
      const ConfigManager = require("../../utils/config/ConfigManager").default;
      const config = ConfigManager.getModelFullConfig(modelId);
      const apiModelId = config?.model?.modelId || modelId;
      return API_MODEL_DIMENSIONS[apiModelId] ?? 0;
    } catch (e) {
      safeDebug("[z-search] ApiEmbeddingProvider: " + e);
      return 0;
    }
  }

  isReady(): boolean {
    const modelId = this.name;
    if (!modelId) return false;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- 同步 shim：esbuild 内联 require 防环形依赖；此上下文无法 await import
      const ConfigManager = require("../../utils/config/ConfigManager").default;
      const config = ConfigManager.getModelFullConfig(modelId);
      if (!config?.provider) return false;
      // Only OpenAI-compatible providers expose /v1/embeddings
      if (config.provider.adapter !== "openai") return false;
      return !!config.provider.apiKey;
    } catch (e) {
      safeDebug("[z-search] ApiEmbeddingProvider: " + e);
      return false;
    }
  }

  /**
   * Shared credential/model resolution for embed() and embedBatch().
   * Throws the same actionable errors as the original inline checks in embed().
   */
  private resolveConfig(): {
    apiKey: string;
    baseURL: string | undefined;
    apiModelId: string;
  } {
    const modelId = this.name;
    if (!modelId) {
      throw new Error(
        "No API embedding model configured. Assign a model to the embedding feature in Settings → AI Models.",
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports -- 同步 shim：esbuild 内联 require 防环形依赖；此上下文无法 await import
    const ConfigManager = require("../../utils/config/ConfigManager").default;
    const config = ConfigManager.getModelFullConfig(modelId);
    if (!config?.provider) {
      throw new Error(`Unknown embedding model config: ${modelId}`);
    }
    if (config.provider.adapter !== "openai") {
      throw new Error(
        `Embedding requires an OpenAI-compatible provider (OpenAI/vLLM/Ollama). ` +
          `Model "${modelId}" uses adapter "${config.provider.adapter}".`,
      );
    }

    const apiKey = config.provider.apiKey;
    if (!apiKey) {
      throw new Error(
        `Embedding provider "${config.provider.name}" has no API key configured.`,
      );
    }

    return {
      apiKey,
      baseURL: config.provider.baseUrl || undefined,
      apiModelId: config.model?.modelId || modelId,
    };
  }

  private createSdkProvider(apiKey: string, baseURL: string | undefined) {
    const fetchFn = this.zoteroFetch.fetch.bind(this.zoteroFetch) as (
      input: string | URL | Request,
      init?: RequestInit,
    ) => Promise<Response>;

    // Dynamic import keeps the SDK off the critical path for local-mode users.
    return import("@ai-sdk/openai").then(({ createOpenAI }) =>
      createOpenAI({ apiKey, baseURL, fetch: fetchFn }),
    );
  }

  private applyPrefix(
    text: string,
    apiModelId: string,
    mode: EmbedMode,
  ): string {
    // E5/BGE models need "query: " / "passage: " prefixes; symmetric models
    // (text-embedding-3-*, ada-002) ignore the prefix.
    return requiresE5Prefix(apiModelId)
      ? `${mode === "query" ? "query: " : "passage: "}${text}`
      : text;
  }

  async embed(text: string, mode: EmbedMode = "passage"): Promise<number[]> {
    const { apiKey, baseURL, apiModelId } = this.resolveConfig();
    const prefixedText = this.applyPrefix(text, apiModelId, mode);

    try {
      const embeddingProvider = await this.createSdkProvider(apiKey, baseURL);
      const { embed } = await import("ai");

      const { embedding } = await embed({
        model: embeddingProvider(apiModelId) as any,
        value: prefixedText,
        // SDK default (2) made explicit: embedding path has no RequestQueue
        // wrapper, so SDK-level exponential backoff + retry-after is the
        // only retry this path gets.
        maxRetries: 2,
      });

      // Record estimated token usage (fire-and-forget)
      try {
        const { default: TokenUsageStore } =
          await import("../ai/TokenUsageStore");
        const estimatedTokens = Math.ceil(text.length / 4);
        TokenUsageStore.record({
          feature: "embedding",
          modelId: apiModelId,
          promptTokens: estimatedTokens,
          completionTokens: 0,
          totalTokens: estimatedTokens,
          isEstimated: true,
        });
      } catch (e) {
        safeDebug("[z-search] ApiEmbeddingProvider: " + e);
        /* non-critical */
      }

      return embedding;
    } catch (e: any) {
      throw new Error(
        `API embedding failed for model "${apiModelId}" at ${baseURL || "default endpoint"}: ${toErrorMessage(e)}`,
        { cause: e },
      );
    }
  }

  /**
   * Batch embedding via the SDK's embedMany — one HTTP request for all texts
   * on OpenAI-compatible endpoints (vs N round-trips from the sequential
   * embed() loop). Real usage tokens are recorded instead of per-text estimates.
   */
  async embedBatch(
    texts: string[],
    mode: EmbedMode = "passage",
  ): Promise<number[][]> {
    if (texts.length === 0) return [];

    const { apiKey, baseURL, apiModelId } = this.resolveConfig();
    const prefixedTexts = texts.map((t) =>
      this.applyPrefix(t, apiModelId, mode),
    );

    try {
      const embeddingProvider = await this.createSdkProvider(apiKey, baseURL);
      const { embedMany } = await import("ai");

      const { embeddings, usage } = await embedMany({
        model: embeddingProvider(apiModelId) as any,
        values: prefixedTexts,
        // Same explicit-retry rationale as embed() above.
        maxRetries: 2,
      });

      // Record REAL batched token usage (fire-and-forget) — embedMany returns
      // the provider-reported input token count for the whole request.
      try {
        const { default: TokenUsageStore } =
          await import("../ai/TokenUsageStore");
        TokenUsageStore.record({
          feature: "embedding",
          modelId: apiModelId,
          promptTokens: usage.tokens,
          completionTokens: 0,
          totalTokens: usage.tokens,
        });
      } catch (e) {
        safeDebug("[z-search] ApiEmbeddingProvider: " + e);
        /* non-critical */
      }

      return embeddings.map((e) => Array.from(e));
    } catch (e: any) {
      throw new Error(
        `API embedding batch failed for model "${apiModelId}" at ${baseURL || "default endpoint"}: ${toErrorMessage(e)}`,
        { cause: e },
      );
    }
  }
}

export default new ApiEmbeddingProvider();
