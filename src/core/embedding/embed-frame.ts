/**
 * Embed frame entry — bundled standalone for iframe-based embedding.
 *
 * Built by scripts/build-embed-frame.cjs → addon/content/scripts/embed-standalone.js.
 * Loaded via a <script src="chrome://zsearch/content/scripts/embed-standalone.js">
 * tag into an off-screen about:blank iframe created by EmbedFrameHost.
 *
 * Why an iframe: ORT's wasm backend loads its factory via dynamic import(),
 * which Gecko refuses in the bootstrap subscript sandbox leadero.js runs in
 * ("No ScriptLoader found for the current context" — no script loader without
 * a document). An iframe IS a window context, so import() works there, and
 * the iframe's standard HTML document satisfies every DOM assumption ORT and
 * transformers make. Same architecture as mermaid-standalone (E1 前例).
 *
 * Wire protocol: the host calls `win.zsearchEmbedFrame.embed(req)` directly
 * (cross-compartment, same system principal — the mermaid renderer calls
 * `win.mermaid.render()` the same way). Requests are serialized frame-side
 * through a single-flight pipeline load; results/errors come back as
 * structured objects so the main side can wrap them with its historic
 * message texts.
 *
 * @module core/embedding/embed-frame
 */

import type { EmbedFrameError, EmbedFrameRequest } from "./embedFrameLogic";
import { applyEmbedFrameEnv, prefixEmbedText } from "./embedFrameLogic";

interface EmbedFrameResult {
  vector?: number[];
  error?: EmbedFrameError;
}

type Pipeline = (
  text: string,
  opts: { pooling: string; normalize: boolean },
) => Promise<{ data: Float32Array | number[] }>;

const pipelines = new Map<string, Pipeline>();
const pipelineLoads = new Map<string, Promise<Pipeline>>();
let currentModelName = "";

async function getPipeline(
  transformers: any,
  req: EmbedFrameRequest,
): Promise<Pipeline> {
  // Model switch forces a reload; the previous pipeline is dropped for GC
  // (its ONNX session frees when the frame eventually disposes or unloads).
  if (pipelines.has(req.modelName)) return pipelines.get(req.modelName)!;
  const inFlight = pipelineLoads.get(req.modelName);
  if (inFlight) return inFlight;

  applyEmbedFrameEnv(
    transformers.env,
    req,
    (globalThis as any).navigator?.hardwareConcurrency ?? 4,
  );
  // dtype q8 → onnx/model_quantized.onnx (the only file
  // ModelDownloadManager ships); device wasm — no WebGL/WebGPU here.
  const load = transformers.pipeline("feature-extraction", req.modelName, {
    device: "wasm",
    dtype: "q8",
  }) as Promise<Pipeline>;
  pipelineLoads.set(req.modelName, load);
  try {
    const pipe = await load;
    // Single live pipeline: a switch evicts every other model (two 278MB
    // ONNX sessions must never coexist — mirrors the historic reload-on-
    // switch semantics where the old pipeline was simply dropped).
    for (const [name, old] of pipelines) {
      if (name !== req.modelName) {
        const p = old as any;
        if (p && typeof p.dispose === "function") {
          try {
            const r = p.dispose();
            if (r && typeof r.catch === "function") r.catch(() => {});
          } catch {
            /* best-effort */
          }
        }
        pipelines.delete(name);
      }
    }
    pipelines.set(req.modelName, pipe);
    currentModelName = req.modelName;
    return pipe;
  } finally {
    pipelineLoads.delete(req.modelName);
  }
}

async function embed(req: EmbedFrameRequest): Promise<EmbedFrameResult> {
  const transformers = (globalThis as any).__zsearchTransformers;
  if (!transformers) {
    return {
      error: { kind: "load", message: "transformers module not initialized" },
    };
  }
  try {
    const pipe = await getPipeline(transformers, req);
    const prefixed = prefixEmbedText(req.modelName, req.text, req.mode);
    try {
      const output = await pipe(prefixed, { pooling: "mean", normalize: true });
      return { vector: Array.from(output.data as Float32Array) };
    } catch (e: any) {
      return {
        error: { kind: "inference", message: e?.message ?? String(e) },
      };
    }
  } catch (e: any) {
    return { error: { kind: "load", message: e?.message ?? String(e) } };
  }
}

function dispose(modelName: string): void {
  const pipe = pipelines.get(modelName) as any;
  pipelines.delete(modelName);
  if (currentModelName === modelName) currentModelName = "";
  if (pipe && typeof pipe.dispose === "function") {
    try {
      const r = pipe.dispose();
      if (r && typeof r.catch === "function") r.catch(() => {});
    } catch {
      /* best-effort */
    }
  }
}

async function init(): Promise<void> {
  // transformers.web.js probes navigator at module init; an iframe window
  // has a real one, so no stub is needed — import directly.
  (globalThis as any).__zsearchTransformers =
    await import("@huggingface/transformers");
  (globalThis as any).zsearchEmbedFrame = { embed, dispose };
}

// Expose the readiness promise so the host can await full init instead of
// polling for the global.
(globalThis as any).zsearchEmbedFrameReady = init();
