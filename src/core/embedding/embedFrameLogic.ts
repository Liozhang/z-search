/**
 * embedFrameLogic — pure helpers shared by the embed iframe entry and tests.
 *
 * The embed iframe (embed-standalone.js, built by scripts/build-embed-frame.cjs)
 * runs @huggingface/transformers inside an off-screen about:blank iframe whose
 * document is a standard HTML document — dynamic import() (required by the ORT
 * wasm backend to load its factory mjs) works there, unlike the bootstrap
 * subscript sandbox leadero.js runs in (see LocalEmbeddingProvider header for
 * the three-layer root cause).
 *
 * This module holds the context-free decisions so vitest can test them
 * directly; the iframe entry wires them into the transformers pipeline.
 *
 * @module core/embedding/embedFrameLogic
 */

import { requiresE5Prefix } from "./EmbeddingProvider";

/** Wire format for one embed request (main → frame). */
export interface EmbedFrameRequest {
  /** Configured local model name, e.g. "Xenova/multilingual-e5-small". */
  modelName: string;
  /** Raw text to embed (prefixing happens frame-side). */
  text: string;
  /** "query" | "passage" — drives the E5 prefix. */
  mode: "query" | "passage";
  /** file:// URI of {DataDir}/leadero/models — transformers localModelPath. */
  modelsRootUri?: string;
  /** file:// URI base of addon/content/ort/ — ORT wasmPaths {mjs,wasm} join. */
  ortBaseUri?: string;
}

/** Structured error returned frame→main (kind drives the wrapped message). */
export interface EmbedFrameError {
  kind: "load" | "inference";
  message: string;
}

/**
 * E5-family asymmetric retrieval prefixes. Symmetric models (MiniLM, mpnet)
 * are returned unchanged. Mirrors the historic LocalEmbeddingProvider logic.
 */
export function prefixEmbedText(
  modelName: string,
  text: string,
  mode: "query" | "passage",
): string {
  return requiresE5Prefix(modelName)
    ? `${mode === "query" ? "query: " : "passage: "}${text}`
    : text;
}

/**
 * Apply the transformers env for one request, in place on the given env.
 *
 * localModelPath/cacheDir point at the pre-downloaded model root (file://
 * URI — fetch under the iframe's system principal works; a bare Windows
 * path does not). wasmPaths points at the shipped ORT assets
 * (addon/content/ort/, via scripts/build-ort-assets.cjs) using the object
 * form so ORT imports our factory instead of the jsDelivr CDN default that
 * transformers presets at module init.
 *
 * Mutates `env` in place; safe to call repeatedly (idempotent per request).
 */
export function applyEmbedFrameEnv(
  env: any,
  req: EmbedFrameRequest,
  hardwareConcurrency: number,
): void {
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  // Cache Storage 只收 http(s)——file:// 模型 URI 的每次 Cache.put 都失败并
  // 发 "Unable to add response to browser cache" 警告（真机 Console 四类：
  // config/tokenizer/onnx/ort-mjs），纯噪声。关掉浏览器缓存，模型文件由
  // file:// fetch 直读（模型本就在本地盘，无重复下载损失）。
  (env as any).useBrowserCache = false;
  if (req.modelsRootUri) {
    // v4 renamed the cache field: cacheDir governs downloaded-file caching,
    // localModelPath drives allowLocalModels resolution (its default literal
    // "models" never exists on disk). Set BOTH for cross-version safety.
    env.localModelPath = req.modelsRootUri;
    env.cacheDir = req.modelsRootUri;
  }
  env.backends ??= {};
  env.backends.onnx ??= {};
  const ortWasm: any = env.backends.onnx.wasm ?? {};
  const hw = hardwareConcurrency || 4;
  ortWasm.numThreads = Math.max(1, Math.min(hw, 4));
  // Object form wasmPaths {mjs, wasm} — MUST be written in place on the wasm
  // object transformers copied from ORT env (replacing the reference would
  // leave ORT reading its own CDN default).
  if (req.ortBaseUri) {
    ortWasm.wasmPaths = {
      mjs: `${req.ortBaseUri}ort-wasm-simd-threaded.jsep.mjs`,
      wasm: `${req.ortBaseUri}ort-wasm-simd-threaded.jsep.wasm`,
    };
  }
  env.backends.onnx.wasm = ortWasm;
  // Proxy workers need a blob script URL path that misbehaves under XUL
  // origins — the in-window inference is fast enough for one-text calls.
  env.backends.onnx.wasm.proxy = false;
}
