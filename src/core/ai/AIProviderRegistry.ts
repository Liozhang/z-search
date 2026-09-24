/**
 * AI Provider Registry V2
 * Manages AI provider instances using Vercel AI SDK
 */

import ConfigManager from "../../utils/config/ConfigManager";
import type { IAIProvider, AIModel } from "../../types/ai";
import type { AIFeature } from "../../types/config";
import { UnifiedAIProvider } from "./UnifiedAIProvider";
import { getContextWindow } from "./MODEL_REGISTRY";
import { safeDebug } from "../../utils/logger";

export class AIProviderRegistry {
  private providers = new Map<string, IAIProvider>();
  private activeProviderId: string | null = null;

  register(provider: IAIProvider): void {
    this.providers.set(provider.id, provider);
  }

  unregister(id: string): void {
    this.providers.delete(id);
    if (this.activeProviderId === id) {
      this.activeProviderId = null;
    }
  }

  get(id: string): IAIProvider | undefined {
    return this.providers.get(id);
  }

  getActive(): IAIProvider | undefined {
    if (this.activeProviderId) {
      const cached = this.providers.get(this.activeProviderId);
      if (cached) return cached;
    }
    // No fallback — caller must handle undefined (project rule: no fallback degradation)
    return undefined;
  }

  getActiveId(): string | null {
    return this.activeProviderId;
  }

  /**
   * Get the provider type of the current active provider.
   * Used for provider-specific optimizations (e.g., Anthropic cache_control).
   */
  getActiveProviderType(): "openai" | "anthropic" | "google" | "custom" | null {
    const active = this.getActive();
    if (!active) return null;
    // Check if the active provider is a UnifiedAIProvider with providerType
    const unified = active as any;
    if (unified.providerType) return unified.providerType;
    return null;
  }

  setActive(id: string): void {
    // Accept both model IDs and legacy provider IDs
    const cacheKey = id.startsWith("model:") ? id : `model:${id}`;
    if (this.providers.has(cacheKey)) {
      this.activeProviderId = cacheKey;
    } else {
      // Try to resolve via getProviderForModel
      const resolved = this.getProviderForModel(id);
      if (resolved) {
        this.activeProviderId = `model:${id}`;
      }
    }
  }

  listProviders(): IAIProvider[] {
    return Array.from(this.providers.values());
  }

  listModels(providerId?: string): AIModel[] {
    if (providerId) {
      const provider = this.providers.get(providerId);
      return provider?.supportedModels || [];
    }
    return this.getAllModels();
  }

  getAllModels(): AIModel[] {
    const models: AIModel[] = [];
    for (const provider of this.providers.values()) {
      models.push(...provider.supportedModels);
    }
    return models;
  }

  /**
   * Get provider for a specific model (dynamic creation with cache)
   * Resolves modelId -> ModelConfig -> ProviderConfig -> UnifiedAIProvider
   */
  getProviderForModel(modelId: string): IAIProvider | null {
    const cacheKey = `model:${modelId}`;
    if (this.providers.has(cacheKey)) {
      return this.providers.get(cacheKey)!;
    }

    const config = ConfigManager.getModelFullConfig(modelId);
    if (!config) {
      return null;
    }

    const { model, provider } = config;
    const authMode = provider.authMode || "api_key";

    // OAuth providers don't need apiKey (token obtained dynamically)
    if (authMode === "api_key" && !provider.apiKey) {
      return null;
    }

    try {
      const instance = new UnifiedAIProvider({
        id: modelId,
        name: model.name,
        providerType: provider.adapter as any,
        models: [],
        defaultBaseUrl: provider.baseUrl,
      });

      instance.configureSync({
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        model: model.modelId,
        authMode,
        protocol: provider.protocol ?? "auto",
      });

      // Apply model-level parameters
      instance.modelTemperature = model.temperature;
      instance.modelContextWindow =
        model.contextWindow ?? getContextWindow(model.id) ?? 0;
      instance.modelThinkingEnabled = model.thinkingEnabled;
      instance.modelMaxOutputTokens = model.maxOutputTokens ?? 0;
      instance.structuredOutputs = provider.structuredOutputs ?? false;

      this.providers.set(cacheKey, instance);
      return instance;
    } catch (e) {
      safeDebug(`[z-search] getProviderForModel(${modelId}) failed: ${e}`);
      return null;
    }
  }

  /**
   * Get provider for a feature: feature -> modelId -> provider
   */
  getProviderForFeature(feature: AIFeature): IAIProvider | null {
    const modelId = ConfigManager.getModelForFeature(feature);
    if (!modelId) return null;
    return this.getProviderForModel(modelId);
  }

  /**
   * Set the global active provider (for temporary switching by UI or ToolManager)
   * @param providerId provider ID, null to restore default
   */
  setActiveProvider(providerId: string | null): void {
    if (providerId === null) {
      this.activeProviderId = null;
      return;
    }
    // Normalize: accept both "gpt-4o" and "model:gpt-4o"
    const cacheKey = providerId.startsWith("model:")
      ? providerId
      : `model:${providerId}`;
    this.activeProviderId = cacheKey;
  }

  /**
   * Invalidate the specified provider cache (called when config is updated)
   * @param providerId provider ID
   */
  invalidateProvider(providerId: string): void {
    // Normalize key format to match providers Map
    const cacheKey = providerId.startsWith("model:")
      ? providerId
      : `model:${providerId}`;
    const provider = this.providers.get(cacheKey);
    if (provider) {
      // Try calling destroy to clean up resources
      try {
        if (typeof (provider as any).destroy === "function") {
          (provider as any).destroy();
        }
      } catch (e) {
        safeDebug(
          "[z-search] AIProviderRegistry: invalidateProvider destroy failed: " +
            e,
        );
      }
      this.providers.delete(cacheKey);
    }

    // If the cleared provider is the current active one, reset
    if (this.activeProviderId === cacheKey) {
      this.activeProviderId = null;
    }
  }

  /**
   * Invalidate all cached providers (called when provider/model config changes)
   */
  invalidateAll(): void {
    this.clearAll();
  }

  /**
   * Clear all provider caches (used for cleanup on exit)
   */
  clearAll(): void {
    for (const [_id, provider] of this.providers) {
      try {
        if (typeof (provider as any).destroy === "function") {
          (provider as any).destroy();
        }
      } catch (e) {
        safeDebug(
          "[z-search] AIProviderRegistry: clearAll destroy failed: " + e,
        );
      }
    }
    this.providers.clear();
    this.activeProviderId = null;
  }
}

const registry = new AIProviderRegistry();

// Expose registry on globalThis for ConfigManager to call invalidateAll()
// without creating a circular import. Guarded so Node/vitest environments
// that lack the rspack-injected `_globalThis` can still import this module.
if (typeof _globalThis !== "undefined") {
  (_globalThis as any).__zsearchRegistry = registry;
}

export default registry;
