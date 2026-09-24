/**
 * Configuration Manager for Leadero
 *
 * Dynamic provider/model system with three-tier architecture:
 * Provider (connection) -> Model (params) -> Feature Assignment
 *
 * @module utils/config/ConfigManager
 */

import { getPrefDynamic, setPrefDynamic } from "../../utils/prefs";
import {
  getSecret,
  setSecret,
  deleteSecret,
  providerSecretKey,
} from "../secretStore";
import type { AIFeature } from "../../types/config";
import type { ProviderConfig, ModelConfig } from "../../types/provider";
import { PRESET_PROVIDERS } from "../../types/provider";
import { safeDebug } from "../logger";

/**
 * Single source of truth for the AI feature list. `Record<AIFeature, true>`
 * turns a new AIFeature union member into a compile error until it is listed
 * here, which a plain `AIFeature[]` literal cannot catch.
 */
const AI_FEATURE_MAP: Record<AIFeature, true> = {
  translation: true,
  chat: true,
  agent: true,
  vision: true,
  embedding: true,
};

class ConfigManagerClass {
  private prefsLoaded = false;

  /** Dynamic provider/model storage */
  private providers: ProviderConfig[] = [];
  private models: ModelConfig[] = [];

  // ==================== Initialization ====================

  /** Ensure prefs are loaded (lazy) */
  private ensurePrefsLoaded(): void {
    if (!this.prefsLoaded) {
      try {
        this.loadFromPrefs();
        this.migrateFeaturePrefs();
        this.prefsLoaded = true;
      } catch (e) {
        safeDebug("[z-search] ConfigManager: ensurePrefsLoaded failed: " + e);
      }
    }
  }

  /** Force reload from prefs (e.g. after user changes AI settings). */
  reload(): void {
    this.prefsLoaded = false;
    this.ensurePrefsLoaded();
  }

  /** Migrate renamed feature prefs (one-time, idempotent) */
  private migrateFeaturePrefs(): void {
    // Migrate internal model IDs (model_*) to provider modelIds.
    // XUL prefs page used model.id as value; React UI uses model.modelId.
    const features = Object.keys(AI_FEATURE_MAP);
    for (const feature of features) {
      const current = String(getPrefDynamic(`ai.selection.${feature}`) || "");
      if (!current.startsWith("model_")) continue;
      const match = this.models.find((m) => m.id === current);
      if (match && match.modelId !== current) {
        setPrefDynamic(`ai.selection.${feature}`, match.modelId);
      }
    }
  }

  /** Load provider/model data from prefs. Called once on first access. */
  private loadFromPrefs(): void {
    // Start with presets as baseline
    this.providers = PRESET_PROVIDERS.map((p) => ({ ...p }));

    // Merge user-customized providers from prefs (only non-preset or modified presets)
    try {
      const raw = getPrefDynamic("ai.providers");
      let parsed: any[];
      if (Array.isArray(raw)) {
        parsed = raw;
      } else if (typeof raw === "string" && raw) {
        parsed = JSON.parse(raw);
      } else {
        parsed = [];
      }
      if (Array.isArray(parsed)) {
        const userProviders = parsed.filter(isValidProvider);
        for (const up of userProviders) {
          const idx = this.providers.findIndex((p) => p.id === up.id);
          if (idx >= 0) {
            // Override preset with user's version (user may have edited name/url/key)
            this.providers[idx] = up;
          } else {
            // User-added provider
            this.providers.push(up);
          }
        }
      }
      // Hydrate API keys from the keychain — the canonical store since the
      // secrets migration; the prefs JSON carries apiKey:"" placeholders.
      // Keychain wins when both exist (migration clears prefs only after
      // verifying the keychain copy). Pre-migration users still read the
      // prefs copy until the one-time move runs.
      for (const p of this.providers) {
        if (!p.apiKey) {
          const fromKeychain = getSecret(providerSecretKey(p.id));
          if (fromKeychain) p.apiKey = fromKeychain;
        }
      }
    } catch (e) {
      safeDebug("[z-search] " + e);
      // Keep presets as fallback
    }

    // Load models
    try {
      const raw = getPrefDynamic("ai.models");
      let parsed: any[];
      if (Array.isArray(raw)) {
        parsed = raw;
      } else if (typeof raw === "string" && raw) {
        parsed = JSON.parse(raw);
      } else {
        parsed = [];
      }
      if (Array.isArray(parsed)) {
        this.models = parsed.filter(isValidModel);
        // Migrate old maxTokens → contextWindow; infer capabilities for legacy models
        let needsSave = false;
        for (const model of this.models) {
          if (
            (model as any).maxTokens !== undefined &&
            model.contextWindow === undefined
          ) {
            model.contextWindow = (model as any).maxTokens;
            delete (model as any).maxTokens;
            needsSave = true;
          }
          if (!model.capabilities) {
            model.capabilities = [];
            needsSave = true;
          }
        }
        if (needsSave) this.saveModels();
      }
    } catch (e) {
      safeDebug("[z-search] " + e);
      this.models = [];
    }
  }

  // ==================== Provider CRUD ====================

  getAllProviders(): ProviderConfig[] {
    this.ensurePrefsLoaded();
    return [...this.providers];
  }

  getProvider(providerId: string): ProviderConfig | null {
    this.ensurePrefsLoaded();
    return this.providers.find((p) => p.id === providerId) || null;
  }

  addProvider(provider: ProviderConfig): void {
    this.ensurePrefsLoaded();
    this.providers.push(provider);
    this.saveProviders();
  }

  updateProvider(provider: ProviderConfig): void {
    this.ensurePrefsLoaded();
    const idx = this.providers.findIndex((p) => p.id === provider.id);
    if (idx >= 0) {
      this.providers[idx] = provider;
      this.saveProviders();
      this.invalidateRegistryCache();
    }
  }

  removeProvider(providerId: string): void {
    this.ensurePrefsLoaded();
    // Cascade: remove all models belonging to this provider
    const modelIdsToRemove = this.models
      .filter((m) => m.providerId === providerId)
      .map((m) => [m.id, m.modelId] as const)
      .flat();
    this.models = this.models.filter((m) => m.providerId !== providerId);
    this.providers = this.providers.filter((p) => p.id !== providerId);

    // Drop the provider's keychain secret too (fire-and-forget; a leftover
    // entry would be dead weight, not a resurrection risk — but clean is clean).
    void deleteSecret(providerSecretKey(providerId));

    // Reset feature assignments that reference deleted models
    const features = Object.keys(AI_FEATURE_MAP);
    for (const feature of features) {
      const currentModelId = String(
        getPrefDynamic(`ai.selection.${feature}`) || "",
      );
      if (modelIdsToRemove.includes(currentModelId)) {
        setPrefDynamic(`ai.selection.${feature}`, "");
      }
    }

    this.saveProviders();
    this.saveModels();
    this.invalidateRegistryCache();
  }

  private saveProviders(): void {
    // Only persist user-customized providers (non-preset or modified presets)
    const presetMap = new Map(PRESET_PROVIDERS.map((p) => [p.id, p]));
    const toSave = this.providers.filter((p) => {
      const preset = presetMap.get(p.id);
      if (!preset) return true; // User-added provider
      // Preset modified by user (name, baseUrl, apiKey, adapter, or authMode
      // changed — e.g. google flipped to google_auth by OAuth login)
      return (
        p.name !== preset.name ||
        p.baseUrl !== preset.baseUrl ||
        p.apiKey !== preset.apiKey ||
        p.adapter !== preset.adapter ||
        (p.authMode || "api_key") !== (preset.authMode || "api_key")
      );
    });
    // Secrets live in the keychain, never in the prefs JSON (blanked below);
    // the in-memory providers keep the real key for the running session.
    // First-ever keychain write is async (addLoginAsync) — acceptable, keys
    // are only read back after startup, never within this call.
    for (const p of toSave) {
      if (p.apiKey) {
        void setSecret(providerSecretKey(p.id), p.apiKey);
      } else {
        // User cleared the key — drop the stored copy so a later load can't
        // resurrect it from the keychain.
        void deleteSecret(providerSecretKey(p.id));
      }
    }
    setPrefDynamic(
      "ai.providers",
      JSON.stringify(toSave.map((p) => ({ ...p, apiKey: "" }))),
    );
  }

  // ==================== Model CRUD ====================

  getAllModels(): ModelConfig[] {
    this.ensurePrefsLoaded();
    return [...this.models];
  }

  getModelsByProvider(providerId: string): ModelConfig[] {
    this.ensurePrefsLoaded();
    return this.models.filter((m) => m.providerId === providerId);
  }

  getModel(modelId: string): ModelConfig | null {
    this.ensurePrefsLoaded();
    return this.models.find((m) => m.id === modelId) || null;
  }

  addModel(model: ModelConfig): void {
    this.ensurePrefsLoaded();
    this.models.push(model);
    this.saveModels();
    // Keep AIProviderRegistry caches honest for direct addModel callers
    // (wizard flow only stays fresh by accident — setFeatureModel after
    // addModel happens to invalidate; a bare addModel left stale entries).
    this.invalidateRegistryCache();
  }

  updateModel(model: ModelConfig): void {
    this.ensurePrefsLoaded();
    const idx = this.models.findIndex((m) => m.id === model.id);
    if (idx >= 0) {
      this.models[idx] = model;
      this.saveModels();
      this.invalidateRegistryCache();
    }
  }

  removeModel(modelId: string): void {
    this.ensurePrefsLoaded();
    const removed = this.models.find((m) => m.id === modelId);
    this.models = this.models.filter((m) => m.id !== modelId);

    // Reset feature assignments that reference this model (check both id and modelId)
    const features = Object.keys(AI_FEATURE_MAP);
    for (const feature of features) {
      const currentModelId = String(
        getPrefDynamic(`ai.selection.${feature}`) || "",
      );
      if (
        removed &&
        (currentModelId === removed.id || currentModelId === removed.modelId)
      ) {
        setPrefDynamic(`ai.selection.${feature}`, "");
      }
    }

    this.saveModels();
    this.invalidateRegistryCache();
  }

  private saveModels(): void {
    setPrefDynamic("ai.models", JSON.stringify(this.models));
  }

  // ==================== Feature Assignment ====================

  /** Get the model ID assigned to a feature */
  getModelForFeature(feature: AIFeature): string {
    this.ensurePrefsLoaded();
    return String(getPrefDynamic(`ai.selection.${feature}`) || "");
  }

  /** Set the model ID for a feature */
  setModelForFeature(feature: AIFeature, modelId: string): void {
    setPrefDynamic(`ai.selection.${feature}`, modelId);
    this.invalidateRegistryCache();
  }

  /**
   * Get models for a capability with a `verified` flag describing whether the
   * result is the genuinely-capable set or a fallback guess:
   *  - capable models found → { models: <capable>, verified: true }
   *  - none capable (non-embedding) → { models: <ALL models>, verified: false }
   *  - embedding NEVER falls back (own source config) → always verified: true
   *
   * Single source of truth for the rule; `getModelsByCapability` delegates here.
   */
  getModelsByCapabilityFlagged(feature: AIFeature): {
    models: ModelConfig[];
    verified: boolean;
  } {
    this.ensurePrefsLoaded();
    const capable = this.models.filter((m) =>
      m.capabilities?.includes(feature),
    );
    if (feature === "embedding") return { models: capable, verified: true };
    return capable.length > 0
      ? { models: capable, verified: true }
      : { models: this.models, verified: false };
  }

  /** Get models that declare a specific capability. Falls back to all models if none match (except embedding, which has its own source config). */
  getModelsByCapability(feature: AIFeature): ModelConfig[] {
    return this.getModelsByCapabilityFlagged(feature).models;
  }

  // ==================== Unified Config for AIProviderRegistry ====================

  /** Get full config for a model (model + provider) */
  getModelFullConfig(
    modelId: string,
  ): { model: ModelConfig; provider: ProviderConfig } | null {
    this.ensurePrefsLoaded();
    const model = this.models.find(
      (m) => m.id === modelId || m.modelId === modelId,
    );
    if (!model) return null;

    const provider = this.providers.find((p) => p.id === model.providerId);
    if (!provider) return null;

    return { model, provider };
  }

  /** Invalidate AIProviderRegistry cache */
  private invalidateRegistryCache(): void {
    // Lazy import to avoid circular dependency (AIProviderRegistry imports ConfigManager).
    // Uses dynamic import cached on _globalThis for synchronous-style usage.
    try {
      const registry = (_globalThis as any).__zsearchRegistry;
      if (registry?.invalidateAll) {
        registry.invalidateAll();
      }
    } catch (e) {
      safeDebug("[z-search] " + e); /* best-effort */
    }
  }
}

function isValidProvider(p: any): p is ProviderConfig {
  return (
    p &&
    typeof p === "object" &&
    typeof p.id === "string" &&
    typeof p.name === "string" &&
    typeof p.adapter === "string" &&
    typeof p.baseUrl === "string" &&
    typeof p.apiKey === "string"
  );
}

function isValidModel(m: any): m is ModelConfig {
  return (
    m &&
    typeof m === "object" &&
    typeof m.id === "string" &&
    typeof m.name === "string" &&
    typeof m.modelId === "string" &&
    typeof m.providerId === "string" &&
    typeof m.temperature === "number" &&
    typeof m.contextWindow === "number"
  );
}

const ConfigManager = new ConfigManagerClass();

export default ConfigManager;
export { ConfigManagerClass };
