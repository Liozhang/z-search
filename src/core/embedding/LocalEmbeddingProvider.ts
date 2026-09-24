/**
 * LocalEmbeddingProvider - on-device embedding via transformers.js.
 *
 * The transformers pipeline runs inside an off-screen iframe (embed-standalone.js,
 * hosted by EmbedFrameHost) — ORT's wasm backend needs dynamic import(), which
 * the bootstrap subscript sandbox this bundle runs in cannot do (three-layer
 * root cause: 2026-09-12, see embed-frame.ts). This provider keeps the public
 * EmbeddingProvider contract (model name from prefs, dimension, E5-mode
 * semantics, dispose) and delegates inference to the frame; failures come
 * back structured and are re-thrown with the historic message texts so
 * callers and tests see unchanged errors.
 *
 * Error texts are contract (tests assert both):
 * - load kind   → "Failed to load local embedding model '<model>'. Ensure the
 *                 model is downloaded (Settings -> Semantic & Vision -> Download
 *                 Model). Original error: <frame message>"
 * - inference   → "Local embedding inference failed for model '<model>': <msg>"
 *
 * @module core/embedding/LocalEmbeddingProvider
 */

import type { EmbeddingProvider, EmbedMode } from "./EmbeddingProvider";
import {
  LOCAL_MODEL_DIMENSIONS,
  DEFAULT_LOCAL_MODEL,
} from "./EmbeddingProvider";
import { getPrefDynamic } from "../../utils/prefs";
import { toErrorMessage } from "../../utils/error";
import { EmbedFrameHost } from "./EmbedFrameHost";
import { safeDebug } from "../../utils/logger";

class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly isLocal = true;

  get name(): string {
    return (
      (getPrefDynamic("embedding.local.model") as string) || DEFAULT_LOCAL_MODEL
    );
  }

  get dimension(): number {
    return LOCAL_MODEL_DIMENSIONS[this.name] ?? 384;
  }

  // Model of the last successful embed — drives isReady(). The pipeline
  // itself is cached frame-side (single live model, switch evicts the old).
  private readyModelName = "";

  /**
   * True only when the frame has successfully embedded for the
   * currently-configured model in this session. Model file existence is
   * checked separately by ModelDownloadManager.isModelDownloaded (used by
   * the pref UI); this method only reports the in-memory state.
   */
  isReady(): boolean {
    return this.readyModelName !== "" && this.readyModelName === this.name;
  }

  async embed(text: string, mode: EmbedMode = "passage"): Promise<number[]> {
    const modelName = this.name;
    // Model files live under {DataDir}/leadero/models (ModelDownloadManager's
    // layout); the frame resolves them via file:// URIs — a bare Windows path
    // fails fetch() with NetworkError (verified on real machine).
    let modelsRootUri: string | undefined;
    try {
      modelsRootUri = PathUtils.toFileURI(
        PathUtils.join(Zotero.DataDirectory.dir, "zsearch", "models"),
      );
    } catch (e) {
      safeDebug(
        "[z-search] LocalEmbeddingProvider: models root URI failed: " + e,
      );
    }
    // ORT wasm assets ship with the plugin (scripts/build-ort-assets.cjs →
    // addon/content/ort/); rootURI is the bootstrap-injected plugin root.
    const ortBaseUri =
      typeof rootURI !== "undefined" ? `${rootURI}content/ort/` : undefined;

    let vector: number[];
    try {
      vector = await EmbedFrameHost.embed({
        modelName,
        text,
        mode,
        modelsRootUri,
        ortBaseUri,
      });
    } catch (e: any) {
      const msg = toErrorMessage(e);
      if (msg.startsWith("load: ")) {
        throw new Error(
          "Failed to load local embedding model '" +
            modelName +
            "'. " +
            "Ensure the model is downloaded (Settings -> Semantic & Vision -> Download Model). " +
            "Original error: " +
            msg.slice("load: ".length),
          { cause: e },
        );
      }
      if (msg.startsWith("inference: ")) {
        throw new Error(
          "Local embedding inference failed for model '" +
            modelName +
            "': " +
            msg.slice("inference: ".length),
          { cause: e },
        );
      }
      // Frame host unavailable (no main window / script load failure / dead
      // frame). FD-27：这类是宿主结构错误，模型文件无嫌疑——此前伪装成
      // 「模型未下载」指引重下，用户照做无效。降级路径按异常类型统一兜底
      //（不 parse 消息文本），措辞改直无行为影响。
      const kindError = e as { message?: string };
      const frameMessage = kindError?.message ?? msg;
      throw new Error(
        "Local embedding frame host unavailable — NOT a model download issue. " +
          "Restart Zotero (or reopen the main window) and retry. " +
          "Underlying error: " +
          frameMessage,
        { cause: e },
      );
    }
    this.readyModelName = modelName;
    return vector;
  }

  dispose(): void {
    if (this.readyModelName !== "") {
      // Frame-side dispose frees the ONNX session (WASM heap otherwise lingers
      // until GC). Fire-and-forget — dispose must never block callers.
      try {
        EmbedFrameHost.dispose(this.readyModelName);
      } catch (e) {
        safeDebug("[z-search] LocalEmbeddingProvider: " + e);
      }
    }
    this.readyModelName = "";
  }
}

export default new LocalEmbeddingProvider();
