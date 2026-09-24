/**
 * MODEL_REGISTRY — declarative fallback for model metadata not present in user config.
 *
 * Leadero's `AIModel.maxContextTokens` is the preferred source of truth.
 * This registry only fills gaps for known models whose config omits the field,
 * replacing the previous hard-coded `lookupContextWindow()` switch in
 * `AIProviderRegistry.ts` and the dead-code copy in `UnifiedAIProvider.ts`.
 *
 * Patterns are matched by `String.prototype.includes()` against the model ID,
 * preserving the same loose-matching semantics as the old lookup table.
 */

export type ModelRegistryEntry = {
  readonly provider:
    "openai" | "anthropic" | "google" | "deepseek" | "qwen" | "glm" | "custom";
  readonly contextWindow: number;
  readonly maxOutputTokens?: number;
  readonly supportsToolCalling?: boolean;
};

const ENTRIES: ReadonlyArray<{
  readonly pattern: string;
  readonly entry: ModelRegistryEntry;
}> = [
  // OpenAI
  {
    pattern: "gpt-4o",
    entry: {
      provider: "openai",
      contextWindow: 128_000,
      supportsToolCalling: true,
    },
  },
  {
    pattern: "gpt-4o-mini",
    entry: {
      provider: "openai",
      contextWindow: 128_000,
      supportsToolCalling: true,
    },
  },
  {
    pattern: "gpt-4-turbo",
    entry: {
      provider: "openai",
      contextWindow: 128_000,
      supportsToolCalling: true,
    },
  },
  {
    pattern: "gpt-4.1",
    entry: {
      provider: "openai",
      contextWindow: 1_047_576,
      supportsToolCalling: true,
    },
  },
  {
    pattern: "o1",
    entry: {
      provider: "openai",
      contextWindow: 200_000,
      supportsToolCalling: true,
    },
  },
  {
    pattern: "o3",
    entry: {
      provider: "openai",
      contextWindow: 200_000,
      supportsToolCalling: true,
    },
  },
  {
    pattern: "o4-mini",
    entry: {
      provider: "openai",
      contextWindow: 200_000,
      supportsToolCalling: true,
    },
  },
  // Anthropic
  {
    pattern: "claude-opus-4",
    entry: {
      provider: "anthropic",
      contextWindow: 200_000,
      supportsToolCalling: true,
    },
  },
  {
    pattern: "claude-sonnet-4",
    entry: {
      provider: "anthropic",
      contextWindow: 200_000,
      supportsToolCalling: true,
    },
  },
  {
    pattern: "claude-3-5-sonnet",
    entry: {
      provider: "anthropic",
      contextWindow: 200_000,
      supportsToolCalling: true,
    },
  },
  {
    pattern: "claude-3-5-haiku",
    entry: {
      provider: "anthropic",
      contextWindow: 200_000,
      supportsToolCalling: true,
    },
  },
  {
    pattern: "claude-3-opus",
    entry: {
      provider: "anthropic",
      contextWindow: 200_000,
      supportsToolCalling: true,
    },
  },
  // Google
  {
    pattern: "gemini-2.5-pro",
    entry: {
      provider: "google",
      contextWindow: 1_048_576,
      supportsToolCalling: true,
    },
  },
  {
    pattern: "gemini-2.5-flash",
    entry: {
      provider: "google",
      contextWindow: 1_048_576,
      supportsToolCalling: true,
    },
  },
  {
    pattern: "gemini-2.0-flash",
    entry: {
      provider: "google",
      contextWindow: 1_048_576,
      supportsToolCalling: true,
    },
  },
  {
    pattern: "gemini-2.0-pro",
    entry: {
      provider: "google",
      contextWindow: 128_000,
      supportsToolCalling: true,
    },
  },
  // DeepSeek
  {
    pattern: "deepseek-chat",
    entry: {
      provider: "deepseek",
      contextWindow: 64_000,
      supportsToolCalling: true,
    },
  },
  {
    pattern: "deepseek-reasoner",
    entry: {
      provider: "deepseek",
      contextWindow: 64_000,
      supportsToolCalling: true,
    },
  },
  // Qwen
  {
    pattern: "qwen-max",
    entry: {
      provider: "qwen",
      contextWindow: 32_768,
      supportsToolCalling: true,
    },
  },
  {
    pattern: "qwen-plus",
    entry: {
      provider: "qwen",
      contextWindow: 131_072,
      supportsToolCalling: true,
    },
  },
  // GLM
  {
    pattern: "glm-4",
    entry: {
      provider: "glm",
      contextWindow: 128_000,
      supportsToolCalling: true,
    },
  },
];

/**
 * Returns the first registry entry whose pattern is included in `modelId`.
 * Returns `undefined` when the model is unknown — callers should fall back
 * to their own default (typically `0` or the provider-reported value).
 */
export function getModelRegistry(
  modelId: string,
): ModelRegistryEntry | undefined {
  for (const { pattern, entry } of ENTRIES) {
    if (modelId.includes(pattern)) return entry;
  }
  return undefined;
}

/**
 * Convenience: return only the context window for a model ID, or `undefined`.
 */
export function getContextWindow(modelId: string): number | undefined {
  return getModelRegistry(modelId)?.contextWindow;
}
