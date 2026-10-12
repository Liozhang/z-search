/**
 * EmbeddingProvider - common interface for API-based and local embeddings.
 *
 * Implementations:
 * - LocalEmbeddingProvider (transformers.js + ONNX, optional - downloaded on demand)
 *
 * Used by EmbeddingsManager which dynamically resolves provider per-call
 * based on the `embedding.mode` preference (CLAUDE.md: no provider ref caching).
 */

import { getPrefDynamic } from "../../utils/prefs";

export interface EmbeddingProvider {
  /** Provider identifier (e.g., "text-embedding-3-small", "Xenova/all-MiniLM-L6-v2") */
  readonly name: string;

  /** Output vector dimension */
  readonly dimension: number;

  /** True for local providers (no API key, runs on device) */
  readonly isLocal: boolean;

  /**
   * Returns true if the provider can embed right now
   * (API key configured / model file loaded).
   */
  isReady(): boolean;

  /** Generate embedding for a single text.
   *  mode: 'query' for search queries, 'passage' for documents/indexing.
   *  E5-family models require different prefixes per mode; symmetric models
   *  (MiniLM, mpnet) ignore it. Defaults to 'passage'. */
  embed(text: string, mode?: EmbedMode): Promise<number[]>;

  /** Optional: generate embeddings for multiple texts in one call.
   *  API providers should batch into a single HTTP request (SDK embedMany);
   *  EmbeddingsManager falls back to the sequential embed() loop when absent. */
  embedBatch?(texts: string[], mode?: EmbedMode): Promise<number[][]>;

  /** Optional: release resources (e.g., unload ONNX session) */
  dispose?(): void | Promise<void>;
}

/**
 * Embedding mode — distinguishes search queries from indexed documents.
 * E5-family models prepend "query: " or "passage: " accordingly; symmetric
 * models (MiniLM, mpnet) ignore the distinction.
 */
export type EmbedMode = "query" | "passage";

/**
 * Known local model metadata. Single source of truth used by both
 * LocalEmbeddingProvider (runtime) and EmbeddingsManager.getModelInfo
 * (sync dimension lookup without loading the model).
 *
 * Custom models outside this table get their real dimension recorded into
 * the `embedding.local.dimensions` pref map by ModelDownloadManager after
 * first download/verification (read from the model's config.json).
 */
export const LOCAL_MODEL_DIMENSIONS: Record<string, number> = {
  "Xenova/multilingual-e5-small": 384,
  "Xenova/all-MiniLM-L6-v2": 384,
  "Xenova/paraphrase-multilingual-mpnet-base-v2": 768,
  "Xenova/multilingual-e5-large": 1024,
};

/** 未知模型的兜底维度——仅在静态表与已记录映射都未命中时使用。 */
export const FALLBACK_MODEL_DIMENSION = 384;

/**
 * 模型维度三级回退：内置表 → 已记录映射（ModelDownloadManager 从
 * config.json 读到的 hidden_size）→ 兜底 384。同步读——getModelInfo 与
 * provider.dimension 都是热路径同步消费方；映射由下载/校验路径异步预写。
 */
export function getModelDimension(modelName: string): number {
  const known = LOCAL_MODEL_DIMENSIONS[modelName];
  if (known) return known;
  try {
    const map = JSON.parse(
      String(getPrefDynamic("embedding.local.dimensions") ?? "{}"),
    );
    const dim = map?.[modelName];
    if (typeof dim === "number" && Number.isFinite(dim) && dim > 0) {
      return Math.round(dim);
    }
  } catch {
    /* 未记录或 pref 损坏 → 兜底 */
  }
  return FALLBACK_MODEL_DIMENSION;
}

/**
 * Default local model. multilingual-e5-small gives 384-dim (same schema as the
 * previous MiniLM default — no storage migration needed) with bilingual ZH+EN
 * support, the best quality at CPU-friendly size (~120MB).
 *
 * The literal value lives in src/utils/defaults.ts (single source of truth,
 * consistency-tested against addon/prefs.js); re-exported here so existing
 * consumers keep their import path.
 */
export { DEFAULT_EMBEDDING_LOCAL_MODEL as DEFAULT_LOCAL_MODEL } from "../../utils/defaults";

/**
 * Whether a model requires the E5 query/passage prefix convention.
 * E5-family models (multilingual-e5-small, multilingual-e5-large, bge-*) need
 * "query: " / "passage: " prefixes for asymmetric retrieval; symmetric models
 * (MiniLM, mpnet, paraphrase-*) do not.
 */
export function requiresE5Prefix(modelName: string): boolean {
  const lower = modelName.toLowerCase();
  return lower.includes("e5") || lower.includes("bge");
}

/**
 * Known dimensions for common API embedding models. Used by
 * ApiEmbeddingProvider.dimension for sync access (EmbeddingStore keys by
 * model name, not dimension, so 0/unknown does not affect correctness).
 * Add entries as new API embedding models become common.
 */
export const API_MODEL_DIMENSIONS: Record<string, number> = {
  "text-embedding-3-small": 1536,
  "text-embedding-3-large": 3072,
  "text-embedding-ada-002": 1536,
  "bge-m3": 1024,
  "bge-large-en-v1.5": 1024,
  "bge-large-zh-v1.5": 1024,
  "multilingual-e5-large": 1024,
  "gte-large": 1024,
  "jina-embeddings-v2-base-en": 768,
  "jina-embeddings-v2-base-zh": 768,
  "nomic-embed-text": 768,
};
