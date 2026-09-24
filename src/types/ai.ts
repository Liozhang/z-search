import { ZodType } from "zod";
import type { ModelMessage } from "ai";

export type AIStatus = "none" | "pending" | "analyzing" | "analyzed" | "error";
import type { CompactBoundary } from "./compact";

export interface AIRequest {
  messages: AIMessage[];
  tools?: AITool[];
  temperature?: number;
  maxTokens?: number;
  model?: string; // Override provider's default model
  /** Structured system blocks for prefix caching (stable first, dynamic last). */
  systemBlocks?: Array<{ text: string; cache_control?: { type: string } }>;
  /** Stream callback — token/thinking deltas delivered from the streaming path */
  onStream?: (event: {
    type: "content_delta" | "thinking_delta" | "tool_call_delta" | "stream_end";
    token?: string;
    toolCall?: { id: string; name: string; arguments: string };
  }) => void;
  /** Feature category for token usage tracking (e.g. 'chat', 'agent', 'brain') */
  feature?: string;
  /** Session and soul IDs for persistent token usage tracking */
  sessionId?: string;
  soulId?: string;
  /** Whether to enable extended thinking / reasoning mode (provider-specific). */
  thinking?: boolean;
  /** Item/collection the AI was operating on (from session context) */
  itemId?: number;
  collectionId?: number;
  /** Tool choice strategy for this request ('auto' | 'required' | 'none'). */
  toolChoice?: "auto" | "required" | "none";
  /**
   * Caller-side abort channel (2026-09-05 UX 评估 D3 修复)：signal 触发时
   * provider 中止在飞的流式请求（真中断，非仅段间轮询）。消费方：
   * UnifiedAIProvider.execute/executeMultiStep 将其联动到每请求 controller。
   */
  signal?: AbortSignal;
  /**
   * SDK-native per-call approval gate (ToolApprovalConfiguration semantics):
   * the async callback decides per tool call. Return 'approved'/'denied' to
   * decide inline ('denied' is fed back to the model as a denial result);
   * 'user-approval'/undefined defers via stream parts (requires a consumer
   * that answers tool-approval-request parts). Currently consumed by the
   * P1-B multi-step loop pilot; single-step execute ignores it.
   */
  toolApproval?: (toolCall: {
    toolName: string;
    input: unknown;
  }) => Promise<
    | "not-applicable"
    | "approved"
    | "denied"
    | "user-approval"
    | { reason: string }
    | undefined
  >;
}

export interface AIResponse {
  content: string;
  toolCalls?: AIToolCall[];
  usage?: AIUsage;
  finishReason?: string;
  /** Model reasoning/thinking content (e.g. OpenAI o1 reasoning, Anthropic extended thinking) */
  reasoning?: string;
}

export interface AIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: AIToolCall[];
  toolCallId?: string;
  name?: string;
  /** Images for multimodal/vision requests (only supported by vision-capable providers) */
  images?: Array<{ type: "image_url"; dataUrl: string }>;
  /** Metadata about context compaction boundary (F2: Compact Boundary Markers) */
  _compactBoundary?: CompactBoundary;
}

export interface AITool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters?: Record<string, unknown> | string; // JSON schema object or string
    inputSchema?: Record<string, unknown>; // JSON schema object (for Anthropic/Gemini)
  };
  /**
   * Optional native execution (SDK multi-step pilot, P1-B). When present,
   * UnifiedAIProvider forwards it so the SDK schedules the call itself;
   * return the (already truncated) result string fed back to the model.
   * The legacy single-step loop never attaches it — it dispatches tools
   * itself via runToolCallsConcurrently, so behavior there is unchanged.
   */
  execute?: (
    input: unknown,
    opts: { toolCallId: string; abortSignal?: AbortSignal },
  ) => Promise<string>;
}

export interface AIParameter {
  type: string;
  description: string;
  enum?: string[];
}

export interface AIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface AIUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
}

export interface AIModel {
  id: string;
  name: string;
  maxContextTokens: number;
  supportsToolCalling: boolean;
}

export interface IAIProvider {
  readonly id: string;
  readonly name: string;
  readonly supportedModels: AIModel[];
  configured?: boolean;

  configure(config: Record<string, string>): void | Promise<void>;
  execute(request: AIRequest): Promise<AIResponse>;

  /**
   * Generate a structured object from AI response.
   * Optional capability - providers may throw if not supported.
   */
  generateObject?<T>(
    request: AIRequest,
    schema?: ZodType<T>,
  ): Promise<{ object: T; usage: AIUsage }>;
  /**
   * SDK-native multi-step tool loop (P1-B batch 2 pilot primitive): one call
   * runs the full agent turn, scheduling tools via attached AITool.execute.
   * Optional capability — callers must guard and fall back to execute().
   */
  executeMultiStep?(
    request: AIRequest,
    opts?: {
      maxSteps?: number;
      onStep?: (info: {
        index: number;
        text: string;
        reasoning: string;
        toolCalls: AIToolCall[];
        usage: AIUsage | undefined;
        finishReason: string | undefined;
      }) => void;
      onStepStart?: (index: number) => void;
      beforeStep?: (
        stepNumber: number,
        messages: ModelMessage[],
      ) => {
        messages?: ModelMessage[];
        toolChoice?: "auto" | "required" | "none";
      } | void;
    },
  ): Promise<
    AIResponse & {
      steps: Array<{
        text: string;
        toolCalls: AIToolCall[];
        usage: AIUsage | undefined;
      }>;
    }
  >;
  abort?(): void;
  getContextWindow?(): number;
  getMaxOutputTokens?(): number;
  /**
   * Generate embedding vector for text.
   * Optional capability - providers may throw if not supported.
   */
  embedText?(text: string): Promise<number[]>;
}
