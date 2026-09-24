/**
 * EmbeddingsManager - Vector embeddings for semantic search
 *
 * Routes between API and local embedding providers based on `embedding.mode`:
 *   "local" → LocalEmbeddingProvider (ONNX/transformers.js, DEFAULT — zero-config,
 *             first use auto-downloads multilingual-e5-small)
 *   "api"   → ApiEmbeddingProvider (OpenAI-compatible /v1/embeddings, opt-in)
 *
 * @module core/ai/EmbeddingsManager
 */

import AICache from "../cache/AICache";
import EmbeddingStore from "../search/EmbeddingStore";

import { cosineSimilarity } from "ai";
import { getPrefDynamic } from "../../utils/prefs";
import { getString } from "../../utils/locale";
import {
  LOCAL_MODEL_DIMENSIONS,
  DEFAULT_LOCAL_MODEL,
} from "../embedding/EmbeddingProvider";
import type { EmbedMode } from "../embedding/EmbeddingProvider";
import { safeDebug } from "../../utils/logger";

export interface EmbeddingResult {
  embedding: number[];
  model: string;
  dimension: number;
}

export interface SimilarItem {
  itemID: number;
  similarity: number;
}

/**
 * Embeddings Manager
 * Handles text vectorization and similarity-based search via API or local providers.
 */
export class EmbeddingsManager {
  private cache = AICache;

  /**
   * Generate embedding for text. Checks cache first before calling ONNX inference.
   *
   * @param text - The text to embed
   * @param mode - 'query' for search queries, 'passage' for documents/indexing.
   *               E5 models prepend different prefixes per mode. Default 'passage'.
   * @returns The embedding vector
   */
  async embedText(
    text: string,
    mode: EmbedMode = "passage",
  ): Promise<number[]> {
    // Surface an unconfigured API embedding model with a localized, actionable
    // error before any provider/cache work. Otherwise the failure either leaks
    // out as a non-localized provider message or — for callers that only read
    // getModelInfo() — silently operates on an empty model key (garbage).
    this.requireEmbeddingModelId();
    const provider = await this.resolveProvider();
    // Cache with a model+mode-scoped key so different models (and query vs
    // passage for E5) don't collide, and identical texts aren't re-inferred.
    const cacheKey = this.getCacheKey(text, provider.name, mode);
    const cached = await this.cache.get<{ embedding?: number[] }>(cacheKey);
    if (cached?.embedding) {
      return cached.embedding;
    }
    const embedding = await provider.embed(text, mode);
    await this.cache.set(cacheKey, {
      embedding,
      model: provider.name,
      dimension: embedding.length,
      timestamp: Date.now(),
    });
    return embedding;
  }

  /**
   * Convenience wrapper for query-mode embedding (E5 "query: " prefix).
   * Use for search queries / user questions; use embedText() for documents.
   */
  async embedQuery(text: string): Promise<number[]> {
    return this.embedText(text, "query");
  }

  /**
   * Generate embeddings for multiple texts, cache-aware.
   *
   * Cache hits are served locally; only misses reach the provider. API mode
   * batches all misses into a single embedMany HTTP request (provider
   * embedBatch); local mode falls back to the sequential embedText loop —
   * ONNX inference is CPU-bound and LocalEmbeddingProvider's first call
   * lazily loads the pipeline, which is NOT concurrency-safe.
   *
   * @param texts - Array of texts to embed
   * @returns Array of embedding vectors, same order as input
   */
  async embedBatch(
    texts: string[],
    mode: EmbedMode = "passage",
  ): Promise<number[][]> {
    if (texts.length === 0) return [];

    const provider = await this.resolveProvider();

    const results: number[][] = new Array(texts.length);
    const missIndices: number[] = [];

    for (let i = 0; i < texts.length; i++) {
      const cached = await this.cache.get<{ embedding?: number[] }>(
        this.getCacheKey(texts[i], provider.name, mode),
      );
      if (cached?.embedding) {
        results[i] = cached.embedding;
      } else {
        missIndices.push(i);
      }
    }

    if (missIndices.length === 0) return results;

    if (provider.embedBatch) {
      // API mode: one embedMany HTTP call for all cache misses.
      const missEmbeddings = await provider.embedBatch(
        missIndices.map((i) => texts[i]),
        mode,
      );
      for (let j = 0; j < missIndices.length; j++) {
        const idx = missIndices[j];
        const embedding = missEmbeddings[j];
        results[idx] = embedding;
        // Same cache contract as embedText (model+mode-scoped key).
        await this.cache.set(
          this.getCacheKey(texts[idx], provider.name, mode),
          {
            embedding,
            model: provider.name,
            dimension: embedding.length,
            timestamp: Date.now(),
          },
        );
      }
      return results;
    }

    // Local mode fallback: sequential embedText over misses only.
    for (const idx of missIndices) {
      results[idx] = await this.embedText(texts[idx], mode);
    }
    return results;
  }

  /**
   * Find similar items by embedding similarity
   */
  async findSimilarItems(
    query: string,
    itemIDs: number[],
    threshold = 0.75,
    topK = 5,
  ): Promise<SimilarItem[]> {
    const queryEmbedding = await this.embedQuery(query);
    const modelInfo = this.getModelInfo();

    const allEmbeddings = await EmbeddingStore.getEmbeddingsForItems(
      itemIDs,
      modelInfo.name,
    );

    const results: SimilarItem[] = [];
    for (const entry of allEmbeddings) {
      const similarity = cosineSimilarity(
        Array.from(queryEmbedding),
        Array.from(entry.embedding),
      );
      if (similarity >= threshold) {
        results.push({ itemID: entry.itemId, similarity });
      }
    }

    return results.sort((a, b) => b.similarity - a.similarity).slice(0, topK);
  }

  private getCacheKey(
    text: string,
    modelName: string,
    mode: EmbedMode = "passage",
  ): string {
    const utils = Zotero.Utilities as any;
    const hash = utils?.Internal?.md5
      ? utils.Internal.md5(text)
      : (utils?.sha1?.(text) ?? String(text.length));
    return `ai:embedding:text:${hash}:${modelName}:${mode}`;
  }

  async clearCache(): Promise<void> {
    const modelInfo = this.getModelInfo();
    await EmbeddingStore.clearAll(modelInfo.name);
  }

  /**
   * Dynamically resolve the active embedding provider based on `embedding.mode`.
   * Per-call resolution (CLAUDE.md: no provider ref caching) — mode can change
   * at runtime without restart.
   *   "local" → LocalEmbeddingProvider (ONNX/transformers.js, DEFAULT)
   *   "api"   → ApiEmbeddingProvider (OpenAI-compatible /v1/embeddings, opt-in)
   */
  private async resolveProvider(): Promise<
    import("../embedding/EmbeddingProvider").EmbeddingProvider
  > {
    const mode = (getPrefDynamic("embedding.mode") as string) || "local";
    if (mode === "local") {
      return (await import("../embedding/LocalEmbeddingProvider")).default;
    }
    return (await import("../embedding/ApiEmbeddingProvider")).default;
  }

  /**
   * Resolve the configured embedding model id, or throw a localized,
   * actionable error when API mode has no embedding model assigned.
   *
   * Local mode always resolves (DEFAULT_LOCAL_MODEL fallback), so this only
   * throws for API mode — the exact condition that previously returned a silent
   * `{ name: '', dimension: 0 }` and let semantic search run on garbage.
   *
   * Centralized so every entry point (getModelInfo, embedText/embedQuery/
   * embedBatch via embedText, findSimilarItems) surfaces the SAME message.
   */
  private requireEmbeddingModelId(): string {
    const mode = (getPrefDynamic("embedding.mode") as string) || "local";
    if (mode === "local") {
      return (
        (getPrefDynamic("embedding.local.model") as string) ||
        DEFAULT_LOCAL_MODEL
      );
    }
    let modelId: string | undefined;
    try {
      const ConfigManager = require("../../utils/config/ConfigManager").default;
      modelId = ConfigManager.getModelForFeature("embedding") || undefined;
    } catch (e) {
      safeDebug(
        "[z-search] EmbeddingsManager: ConfigManager unavailable: " + e,
      );
      /* ConfigManager unavailable → treat as unconfigured (throws below) */
    }
    if (!modelId) {
      throw new Error(getString("embedding-not-configured-error"));
    }
    return modelId;
  }

  getModelInfo(): { name: string; dimension: number } {
    const mode = (getPrefDynamic("embedding.mode") as string) || "local";
    if (mode === "local") {
      const localName =
        (getPrefDynamic("embedding.local.model") as string) ||
        DEFAULT_LOCAL_MODEL;
      return {
        name: localName,
        dimension: LOCAL_MODEL_DIMENSIONS[localName] ?? 384,
      };
    }
    // API mode: an embedding model MUST be assigned. Fail loudly with a
    // localized, actionable error instead of returning { name: '', dimension: 0 }
    // (which silently let search/index operate on empty model keys → garbage).
    const modelId = this.requireEmbeddingModelId();
    try {
      // 同步 require shim：esbuild 内联以打破环形依赖；此上下文无法 await
      // import（本文件的 no-require-imports 在 eslint.config.mjs 关闭）。
      const ConfigManager = require("../../utils/config/ConfigManager").default;
      const config = ConfigManager.getModelFullConfig(modelId);
      const apiModelId = config?.model?.modelId || modelId;
      const {
        API_MODEL_DIMENSIONS,
      } = require("../embedding/EmbeddingProvider");
      return {
        name: modelId,
        dimension: API_MODEL_DIMENSIONS[apiModelId] ?? 0,
      };
    } catch (e) {
      safeDebug(
        "[z-search] EmbeddingsManager.getModelInfo: config/dimension lookup failed: " +
          e,
      );
      // Model is assigned but config/dimension lookup failed — dimension is
      // best-effort (EmbeddingStore keys by name, not dimension).
      return { name: modelId, dimension: 0 };
    }
  }
}

export default new EmbeddingsManager();
