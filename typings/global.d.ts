declare const _globalThis: {
  [key: string]: any;
  Zotero: _ZoteroTypes.Zotero;
  ztoolkit: ZToolkit;
  addon: typeof addon;
};

declare type ZToolkit = ReturnType<
  typeof import("../src/utils/ztoolkit").createZToolkit
>;

declare const ztoolkit: ZToolkit;

declare const rootURI: string;

declare const addon: import("../src/addon").default;

declare const __env__: "production" | "development";

declare const __buildVersion__: string;

/**
 * Optional peer dependency for local embedding (Phase B-4).
 *
 * Not installed by default. Users opt-in by running
 * `npm install @xenova/transformers` in the plugin source then rebuilding.
 * LocalEmbeddingProvider.embed() handles missing-module case at runtime
 * via dynamic import + try/catch.
 *
 * Declaration stub lets TypeScript resolve the dynamic import without
 * forcing the dependency on all developers/users.
 */
declare module "@xenova/transformers" {
  export interface PipelineOptions {
    device?: "cpu" | "wasm" | "webgpu";
    dtype?: "fp32" | "fp16" | "q8" | "int8";
    cache_dir?: string;
  }

  export interface FeatureExtractionOptions {
    pooling?: "mean" | "cls" | "none";
    normalize?: boolean;
  }

  export type Pipeline = (
    text: string | string[],
    options?: FeatureExtractionOptions,
  ) => Promise<{ data: Float32Array | number[]; dims: number[] }>;

  export function pipeline(
    task: "feature-extraction" | string,
    model: string,
    options?: PipelineOptions,
  ): Promise<Pipeline>;

  export const env: {
    cacheDir?: string;
    allowRemoteModels?: boolean;
    allowLocalModels?: boolean;
    backends?: {
      onnx?: {
        wasm?: {
          proxy?: boolean;
          numThreads?: number;
        };
      };
    };
  };
}
