/**
 * Dynamic Provider/Model Configuration Types
 *
 * Three-tier architecture: Provider (connection) -> Model (params) -> Feature Assignment
 */

/** Adapter format for Vercel AI SDK */
export type AdapterType = "openai" | "anthropic" | "google";

/** Authentication mode for providers */
export type AuthMode =
  "api_key" | "copilot_auth" | "codex_auth" | "google_auth";

/** Wire protocol override for openai-adapter providers. */
export type ProtocolType = "auto" | "openai-chat" | "openai-responses";

/** Default model parameters per provider */
export interface ProviderDefaultParams {
  temperature: number;
  contextWindow: number;
  maxOutputTokens?: number;
}

/** Provider configuration (connection-level) */
export interface ProviderConfig {
  id: string;
  name: string;
  adapter: AdapterType;
  baseUrl: string;
  apiKey: string;
  isPreset: boolean;
  /** Whether the provider supports strict JSON schema mode (response_format json_schema with strict:true). Default false. */
  structuredOutputs?: boolean;
  /** Timestamp of last successful connection test. 0 = never tested. */
  testedAt?: number;
  /** Authentication mode. Default "api_key". */
  authMode?: AuthMode;
  /** Recommended model IDs for quick selection (preset providers only) */
  recommendedModels?: string[];
  /** Default model parameters (preset providers only) */
  defaultParams?: ProviderDefaultParams;
  /** Wire protocol override for openai-adapter providers.
   *  "auto"              = current behavior (codex_auth → responses, api_key → chat).
   *  "openai-chat"       = force Chat Completions API.
   *  "openai-responses"  = force Responses API. */
  protocol?: ProtocolType;
}

/** Model configuration (linked to a provider) */
export interface ModelConfig {
  id: string;
  name: string;
  modelId: string;
  providerId: string;
  temperature: number;
  contextWindow: number;
  thinkingEnabled: boolean;
  /** Maximum output tokens per response */
  maxOutputTokens?: number;
  /** Capabilities: which AI features this model can serve (values from AIFeature) */
  capabilities?: string[];
}

/** Preset providers (pre-populated on first use) */
export const PRESET_PROVIDERS: ProviderConfig[] = [
  // ===== International =====
  {
    id: "openai",
    name: "OpenAI",
    adapter: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    isPreset: true,
    structuredOutputs: true,
    recommendedModels: ["gpt-4o", "gpt-4o-mini", "o3-mini", "gpt-4-turbo"],
    defaultParams: {
      temperature: 0.7,
      contextWindow: 128000,
      maxOutputTokens: 16384,
    },
  },
  {
    id: "anthropic",
    name: "Anthropic (Claude)",
    adapter: "anthropic",
    baseUrl: "https://api.anthropic.com",
    apiKey: "",
    isPreset: true,
    recommendedModels: [
      "claude-sonnet-4-6",
      "claude-opus-4-6",
      "claude-haiku-4-5",
    ],
    defaultParams: {
      temperature: 0.7,
      contextWindow: 200000,
      maxOutputTokens: 8192,
    },
  },
  {
    id: "google",
    name: "Google Gemini",
    adapter: "google",
    baseUrl: "https://generativelanguage.googleapis.com",
    apiKey: "",
    isPreset: true,
    recommendedModels: [
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      "gemini-2.0-flash",
    ],
    defaultParams: {
      temperature: 0.7,
      contextWindow: 1048576,
      maxOutputTokens: 8192,
    },
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    adapter: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey: "",
    isPreset: true,
    defaultParams: { temperature: 0.7, contextWindow: 128000 },
  },
  {
    id: "orcarouter",
    name: "OrcaRouter",
    adapter: "openai",
    baseUrl: "https://api.orcarouter.ai/v1",
    apiKey: "",
    isPreset: true,
    recommendedModels: [
      "orcarouter/auto",
      "openai/gpt-5",
      "anthropic/claude-sonnet-4.6",
      "google/gemini-2.5-pro",
      "z-ai/glm-4.6",
      "deepseek/deepseek-chat",
    ],
    defaultParams: { temperature: 0.7, contextWindow: 128000 },
  },
  {
    id: "huggingface",
    name: "HuggingFace",
    adapter: "openai",
    baseUrl: "https://router.huggingface.co/v1",
    apiKey: "",
    isPreset: true,
    recommendedModels: [
      "deepseek-ai/DeepSeek-V3-0324",
      "meta-llama/Llama-3.3-70B-Instruct",
      "Qwen/Qwen3-235B-A22B",
      "openai/gpt-oss-120b",
    ],
    defaultParams: {
      temperature: 0.7,
      contextWindow: 128000,
      maxOutputTokens: 8192,
    },
  },
  {
    id: "mistral",
    name: "Mistral AI",
    adapter: "openai",
    baseUrl: "https://api.mistral.ai/v1",
    apiKey: "",
    isPreset: true,
    recommendedModels: [
      "mistral-large-latest",
      "mistral-medium-latest",
      "codestral-latest",
    ],
    defaultParams: {
      temperature: 0.7,
      contextWindow: 128000,
      maxOutputTokens: 4096,
    },
  },
  {
    id: "groq",
    name: "Groq",
    adapter: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    apiKey: "",
    isPreset: true,
    recommendedModels: [
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "mixtral-8x7b-32768",
    ],
    defaultParams: { temperature: 0.7, contextWindow: 131072 },
  },
  {
    id: "together",
    name: "Together AI",
    adapter: "openai",
    baseUrl: "https://api.together.xyz/v1",
    apiKey: "",
    isPreset: true,
    defaultParams: { temperature: 0.7, contextWindow: 128000 },
  },
  {
    id: "xai",
    name: "xAI (Grok)",
    adapter: "openai",
    baseUrl: "https://api.x.ai/v1",
    apiKey: "",
    isPreset: true,
    recommendedModels: ["grok-3", "grok-3-mini"],
    defaultParams: { temperature: 0.7, contextWindow: 131072 },
  },
  {
    id: "perplexity",
    name: "Perplexity",
    adapter: "openai",
    baseUrl: "https://api.perplexity.ai",
    apiKey: "",
    isPreset: true,
    recommendedModels: ["sonar-pro", "sonar-reasoning", "sonar"],
    defaultParams: { temperature: 0.7, contextWindow: 200000 },
  },
  {
    id: "deepinfra",
    name: "DeepInfra",
    adapter: "openai",
    baseUrl: "https://api.deepinfra.com/v1/openai",
    apiKey: "",
    isPreset: true,
    defaultParams: { temperature: 0.7, contextWindow: 128000 },
  },
  {
    id: "fireworks",
    name: "Fireworks AI",
    adapter: "openai",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    apiKey: "",
    isPreset: true,
    defaultParams: { temperature: 0.7, contextWindow: 128000 },
  },

  // ===== China =====
  {
    id: "zhipu",
    name: "Z.ai",
    adapter: "openai",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    apiKey: "",
    isPreset: true,
    recommendedModels: [
      "glm-4-plus",
      "glm-4-flash",
      "glm-4-long",
      "glm-4v-plus",
    ],
    defaultParams: { temperature: 0.7, contextWindow: 128000 },
  },
  {
    id: "glmcoding",
    name: "Z.ai Coding",
    adapter: "openai",
    baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
    apiKey: "",
    isPreset: true,
    recommendedModels: ["glm-4-plus", "glm-4-flash"],
    defaultParams: { temperature: 0.7, contextWindow: 128000 },
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    adapter: "openai",
    baseUrl: "https://api.deepseek.com",
    apiKey: "",
    isPreset: true,
    recommendedModels: ["deepseek-chat", "deepseek-reasoner"],
    defaultParams: { temperature: 0.7, contextWindow: 65536 },
  },
  {
    id: "qwen",
    name: "Qwen",
    adapter: "openai",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKey: "",
    isPreset: true,
    recommendedModels: ["qwen-max", "qwen-plus", "qwen-turbo", "qwen-long"],
    defaultParams: { temperature: 0.7, contextWindow: 131072 },
  },
  {
    id: "moonshot",
    name: "Moonshot (Kimi)",
    adapter: "openai",
    baseUrl: "https://api.moonshot.cn/v1",
    apiKey: "",
    isPreset: true,
    recommendedModels: [
      "moonshot-v1-8k",
      "moonshot-v1-32k",
      "moonshot-v1-128k",
    ],
    defaultParams: { temperature: 0.7, contextWindow: 131072 },
  },
  {
    id: "minimax",
    name: "MiniMax",
    adapter: "openai",
    baseUrl: "https://api.minimax.chat/v1",
    apiKey: "",
    isPreset: true,
    recommendedModels: ["MiniMax-Text-01", "abab6.5s-chat"],
    defaultParams: { temperature: 0.7, contextWindow: 245000 },
  },
  {
    id: "stepfun",
    name: "StepFun",
    adapter: "openai",
    baseUrl: "https://api.stepfun.com/v1",
    apiKey: "",
    isPreset: true,
    // 2026-09 核实：step-2-16k/step-1-8k 已于 2026-07-08 下线（官方迁移档），
    // 现行旗舰=step-3.7-flash（多模态推理）、step-3.5-flash（高速+工具调用）。
    recommendedModels: ["step-3.7-flash", "step-3.5-flash"],
    defaultParams: { temperature: 0.7, contextWindow: 131072 },
  },
  {
    id: "siliconflow",
    name: "SiliconFlow",
    adapter: "openai",
    baseUrl: "https://api.siliconflow.cn/v1",
    apiKey: "",
    isPreset: true,
    defaultParams: { temperature: 0.7, contextWindow: 32768 },
  },
  {
    id: "baichuan",
    name: "Baichuan",
    adapter: "openai",
    baseUrl: "https://api.baichuan-ai.com/v1",
    apiKey: "",
    isPreset: true,
    recommendedModels: ["Baichuan4", "Baichuan3-Turbo"],
    defaultParams: { temperature: 0.7, contextWindow: 131072 },
  },
  {
    id: "yi",
    name: "Yi",
    adapter: "openai",
    baseUrl: "https://api.lingyiwanwu.com/v1",
    apiKey: "",
    isPreset: true,
    recommendedModels: ["yi-lightning", "yi-large"],
    defaultParams: { temperature: 0.7, contextWindow: 32768 },
  },
  {
    id: "spark",
    name: "Spark",
    adapter: "openai",
    baseUrl: "https://spark-api-open.xf-yun.com/v1",
    apiKey: "",
    isPreset: true,
    recommendedModels: ["generalv3.5", "4.0Ultra"],
    defaultParams: { temperature: 0.7, contextWindow: 32768 },
  },
  {
    id: "modelscope",
    name: "ModelScope",
    adapter: "openai",
    baseUrl: "https://api-inference.modelscope.cn/v1",
    apiKey: "",
    isPreset: true,
    defaultParams: { temperature: 0.7, contextWindow: 32768 },
  },

  // ===== Local =====
  {
    id: "ollama",
    name: "Ollama",
    adapter: "openai",
    baseUrl: "http://localhost:11434/v1",
    apiKey: "ollama",
    isPreset: true,
    defaultParams: { temperature: 0.7, contextWindow: 8192 },
  },
  {
    id: "vllm",
    name: "vLLM",
    adapter: "openai",
    baseUrl: "http://localhost:8000/v1",
    apiKey: "",
    isPreset: true,
    defaultParams: { temperature: 0.7, contextWindow: 4096 },
  },
  {
    id: "lmstudio",
    name: "LM Studio",
    adapter: "openai",
    baseUrl: "http://localhost:1234/v1",
    apiKey: "",
    isPreset: true,
    defaultParams: { temperature: 0.7, contextWindow: 4096 },
  },

  // ===== OAuth / Special Auth =====
  {
    id: "copilot",
    name: "GitHub Copilot",
    adapter: "openai",
    baseUrl: "https://api.githubcopilot.com",
    apiKey: "",
    isPreset: true,
    authMode: "copilot_auth",
    recommendedModels: [
      "gpt-4o",
      "claude-sonnet-4-6",
      "o3-mini",
      "gpt-4o-mini",
    ],
    defaultParams: { temperature: 0.7, contextWindow: 128000 },
  },
  {
    id: "codex",
    name: "Codex (ChatGPT)",
    adapter: "openai",
    baseUrl: "https://chatgpt.com/backend-api/codex",
    apiKey: "",
    isPreset: true,
    authMode: "codex_auth",
    recommendedModels: ["codex-mini", "o3-mini", "gpt-4o"],
    defaultParams: { temperature: 0.7, contextWindow: 200000 },
  },
];

/** Adapter display names */
export const ADAPTER_NAMES: Record<AdapterType, string> = {
  openai: "OpenAI Compatible",
  anthropic: "Anthropic",
  google: "Google",
};

/** Generate unique ID for user-added providers/models */
export function generateProviderId(): string {
  return `provider_${Date.now()}`;
}

export function generateModelId(): string {
  return `model_${Date.now()}`;
}
