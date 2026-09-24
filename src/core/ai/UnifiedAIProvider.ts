import { ZoteroFetch } from "./ZoteroFetch";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import {
  generateObject,
  embed,
  LanguageModel,
  type ModelMessage,
  streamText,
  wrapLanguageModel,
  pruneMessages,
  isStepCount,
} from "ai";
import { jsonSchema } from "@ai-sdk/provider-utils";
import { createJsonCompatMiddleware } from "./JsonCompatMiddleware";
import { createXhrWireMiddleware } from "./XhrWireMiddleware";
import { createUsageAccountingIntegration } from "./TelemetryAccounting";
import { z } from "zod";

import { getPref } from "../../utils/prefs";
import { ZSEARCH_HTTP_HEADERS } from "../../utils/httpHeaders";
import ConfigManager from "../../utils/config/ConfigManager";
import type {
  IAIProvider,
  AIRequest,
  AIResponse,
  AIModel,
  AIToolCall,
  AIUsage,
} from "../../types/ai";
import * as CopilotAuth from "../../core/auth/CopilotAuth";
import * as CodexAuth from "../../core/auth/CodexAuth";
import * as GoogleAuth from "../../core/auth/GoogleAuth";
import { safeDebug } from "../../utils/logger";

export class UnifiedAIProvider implements IAIProvider {
  readonly id: string;
  readonly name: string;
  readonly supportedModels: AIModel[] = [];
  configured = false;

  private apiKey = "";
  private baseUrl = "";
  private model = "";
  private providerType: "openai" | "anthropic" | "google" | "custom";
  private languageModel: LanguageModel | null = null;
  private languageModelOverrides = new Map<string, LanguageModel>();
  private zoteroFetch = new ZoteroFetch();
  /** AbortControllers for in-flight execute() calls. Using a Set prevents
   *  race conditions when chat + research share the same cached provider instance. */
  private activeAbortSignals = new Set<AbortController>();
  /** Authentication mode: "api_key", "copilot_auth", "codex_auth", or "google_auth" */
  private currentAuthMode: string = "api_key";
  /** Wire protocol override: "auto" | "openai-chat" | "openai-responses".
   *  Only meaningful for openai-adapter providers. */
  private protocol: string = "auto";

  // Model-level parameters (set by AIProviderRegistry)
  modelTemperature: number = 0.7;
  modelContextWindow: number = 128000;
  modelThinkingEnabled: boolean = false;
  modelThinkingModel: string = "";
  /** Maximum output tokens per response (0 = not configured, use model default). */
  modelMaxOutputTokens: number = 0;
  /** Provider-configured hint that native structured outputs are supported.
   *  Informative since the gateway switch: OpenAI hosts use the official
   *  provider (native structured outputs); gateways get the schema injected
   *  via JsonCompatMiddleware regardless of this flag. */
  structuredOutputs: boolean = false;

  /** Get the model's configured maximum output tokens (0 = use model default). */
  getMaxOutputTokens(): number {
    return this.modelMaxOutputTokens;
  }

  /** Get the model's context window size (for compact/compression threshold). */
  getContextWindow(): number {
    if (this.modelContextWindow > 0) return this.modelContextWindow;
    // Fallback: user preference or default
    return (getPref("ai.model.maxContext") as number) ?? 128000;
  }

  /** Abort all in-flight requests (real XHR abort via AbortController).
   *  Called by AgentEngine.cancelExecution(). Streams finish gracefully with
   *  partial content — the middleware preserves that legacy contract. */
  abort(): void {
    for (const c of this.activeAbortSignals) c.abort();
    this.activeAbortSignals = new Set();
  }

  destroy(): void {
    this.activeAbortSignals = new Set();
    this.languageModelOverrides.clear();
  }

  constructor(config: {
    id: string;
    name: string;
    providerType: "openai" | "anthropic" | "google" | "custom";
    models: AIModel[];
    defaultBaseUrl?: string;
  }) {
    this.id = config.id;
    this.name = config.name;
    this.providerType = config.providerType;
    this.supportedModels = config.models;
    this.baseUrl = config.defaultBaseUrl || "";
  }

  /**
   * Configure the provider with API keys and settings
   * Uses priority: 1. config param, 2. prefs, 3. external config, 4. env vars
   */
  async configure(config: Record<string, string>): Promise<void> {
    // Priority 1: Explicit config parameter — strip non-ASCII to prevent Headers.append ByteString error
    this.apiKey = (config.apiKey || "").replace(/[^\x20-\x7E]/g, "");

    // If not provided, try resolving from ConfigManager
    if (!this.apiKey) {
      const fullConfig = ConfigManager.getModelFullConfig(
        this.id.replace("model:", ""),
      );
      if (fullConfig) {
        this.apiKey = (fullConfig.provider.apiKey || "").replace(
          /[^\x20-\x7E]/g,
          "",
        );
        this.baseUrl = fullConfig.provider.baseUrl;
      }
    }

    this.configured = !!this.apiKey;
    this.languageModel = this.createLanguageModel();
  }

  /**
   * Synchronous configure — used by getProviderForModel with explicit values
   */
  configureSync(config: Record<string, string>): void {
    this.apiKey = (config.apiKey || "").replace(/[^\x20-\x7E]/g, "");
    this.baseUrl = config.baseUrl || this.baseUrl;
    this.model = config.model || "";
    this.currentAuthMode = config.authMode || "api_key";
    this.protocol = config.protocol || "auto";

    // OAuth providers are "configured" even without apiKey (token obtained dynamically)
    this.configured = !!this.apiKey || this.currentAuthMode !== "api_key";
    this.languageModel = this.createLanguageModel();
  }

  /**
   * Create a fetch wrapper that injects auth-specific headers dynamically.
   * Used for Copilot (JWT) and Codex (access_token) providers where
   * createOpenAI's static `headers` parameter is insufficient.
   */
  private createAuthFetch(authMode: string): typeof fetch {
    const baseFetch = this.zoteroFetch.fetch.bind(this.zoteroFetch) as (
      input: string | URL | Request,
      init?: RequestInit,
    ) => Promise<Response>;

    if (authMode === "copilot_auth") {
      return (async (input: any, init: any = {}) => {
        const jwt = await CopilotAuth.getValidJwt();
        const copilotHeaders = CopilotAuth.buildCopilotHeaders(jwt);
        return baseFetch(input, {
          ...init,
          headers: { ...(init.headers || {}), ...copilotHeaders },
        });
      }) as any;
    }

    if (authMode === "codex_auth") {
      return (async (input: any, init: any = {}) => {
        const token = await CodexAuth.getValidAccessToken();
        return baseFetch(input, {
          ...init,
          headers: {
            ...(init.headers || {}),
            Authorization: `Bearer ${token}`,
          },
        });
      }) as any;
    }

    if (authMode === "google_auth") {
      return (async (input: any, init: any = {}) => {
        const token = await GoogleAuth.getValidAccessToken();
        const headers: Record<string, string> = { ...(init.headers || {}) };
        // The google adapter sends x-goog-api-key; OAuth goes via Bearer.
        delete headers["x-goog-api-key"];
        headers.Authorization = `Bearer ${token}`;
        return baseFetch(input, { ...init, headers });
      }) as any;
    }

    return baseFetch as any;
  }

  private createLanguageModel(): LanguageModel {
    // Use auth-aware fetch wrapper for OAuth providers (SDK generate paths,
    // e.g. google/codex generateObject; streaming goes through the middleware)
    const fetchFn =
      this.currentAuthMode !== "api_key"
        ? (this.createAuthFetch(this.currentAuthMode) as (
            input: string | URL | Request,
            init?: RequestInit,
          ) => Promise<Response>)
        : (this.zoteroFetch.fetch.bind(this.zoteroFetch) as (
            input: string | URL | Request,
            init?: RequestInit,
          ) => Promise<Response>);

    // Per-request auth headers for the XHR wire middleware (OAuth tokens are
    // dynamic — resolved at call time, same trick as createAuthFetch).
    const wireHeaders = async (): Promise<Record<string, string>> => {
      switch (this.currentAuthMode) {
        case "copilot_auth": {
          const jwt = await CopilotAuth.getValidJwt();
          return {
            ...ZSEARCH_HTTP_HEADERS,
            ...CopilotAuth.buildCopilotHeaders(jwt),
          };
        }
        case "codex_auth":
          return {
            ...ZSEARCH_HTTP_HEADERS,
            Authorization: `Bearer ${await CodexAuth.getValidAccessToken()}`,
          };
        case "google_auth":
          return {
            ...ZSEARCH_HTTP_HEADERS,
            Authorization: `Bearer ${await GoogleAuth.getValidAccessToken()}`,
          };
        default:
          return { ...ZSEARCH_HTTP_HEADERS };
      }
    };

    switch (this.providerType) {
      case "openai": {
        // Protocol override: resolve wire/sdk/url from `this.protocol` first,
        // then fall back to the auth/host-driven default.
        const resolved = this.resolveOpenAIProtocol();
        const { wire, model: sdkModel, url } = resolved;

        if (wire === "openai-responses") {
          // Responses API: requires the official OpenAI provider (responses()
          // method not available on OpenAICompatibleProvider).
          const base = this.baseUrl || "https://chatgpt.com/backend-api/codex";
          const openaiProvider = createOpenAI({
            apiKey: this.apiKey || "dummy",
            baseURL: base,
            fetch: fetchFn,
          });
          return wrapLanguageModel({
            model: openaiProvider.responses(sdkModel),
            middleware: createXhrWireMiddleware({
              wire: "openai-responses",
              url,
              modelId: this.model,
              getHeaders: async () => ({
                ...ZSEARCH_HTTP_HEADERS,
                Authorization: `Bearer ${await CodexAuth.getValidAccessToken()}`,
              }),
            }),
          });
        }

        // openai-chat: official provider for api.openai.com, compatibility
        // provider for third-party gateways.
        if (resolved.useOpenAICompatible) {
          const gatewayProvider = createOpenAICompatible({
            name: "leadero-gateway",
            apiKey: this.apiKey,
            baseURL: this.baseUrl,
            fetch: fetchFn,
            includeUsage: true,
          });
          return wrapLanguageModel({
            model: gatewayProvider.chatModel(sdkModel),
            middleware: [
              createJsonCompatMiddleware(),
              createXhrWireMiddleware({
                wire: "openai-chat",
                url,
                modelId: this.model,
                getHeaders: async () => ({
                  ...ZSEARCH_HTTP_HEADERS,
                  Authorization: `Bearer ${this.apiKey}`,
                }),
              }),
            ],
          });
        }

        const openaiProvider = createOpenAI({
          apiKey: this.apiKey,
          baseURL: this.baseUrl || undefined,
          fetch: fetchFn,
        });
        return wrapLanguageModel({
          model: openaiProvider.chat(sdkModel),
          middleware: createXhrWireMiddleware({
            wire: "openai-chat",
            url,
            modelId: this.model,
            getHeaders: wireHeaders,
          }),
        });
      }

      case "anthropic": {
        const base = this.baseUrl || "https://api.anthropic.com";
        return wrapLanguageModel({
          model: createAnthropic({
            apiKey: this.apiKey,
            baseURL: this.baseUrl || undefined,
            fetch: fetchFn,
          })(this.model),
          middleware: createXhrWireMiddleware({
            wire: "anthropic-messages",
            url: `${base}/v1/messages`,
            modelId: this.model,
            getHeaders: async () => ({
              ...ZSEARCH_HTTP_HEADERS,
              "x-api-key": this.apiKey,
              "anthropic-version": "2023-06-01",
              "anthropic-dangerous-direct-browser-access": "true",
            }),
          }),
        });
      }

      case "google": {
        // Mirror the official provider's URL composition: it appends /v1beta
        // unless the base URL already ends with it.
        const base = (
          this.baseUrl || "https://generativelanguage.googleapis.com"
        ).replace(/\/?v1beta\/?$/, "");
        return wrapLanguageModel({
          model: createGoogleGenerativeAI({
            // OAuth mode has no key; pass a dummy so the SDK constructs while
            // the fetch wrapper swaps auth to Bearer (same trick as Codex).
            apiKey:
              this.currentAuthMode === "google_auth" && !this.apiKey
                ? "dummy"
                : this.apiKey,
            baseURL: this.baseUrl || undefined,
            fetch: fetchFn,
          })(this.model),
          middleware: createXhrWireMiddleware({
            wire: "google-generateContent",
            url: `${base}/v1beta/models/${this.model}:streamGenerateContent?alt=sse`,
            modelId: this.model,
            getHeaders: async () =>
              this.currentAuthMode === "google_auth"
                ? {
                    ...ZSEARCH_HTTP_HEADERS,
                    Authorization: `Bearer ${await GoogleAuth.getValidAccessToken()}`,
                  }
                : { ...ZSEARCH_HTTP_HEADERS, "x-goog-api-key": this.apiKey },
          }),
        });
      }

      default:
        throw new Error(`Unsupported provider type: ${this.providerType}`);
    }
  }

  /** Resolve the wire protocol, SDK model call, and endpoint URL for the
   *  openai-adapter branch. Encapsulates the "auto" default (codex_auth →
   *  responses, api_key → chat) so createLanguageModel stays declarative. */
  private resolveOpenAIProtocol(): {
    wire: "openai-chat" | "openai-responses";
    model: string;
    url: string;
    useOpenAICompatible: boolean;
  } {
    const explicit = this.protocol;

    if (explicit === "openai-responses") {
      return {
        wire: "openai-responses",
        model: this.model,
        url: `${this.baseUrl || "https://chatgpt.com/backend-api/codex"}/responses`,
        useOpenAICompatible: false,
      };
    }

    if (explicit === "openai-chat") {
      const isOpenAIHost =
        !this.baseUrl || /^https:\/\/api\.openai\.com/.test(this.baseUrl);
      return {
        wire: "openai-chat",
        model: this.model,
        url: `${this.baseUrl || "https://api.openai.com/v1"}/chat/completions`,
        useOpenAICompatible:
          this.currentAuthMode === "api_key" && !isOpenAIHost,
      };
    }

    // "auto" — current behavior before this field existed.
    if (this.currentAuthMode === "codex_auth") {
      const base = this.baseUrl || "https://chatgpt.com/backend-api/codex";
      return {
        wire: "openai-responses",
        model: this.model,
        url: `${base}/responses`,
        useOpenAICompatible: false,
      };
    }

    const isOpenAIHost =
      !this.baseUrl || /^https:\/\/api\.openai\.com/.test(this.baseUrl);
    return {
      wire: "openai-chat",
      model: this.model,
      url: `${this.baseUrl || "https://api.openai.com/v1"}/chat/completions`,
      useOpenAICompatible: this.currentAuthMode === "api_key" && !isOpenAIHost,
    };
  }

  /**
   * Get language model, honoring request.model override (e.g. for thinking mode).
   * Caches overridden models to avoid re-creating on every call.
   */
  private getModelForRequest(request: AIRequest): LanguageModel {
    const overrideModel = (request as any).model as string | undefined;
    if (!overrideModel || overrideModel === this.model) {
      return this.languageModel!;
    }
    let cached = this.languageModelOverrides.get(overrideModel);
    if (!cached) {
      const savedModel = this.model;
      this.model = overrideModel;
      cached = this.createLanguageModel();
      this.model = savedModel;
      this.languageModelOverrides.set(overrideModel, cached);
    }
    return cached;
  }

  async execute(request: AIRequest): Promise<AIResponse> {
    if (!this.languageModel) {
      throw new Error(
        `${this.name} provider not configured. Call configure() first.`,
      );
    }

    if (!this.apiKey && this.currentAuthMode === "api_key") {
      const e = new Error(
        `${this.name} API key not configured. Please add an API key in Zotero Preferences → Leadero → AI Models.`,
      );
      (e as any).code = "API_KEY_MISSING";
      throw e;
    }

    {
      // 原 try/catch 的 catch 仅原样重抛（no-op，no-useless-catch 移除）；错误传播由 RequestQueue/引擎层负责
      // Convert tools to Vercel AI SDK format (Record<string, CoreTool>)
      const tools: Record<string, any> = {};
      if (request.tools) {
        for (const tool of request.tools) {
          const toolName = tool.function.name;
          const schema =
            tool.function.inputSchema || tool.function.parameters || {};
          tools[toolName] = {
            description: tool.function.description,
            inputSchema: jsonSchema(schema as any),
            // Native execution rides along only when attached (multi-step
            // pilot). Legacy single-step tools stay schema-only → the SDK
            // returns toolCalls without executing, loop behavior unchanged.
            ...(tool.execute ? { execute: tool.execute } : {}),
          };
        }
      }

      // Convert AIMessage[] to CoreMessage[] format expected by AI SDK
      const sdkMessages = request.messages.map((msg) => {
        if (msg.role === "assistant" && msg.toolCalls?.length) {
          // Canonical V4 parts shape: text + tool-call parts share one content
          // array. The legacy hybrid {content, toolCalls} property shape only
          // worked via SDK normalization — canonical is what pruneMessages'
          // empty-removal (content.length check) and all four wire builders
          // natively expect.
          const parts: any[] = [];
          if (msg.content)
            parts.push({ type: "text" as const, text: msg.content });
          parts.push(
            ...msg.toolCalls.map((tc) => {
              let args: unknown = {};
              try {
                args = JSON.parse(tc.function.arguments);
              } catch (e) {
                safeDebug(
                  "[z-search] UnifiedAIProvider: tool args JSON.parse failed (id=" +
                    tc.id +
                    "): " +
                    e,
                );
              }
              return {
                type: "tool-call" as const,
                toolCallId: tc.id,
                toolName: tc.function.name,
                input: args,
              };
            }),
          );
          return { role: "assistant" as const, content: parts };
        }
        if (msg.role === "tool") {
          return {
            role: "tool" as const,
            content: [
              {
                type: "tool-result" as const,
                toolCallId: msg.toolCallId!,
                toolName: msg.name || "",
                // ai v7 outputSchema = 判别联合 {type:'text'|'json', value}：
                // 裸 string/数组过不了 zod（70f476a9 只改字段名未改形状，
                // Synthesize connections 真机复现仍崩，2026-09-02 二次修）。
                output:
                  typeof msg.content === "string"
                    ? { type: "text" as const, value: msg.content }
                    : { type: "json" as const, value: msg.content },
              },
            ],
          };
        }
        // Handle user messages with images (vision)
        if (msg.images?.length) {
          const parts: any[] = [{ type: "text", text: msg.content }];
          for (const img of msg.images) {
            try {
              parts.push({ type: "image", image: new URL(img.dataUrl) });
            } catch (e) {
              safeDebug(
                "[z-search] UnifiedAIProvider: skip invalid image (url=" +
                  img.dataUrl +
                  "): " +
                  e,
              );
            }
          }
          return { role: "user", content: parts };
        }
        return {
          role: msg.role,
          content: msg.content,
        };
      });

      // Mechanical empty-message pruning at the SDK boundary: drop messages
      // whose content is empty (blank steering injections, boundary markers).
      // Pairing-safe as of the canonical parts shape above — a tool-bearing
      // assistant has a non-empty content array. Tool-call pruning stays off:
      // ContextTruncator owns that domain with value-category awareness.
      const prunedMessages = pruneMessages({
        messages: sdkMessages as ModelMessage[],
        reasoning: "none",
        toolCalls: "none",
        emptyMessages: "remove",
      });

      // For Anthropic: extract system message and apply cache_control
      let systemMessage: string | undefined;
      const nonSystemMessages = prunedMessages.filter((m) => {
        if (m.role === "system") {
          systemMessage =
            typeof m.content === "string"
              ? m.content
              : JSON.stringify(m.content);
          return false;
        }
        return true;
      });

      const generateOptions: any = {
        model: this.getModelForRequest(request),
        messages: nonSystemMessages,
        temperature: request.temperature ?? this.modelTemperature,
        ...(request.maxTokens ? { maxTokens: request.maxTokens } : {}),
        tools: Object.keys(tools).length > 0 ? tools : undefined,
        // Agent loop path: SDK retry stays off — RequestQueue (429 single
        // retry) + AgentEngine's semantic retry (isRecoverableError with
        // compaction-aware reset) own retry for this path. Doubling up here
        // would multiply backoff latency on persistent rate limits.
        maxRetries: 0,
        // thinking → unified SDK reasoning param ('medium'). The XhrWireMiddleware
        // maps it to native budgets (google thinkingConfig / anthropic
        // budget_tokens); OpenAI hosts keep legacy no-op behavior.
        ...(request.thinking &&
        (this.providerType === "google" || this.providerType === "anthropic")
          ? { reasoning: "medium" as const }
          : {}),
        ...(request.toolChoice ? { toolChoice: request.toolChoice } : {}),
        // SDK-native approval gate: the agent side supplies an async callback
        // (ToolManager write-classification + session allow-cache). Cast is
        // safe — AIRequest.toolApproval mirrors the SDK status union.
        ...(request.toolApproval ? { toolApproval: request.toolApproval } : {}),
        // Single-point token accounting: per-call telemetry integration closes
        // over the request identity — fires onLanguageModelCallEnd per model
        // call (multi-step safe). Replaces manual recordTokenUsage.
        telemetry: {
          integrations: [createUsageAccountingIntegration(request, this.model)],
        },
      };

      // Use structured system blocks for prefix caching when available
      if (request.systemBlocks && request.systemBlocks.length > 0) {
        if (this.providerType === "anthropic") {
          // Anthropic: cache_control rides on providerOptions — the wire
          // middleware translates it to cache_control blocks. (Whether the SDK
          // preserves the providerOptions through prompt conversion is a
          // real-machine verification item; worst case is caching-off.)
          generateOptions.system = request.systemBlocks.map((b) => ({
            type: "text",
            text: b.text,
            ...(b.cache_control
              ? {
                  providerOptions: {
                    anthropic: { cacheControl: b.cache_control },
                  },
                }
              : {}),
          }));
        } else {
          // OpenAI-compatible: AI SDK requires system to be a string.
          // Join stable+dynamic blocks — the stable prefix at the start
          // enables OpenAI's automatic prefix caching (threshold: >=1024 tokens).
          generateOptions.system = request.systemBlocks
            .map((b) => b.text)
            .join("\n\n");
        }
      } else if (systemMessage) {
        generateOptions.system = systemMessage;
      }

      // Every provider streams through the XhrWireMiddleware (openai-chat /
      // anthropic-messages / google-generateContent SSE / openai-responses).
      // Many OpenAI-compatible gateways only implement stream:true and return
      // an EMPTY body for non-streaming requests (2026-08-23 incident), so
      // there is no non-streaming fallback path anymore.
      const controller = new AbortController();
      this.activeAbortSignals.add(controller);
      // 2026-09-05 D3 修复：联动调用方 signal（AIRequest.signal）→ 真中断在飞请求
      //
      // 2026-09-10（E-14）：listener 必须在结束时**摘除**。调用方 signal 常常是
      // 一个长生命周期对象（BrainTriggers 每批只建一个 controller 并被
      // ConceptExtractor 在逐条执行中复用），原先只加不减 → 批内 listener 数随
      // 条目线性增长（正是 CLAUDE.md 点名的 listener 泄漏类）。
      const onCallerAbort = () => controller.abort();
      if (request.signal) {
        if (request.signal.aborted) controller.abort();
        else
          request.signal.addEventListener("abort", onCallerAbort, {
            once: true,
          });
      }
      try {
        const result = streamText({
          ...generateOptions,
          abortSignal: controller.signal,
        });

        let content = "";
        let reasoning = "";
        const toolCalls: AIToolCall[] = [];
        let usage: any;
        let finishReason: string | undefined;

        for await (const part of result.fullStream) {
          switch (part.type) {
            case "text-delta":
              content += part.text;
              request.onStream?.({ type: "content_delta", token: part.text });
              break;
            case "reasoning-delta":
              reasoning += part.text;
              request.onStream?.({ type: "thinking_delta", token: part.text });
              break;
            case "tool-call":
              toolCalls.push({
                id: part.toolCallId,
                type: "function",
                function: {
                  name: part.toolName,
                  arguments:
                    typeof part.input === "string"
                      ? part.input
                      : JSON.stringify(part.input),
                },
              });
              break;
            case "finish":
              // Runtime shape: usage lives on totalUsage (flattened
              // LanguageModelUsage), not `usage`.
              usage = part.totalUsage;
              finishReason = part.finishReason;
              break;
            case "error":
              throw part.error instanceof Error
                ? part.error
                : new Error(String(part.error));
          }
        }

        const response: AIResponse = {
          content,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          reasoning: reasoning || undefined,
          usage: usage
            ? {
                promptTokens: usage.inputTokens ?? 0,
                completionTokens: usage.outputTokens ?? 0,
                totalTokens:
                  usage.totalTokens ??
                  (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
                cacheReadTokens: usage.inputTokenDetails?.cacheReadTokens ?? 0,
                cacheWriteTokens:
                  usage.inputTokenDetails?.cacheWriteTokens ?? 0,
                reasoningTokens: usage.outputTokenDetails?.reasoningTokens ?? 0,
              }
            : undefined,
          finishReason,
        };
        return response;
      } finally {
        this.activeAbortSignals.delete(controller);
        // E-14：摘除挂在调用方 signal 上的联动 listener（长生命周期 signal 上
        // 不摘会线性累积）。
        try {
          request.signal?.removeEventListener("abort", onCallerAbort);
        } catch {
          /* signal 可能已不可用 */
        }
      }
    }
  }

  /**
   * Multi-step native tool loop (P1-B batch 2 pilot primitive).
   *
   * One streamText call runs the full agent turn: the SDK steps while the
   * model emits tool calls and `tools[].execute` (attached by
   * AgentExecutionLoop.buildNativeExecuteTools) is scheduled natively.
   * Continuation semantics (verified against SDK 7.0.79): the loop continues
   * only while the last step produced tool calls AND no stop condition fires;
   * `stopWhen` accepts an array (any condition stopping).
   *
   * Conversion blocks intentionally mirror execute() (single-step) — the
   * legacy loop stays untouched; Batch 3 unifies after the multi-step path
   * is proven on-device.
   */
  async executeMultiStep(
    request: AIRequest,
    opts: {
      maxSteps?: number;
      onStep?: (info: {
        index: number;
        text: string;
        reasoning: string;
        toolCalls: AIToolCall[];
        usage: AIUsage | undefined;
        finishReason: string | undefined;
      }) => void;
      /** Fires when a step's stream begins (SDK 'start-step' part) — before
       *  any delta of that step. Lets the caller open a UI message per step. */
      onStepStart?: (index: number) => void;
      /** Steering-style hook: runs before each step; returned messages
       *  override carries forward to later steps (SDK prepareStep). */
      beforeStep?: (
        stepNumber: number,
        messages: ModelMessage[],
      ) => {
        messages?: ModelMessage[];
        toolChoice?: "auto" | "required" | "none";
      } | void;
    } = {},
  ): Promise<
    AIResponse & {
      steps: Array<{
        text: string;
        toolCalls: AIToolCall[];
        usage: AIUsage | undefined;
      }>;
    }
  > {
    if (!this.languageModel) {
      throw new Error(
        `${this.name} provider not configured. Call configure() first.`,
      );
    }
    if (!this.apiKey && this.currentAuthMode === "api_key") {
      const e = new Error(
        `${this.name} API key not configured. Please add an API key in Zotero Preferences → Leadero → AI Models.`,
      );
      (e as any).code = "API_KEY_MISSING";
      throw e;
    }

    // Tools: execute rides along when attached (native scheduling)
    const tools: Record<string, any> = {};
    if (request.tools) {
      for (const tool of request.tools) {
        const toolName = tool.function.name;
        const schema =
          tool.function.inputSchema || tool.function.parameters || {};
        tools[toolName] = {
          description: tool.function.description,
          inputSchema: jsonSchema(schema as any),
          ...(tool.execute ? { execute: tool.execute } : {}),
        };
      }
    }

    // Messages: same canonical parts conversion as execute()
    const sdkMessages = request.messages.map((msg) => {
      if (msg.role === "assistant" && msg.toolCalls?.length) {
        const parts: any[] = [];
        if (msg.content)
          parts.push({ type: "text" as const, text: msg.content });
        parts.push(
          ...msg.toolCalls.map((tc) => {
            let args: unknown = {};
            try {
              args = JSON.parse(tc.function.arguments);
            } catch (e) {
              safeDebug(
                "[z-search] UnifiedAIProvider: tool args JSON.parse failed (id=" +
                  tc.id +
                  "): " +
                  e,
              );
            }
            return {
              type: "tool-call" as const,
              toolCallId: tc.id,
              toolName: tc.function.name,
              input: args,
            };
          }),
        );
        return { role: "assistant" as const, content: parts };
      }
      if (msg.role === "tool") {
        return {
          role: "tool" as const,
          content: [
            {
              type: "tool-result" as const,
              toolCallId: msg.toolCallId!,
              toolName: msg.name || "",
              // 同 execute()：output 须为判别联合形状（2026-09-02 二次修）
              output:
                typeof msg.content === "string"
                  ? { type: "text" as const, value: msg.content }
                  : { type: "json" as const, value: msg.content },
            },
          ],
        };
      }
      if (msg.images?.length) {
        const parts: any[] = [{ type: "text", text: msg.content }];
        for (const img of msg.images) {
          try {
            parts.push({ type: "image", image: new URL(img.dataUrl) });
          } catch (e) {
            safeDebug(
              "[z-search] UnifiedAIProvider: skip invalid image (url=" +
                img.dataUrl +
                "): " +
                e,
            );
          }
        }
        return { role: "user", content: parts };
      }
      return { role: msg.role, content: msg.content };
    });

    const prunedMessages = pruneMessages({
      messages: sdkMessages as ModelMessage[],
      reasoning: "none",
      toolCalls: "none",
      emptyMessages: "remove",
    });

    let systemMessage: string | undefined;
    const nonSystemMessages = prunedMessages.filter((m) => {
      if (m.role === "system") {
        systemMessage =
          typeof m.content === "string" ? m.content : JSON.stringify(m.content);
        return false;
      }
      return true;
    });

    const generateOptions: any = {
      model: this.getModelForRequest(request),
      messages: nonSystemMessages,
      temperature: request.temperature ?? this.modelTemperature,
      ...(request.maxTokens ? { maxTokens: request.maxTokens } : {}),
      tools: Object.keys(tools).length > 0 ? tools : undefined,
      maxRetries: 0,
      ...(request.thinking &&
      (this.providerType === "google" || this.providerType === "anthropic")
        ? { reasoning: "medium" as const }
        : {}),
      ...(request.toolChoice ? { toolChoice: request.toolChoice } : {}),
      ...(request.toolApproval ? { toolApproval: request.toolApproval } : {}),
      // natural stop on no-tool-call steps + hard step ceiling
      stopWhen: isStepCount(opts.maxSteps ?? 25),
      ...(opts.beforeStep
        ? {
            prepareStep: ({ messages, stepNumber }: any) => {
              const r = opts.beforeStep!(stepNumber, messages);
              return r || {};
            },
          }
        : {}),
      telemetry: {
        integrations: [createUsageAccountingIntegration(request, this.model)],
      },
    };

    if (request.systemBlocks && request.systemBlocks.length > 0) {
      if (this.providerType === "anthropic") {
        generateOptions.system = request.systemBlocks.map((b) => ({
          type: "text",
          text: b.text,
          ...(b.cache_control
            ? {
                providerOptions: {
                  anthropic: { cacheControl: b.cache_control },
                },
              }
            : {}),
        }));
      } else {
        generateOptions.system = request.systemBlocks
          .map((b) => b.text)
          .join("\n\n");
      }
    } else if (systemMessage) {
      generateOptions.system = systemMessage;
    }

    const controller = new AbortController();
    this.activeAbortSignals.add(controller);
    // 2026-09-05 D3 修复：联动调用方 signal（AIRequest.signal）→ 真中断在飞请求
    if (request.signal) {
      if (request.signal.aborted) controller.abort();
      else
        request.signal.addEventListener("abort", () => controller.abort(), {
          once: true,
        });
    }
    try {
      const result = streamText({
        ...generateOptions,
        abortSignal: controller.signal,
      });

      const steps: Array<{
        text: string;
        toolCalls: AIToolCall[];
        usage: AIUsage | undefined;
      }> = [];
      let segText = "";
      let segReasoning = "";
      const segToolCalls: AIToolCall[] = [];
      let usage: any;
      let finishReason: string | undefined;

      const flushStep = () => {
        steps.push({
          text: segText,
          toolCalls: segToolCalls.splice(0),
          usage: undefined,
        });
        opts.onStep?.({
          index: steps.length - 1,
          text: segText,
          reasoning: segReasoning,
          toolCalls: steps[steps.length - 1].toolCalls,
          usage: undefined,
          finishReason: undefined,
        });
        segText = "";
        segReasoning = "";
      };

      for await (const part of result.fullStream) {
        switch (part.type) {
          case "start-step":
            opts.onStepStart?.(steps.length);
            break;
          case "text-delta":
            segText += part.text;
            request.onStream?.({ type: "content_delta", token: part.text });
            break;
          case "reasoning-delta":
            segReasoning += part.text;
            request.onStream?.({ type: "thinking_delta", token: part.text });
            break;
          case "tool-call":
            segToolCalls.push({
              id: part.toolCallId,
              type: "function",
              function: {
                name: part.toolName,
                arguments:
                  typeof part.input === "string"
                    ? part.input
                    : JSON.stringify(part.input),
              },
            });
            break;
          case "finish-step":
            flushStep();
            break;
          case "finish":
            // attach final per-call totals; segment usage stays per-step
            usage = part.totalUsage;
            finishReason = part.finishReason;
            break;
          case "error":
            throw part.error instanceof Error
              ? part.error
              : new Error(String(part.error));
        }
      }

      // multi-step totalUsage spans all steps
      const totalUsage: AIUsage | undefined = usage
        ? {
            promptTokens: usage.inputTokens ?? 0,
            completionTokens: usage.outputTokens ?? 0,
            totalTokens:
              usage.totalTokens ??
              (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
            cacheReadTokens: usage.inputTokenDetails?.cacheReadTokens ?? 0,
            cacheWriteTokens: usage.inputTokenDetails?.cacheWriteTokens ?? 0,
            reasoningTokens: usage.outputTokenDetails?.reasoningTokens ?? 0,
          }
        : undefined;

      const lastStep = steps[steps.length - 1];
      return {
        content: lastStep?.text ?? "",
        toolCalls: lastStep?.toolCalls.length ? lastStep.toolCalls : undefined,
        reasoning: undefined,
        usage: totalUsage,
        finishReason,
        steps,
      };
    } finally {
      this.activeAbortSignals.delete(controller);
    }
  }

  /**
   * Generate structured object from AI
   *
   * @param request - The AI request with messages
   * @param schema - Zod schema for the expected output
   * @returns The generated object with usage info
   */
  async generateObject<T>(
    request: AIRequest,
    schema: z.ZodType<T>,
  ): Promise<{ object: T; usage: AIUsage }> {
    if (!this.languageModel) {
      throw new Error(
        `${this.name} provider not configured. Call configure() first.`,
      );
    }

    if (!this.apiKey && this.currentAuthMode === "api_key") {
      const e = new Error(
        `${this.name} API key not configured. Please add an API key in Zotero Preferences → Leadero → AI Models.`,
      );
      (e as any).code = "API_KEY_MISSING";
      throw e;
    }

    // All providers route through SDK generateObject. OpenAI hosts get native
    // structured outputs; gateways receive the schema as a prompt instruction
    // (JsonCompatMiddleware). No silent via-prompt fallback — real errors
    // propagate (fallback-design law).
    const result = await generateObject({
      model: this.languageModel,
      schema,
      messages: request.messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      })) as ModelMessage[],
      temperature: request.temperature ?? this.modelTemperature,
      // Non-streaming structured calls: memory/audit call sites invoke
      // generateObject directly (no RequestQueue wrapper), so SDK-level retry
      // (exponential backoff + retry-after parsing) fills a real gap. The
      // agent streamText path stays at 0 — RequestQueue + AgentEngine own it.
      maxRetries: 2,
      // Gateway replies may still wrap JSON in prose or code fences — repair
      // by extracting the first balanced top-level object.
      repairText: async ({ text }) => this.extractJsonFromText(text),
      // Same single-point accounting as execute() (telemetry replaces manual record).
      telemetry: {
        integrations: [createUsageAccountingIntegration(request, this.model)],
      },
    });

    const objResult = {
      object: result.object,
      usage: result.usage
        ? {
            promptTokens: result.usage.inputTokens ?? 0,
            completionTokens: result.usage.outputTokens ?? 0,
            totalTokens: result.usage.totalTokens ?? 0,
            ...this.extractExtendedTokens(result),
          }
        : {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
          },
    };
    return objResult;
  }

  /**
   * Extract the first top-level JSON object from text by brace matching.
   * Handles LLM outputs where JSON is wrapped in markdown fences or surrounded by explanatory text.
   * Falls back to returning the original text if no balanced JSON object is found.
   *
   * F-14（回退审计 2026-09-11）：repair 只负责结构修复，schema 校验由 AI SDK
   * 的 Zod 层在 repair 结果上执行（结构错误会抛 NoObjectGeneratedError，不会
   * 静默通过）。此处补的是可诊断性：文本含多个顶层 JSON 对象时，"取第一个"
   * 是有语义风险的猜测——落一条 debug 行供排查，不改变修复行为。
   */
  private extractJsonFromText(text: string): string {
    let depth = 0;
    let start = -1;
    let objects = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === "{") {
        if (depth === 0) {
          start = i;
          objects++;
        }
        depth++;
      } else if (text[i] === "}") {
        depth--;
        if (depth === 0 && start >= 0 && objects === 1) {
          if (text.slice(i + 1).trim().length > 0) {
            safeDebug(
              "[z-search] UnifiedAIProvider: repairText picked the first of multiple top-level JSON objects (trailing content present) — verify semantics",
            );
          }
          return text.slice(start, i + 1);
        }
      }
    }
    if (objects > 1) {
      safeDebug(
        "[z-search] UnifiedAIProvider: repairText saw multiple top-level JSON objects but no balanced first object — returning raw text",
      );
    }
    return text;
  }

  /**
   * Generate embedding for text
   *
   * @param text - The text to embed
   * @returns The embedding vector
   */
  async embedText(text: string): Promise<number[]> {
    // Cast fetch to match expected signature
    const fetchFn = this.zoteroFetch.fetch.bind(this.zoteroFetch) as (
      input: string | URL | Request,
      init?: RequestInit,
    ) => Promise<Response>;

    // Resolve embedding-specific model + credentials from feature config.
    let embedApiKey = this.apiKey;
    let embedBaseUrl = this.baseUrl;
    let embedApiModelId = "text-embedding-3-small";

    try {
      const embedModelId = ConfigManager.getModelForFeature("embedding");
      if (embedModelId) {
        const config = ConfigManager.getModelFullConfig(embedModelId);
        if (config?.provider) {
          embedApiKey = config.provider.apiKey || embedApiKey;
          embedBaseUrl = config.provider.baseUrl || embedBaseUrl;
        }
        if (config?.model?.modelId) {
          embedApiModelId = config.model.modelId;
        }
      }
    } catch (e) {
      safeDebug(
        "[z-search] UnifiedAIProvider: embedding credential refresh failed: " +
          e,
      ); /* keep current credentials */
    }

    // Create embedding model (OpenAI-compatible — all providers use createOpenAI)
    if (!embedApiKey) {
      throw new Error(
        "Embedding requires an API key. Configure an embedding model in Settings → AI Models.",
      );
    }
    const embeddingProvider = createOpenAI({
      apiKey: embedApiKey,
      baseURL: embedBaseUrl || undefined,
      fetch: fetchFn,
    });

    const embeddingModel = embeddingProvider(embedApiModelId);

    const { embedding } = await embed({
      model: embeddingModel as any,
      value: text,
    });

    // Record estimated token usage
    try {
      const { default: TokenUsageStore } = await import("./TokenUsageStore");
      const estimatedTokens = Math.ceil(text.length / 4);
      TokenUsageStore.record({
        feature: "embedding",
        modelId: embedApiModelId,
        promptTokens: estimatedTokens,
        completionTokens: 0,
        totalTokens: estimatedTokens,
        isEstimated: true,
      });
    } catch (e) {
      safeDebug(
        "[z-search] UnifiedAIProvider: token usage record failed (embedding estimate): " +
          e,
      );
    }

    return embedding;
  }

  getModel(modelId: string): AIModel | undefined {
    return this.supportedModels.find((m) => m.id === modelId);
  }

  getModels(): AIModel[] {
    return this.supportedModels;
  }

  /** Extract extended tokens (cache + reasoning) from AI SDK result.
   *  Returns { cacheReadTokens, cacheWriteTokens, reasoningTokens } — all default to 0.
   */
  private extractExtendedTokens(result: any): {
    cacheReadTokens: number;
    cacheWriteTokens: number;
    reasoningTokens: number;
  } {
    try {
      const raw = result?.response?.usage;
      const cacheRead = raw?.cache_read_input_tokens ?? raw?.cached_tokens ?? 0;
      const cacheWrite = raw?.cache_creation_input_tokens ?? 0;
      // Reasoning tokens: OpenAI o1/o3 via providerMetadata, or raw completion_tokens_details
      const reasoning =
        result?.providerMetadata?.openai?.reasoningTokens ??
        raw?.completion_tokens_details?.reasoning_tokens ??
        0;
      return {
        cacheReadTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
        reasoningTokens: reasoning,
      };
    } catch (e) {
      safeDebug(
        "[z-search] UnifiedAIProvider: extractExtendedTokens failed: " + e,
      );
      return { cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 };
    }
  }

  supportsToolCalling(): boolean {
    return this.supportedModels.some((m) => m.supportsToolCalling);
  }
}
