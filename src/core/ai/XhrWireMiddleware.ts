declare const Zotero: any;
import { buildHttpError } from "../../utils/agentErrors";
import type { LanguageModelMiddleware } from "ai";
import { safeDebug } from "../../utils/logger";

/**
 * XhrWireMiddleware — the transport bridge between the AI SDK's model spec
 * (LanguageModelV4) and Zotero's XHR runtime.
 *
 * Zotero has no ReadableStream fetch: ZoteroFetch returns full-text Responses,
 * so the SDK's native streaming stack cannot consume provider streams. This
 * middleware implements doStream over `Zotero.HTTP.request` + onprogress SSE
 * parsing and emits LanguageModelV4StreamParts, which gives every provider
 * (including Gemini, previously non-streaming) real token streaming, live
 * reasoning deltas, and abortable requests through streamText.
 *
 * Wire dialects:
 *   openai-chat            — /chat/completions SSE (OpenAI + gateways)
 *   openai-responses       — /responses SSE (Codex; generate passes through)
 *   anthropic-messages     — /v1/messages SSE
 *   google-generateContent — :streamGenerateContent?alt=sse SSE (generate passes through)
 *
 * Abort semantics preserve the legacy StreamingFetch contract: a signalled
 * abort finishes the stream GRACEFULLY with whatever content arrived, instead
 * of throwing (AgentInterruptManager reads partial content).
 */

export type XhrWire =
  | "openai-chat"
  | "openai-responses"
  | "anthropic-messages"
  | "google-generateContent";

export interface XhrWireConfig {
  wire: XhrWire;
  /** Full endpoint URL (captured at model-creation time, not call time). */
  url: string;
  /** Wire-level model id (may differ from the SDK model id). */
  modelId: string;
  /** Per-request auth headers (OAuth tokens are dynamic — resolved per call). */
  getHeaders: () => Promise<Record<string, string>>;
}

/** reasoning level → provider-native thinking budgets (legacy values kept for medium). */
const ANTHROPIC_BUDGETS: Record<string, number> = {
  minimal: 1024,
  low: 4096,
  medium: 10000,
  high: 24576,
  xhigh: 32768,
};
const GOOGLE_BUDGETS: Record<string, number> = {
  minimal: 1024,
  low: 2048,
  medium: 8192,
  high: 24576,
  xhigh: 32768,
};
const OPENAI_EFFORT: Record<string, string> = {
  minimal: "minimal",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "high",
};

interface ToolAccum {
  id: string;
  name: string;
  args: string;
  started: boolean;
  done: boolean;
}

interface WireFinal {
  text: string;
  reasoning: string;
  toolCalls: ToolAccum[];
  usage: {
    promptTokens: number;
    completionTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    reasoningTokens: number;
  } | null;
  finishReason: { unified: string; raw: string | undefined };
}

type Emit = (part: any) => void;

function mapFinishReason(
  raw: string | undefined,
  hadToolCalls: boolean,
): { unified: string; raw: string | undefined } {
  if (hadToolCalls) return { unified: "tool-calls", raw };
  switch (raw) {
    case "length":
    case "max_tokens":
    case "MAX_TOKENS":
    case "max_output_tokens":
      return { unified: "length", raw };
    case "content-filter":
    case "SAFETY":
    case "BLOCKED":
      return { unified: "content-filter", raw };
    case "error":
      return { unified: "error", raw };
    default:
      return { unified: "stop", raw };
  }
}

function nestedUsage(u: NonNullable<WireFinal["usage"]>) {
  return {
    inputTokens: {
      total: u.promptTokens,
      noCache: u.promptTokens - u.cacheReadTokens,
      cacheRead: u.cacheReadTokens || undefined,
      cacheWrite: u.cacheWriteTokens || undefined,
    },
    outputTokens: {
      total: u.completionTokens,
      text: undefined,
      reasoning: u.reasoningTokens || undefined,
    },
  };
}

function toolResultValue(output: any): string {
  if (output == null) return "";
  if (output.type === "execution-denied")
    return output.reason ? `[denied] ${output.reason}` : "[denied]";
  if (typeof output.value === "string") return output.value;
  return JSON.stringify(output.value ?? null);
}

// ── tool-call input 形状规整（request_params_invalid 批，2026-09-07）────────────
// V4 prompt 规范把 ToolCallPart.input 定为 unknown：跨回合重放时
// UnifiedAIProvider 把存储的 arguments 字符串 JSON.parse 成对象再送进来；而
// OpenAI chat/responses 协议要求 function.arguments 必须是 JSON 字符串
// （官方 provider 均 JSON.stringify）。anthropic/google 相反要对象 —— 原实现
// 对对象 input 做 JSON.parse 必抛、catch 后静默丢参成 {}。两个方向都在这层
// （协议翻译边界）规整，与官方 provider 行为对齐。

/** input（string | object）→ OpenAI 线格式：JSON 字符串。 */
function toolArgsWireString(input: unknown): string {
  return typeof input === "string" ? input : JSON.stringify(input ?? {});
}

/** input（string | object）→ anthropic/google 线格式：对象。解析失败保底 {}。 */
function toolArgsWireObject(input: unknown): unknown {
  if (typeof input !== "string") return input ?? {};
  try {
    return JSON.parse(input || "{}");
  } catch (e) {
    safeDebug("[z-search] XhrWire: tool input parse failed: " + e);
    return {};
  }
}

// ── wire body builders (LanguageModelV4CallOptions → provider JSON) ─────────

function fileDataToUrl(data: any, mediaType: string): string {
  if (data instanceof URL) return data.toString();
  if (typeof data === "string") {
    return data.startsWith("data:") ? data : `data:${mediaType};base64,${data}`;
  }
  if (typeof data === "object" && data !== null) {
    if (data.url) return String(data.url);
    if (typeof data.data === "string") {
      return data.data.startsWith("data:")
        ? data.data
        : `data:${mediaType};base64,${data.data}`;
    }
  }
  throw new Error(`Unsupported image data in prompt: ${typeof data}`);
}

function buildOpenAIChatBody(cfg: XhrWireConfig, params: any): string {
  const body: any = { model: cfg.modelId, stream: true };
  const messages: any[] = [];
  for (const msg of params.prompt) {
    if (msg.role === "system") {
      messages.push({ role: "system", content: msg.content });
    } else if (msg.role === "user") {
      const parts: any[] = [];
      let textOnly = "";
      for (const p of msg.content ?? []) {
        if (p.type === "text") {
          textOnly += p.text;
          parts.push({ type: "text", text: p.text });
        } else if (p.type === "file") {
          parts.push({
            type: "image_url",
            image_url: {
              url: fileDataToUrl(p.data, p.mediaType ?? "image/png"),
            },
          });
        }
      }
      messages.push({
        role: "user",
        content:
          parts.length === 1 && parts[0].type === "text" ? textOnly : parts,
      });
    } else if (msg.role === "assistant") {
      const text = (msg.content ?? [])
        .filter((p: any) => p.type === "text")
        .map((p: any) => p.text)
        .join("");
      const calls = (msg.content ?? []).filter(
        (p: any) => p.type === "tool-call",
      );
      messages.push({
        role: "assistant",
        // 纯工具调用的 assistant 重放：content 用 "" 而非 null —— OpenAI 两者都收，
        // 但 StepFun 等严格网关对 null 直接 400 request_params_invalid
        // （nanobot#1157 同源缺陷的官方修复即强制 ""）。
        content: text || (calls.length ? "" : null),
        ...(calls.length
          ? {
              tool_calls: calls.map((tc: any) => ({
                id: tc.toolCallId,
                type: "function",
                function: {
                  name: tc.toolName,
                  arguments: toolArgsWireString(tc.input),
                },
              })),
            }
          : {}),
      });
    } else if (msg.role === "tool") {
      for (const p of msg.content ?? []) {
        messages.push({
          role: "tool",
          tool_call_id: p.toolCallId,
          content: toolResultValue(p.output),
        });
      }
    }
  }
  body.messages = messages;

  if (params.temperature !== undefined) body.temperature = params.temperature;
  if (params.maxOutputTokens !== undefined)
    body.max_tokens = params.maxOutputTokens;
  if (params.stopSequences?.length) body.stop = params.stopSequences;
  if (params.tools?.length) {
    body.tools = params.tools.map((t: any) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));
    // toolChoice 映射（官方 prepareTools 同款）：V4 判别联合 → OpenAI wire 值。
    // 此前被静默丢弃 —— AgentExecutionLoop 的 toolChoice:'required' 从未生效。
    const choice = params.toolChoice;
    if (choice) {
      body.tool_choice =
        choice.type === "tool"
          ? { type: "function", function: { name: choice.toolName } }
          : choice.type; // 'auto' | 'none' | 'required'
    }
  }
  const effort = params.reasoning ? OPENAI_EFFORT[params.reasoning] : undefined;
  if (effort) body.reasoning_effort = effort;
  const rf = params.responseFormat;
  if (rf?.type === "json" && rf.schema) {
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: rf.name ?? "response",
        strict: true,
        schema: rf.schema,
      },
    };
  }
  return JSON.stringify(body);
}

function buildAnthropicBody(cfg: XhrWireConfig, params: any): string {
  const body: any = { model: cfg.modelId, stream: true };
  const budget = params.reasoning
    ? ANTHROPIC_BUDGETS[params.reasoning]
    : undefined;
  if (budget) {
    body.thinking = { type: "enabled", budget_tokens: budget };
    // Anthropic requires max_tokens above the thinking budget.
    body.max_tokens = params.maxOutputTokens ?? budget + 4096;
  } else if (params.maxOutputTokens !== undefined) {
    body.max_tokens = params.maxOutputTokens;
  }

  const messages: any[] = [];
  for (const msg of params.prompt) {
    if (msg.role === "system") {
      const cacheControl = msg.providerOptions?.anthropic?.cacheControl;
      body.system = [
        {
          type: "text",
          text: msg.content,
          ...(cacheControl ? { cache_control: cacheControl } : {}),
        },
      ];
    } else if (msg.role === "user") {
      const blocks: any[] = [];
      for (const p of msg.content ?? []) {
        if (p.type === "text") blocks.push({ type: "text", text: p.text });
        else if (p.type === "file") {
          const url = fileDataToUrl(p.data, p.mediaType ?? "image/png");
          const m = /^data:([^;]+);base64,(.*)$/.exec(url);
          if (m)
            blocks.push({
              type: "image",
              source: { type: "base64", media_type: m[1], data: m[2] },
            });
        }
      }
      messages.push({ role: "user", content: blocks });
    } else if (msg.role === "assistant") {
      const blocks: any[] = [];
      for (const p of msg.content ?? []) {
        if (p.type === "text") {
          if (p.text) blocks.push({ type: "text", text: p.text });
        } else if (p.type === "tool-call") {
          blocks.push({
            type: "tool_use",
            id: p.toolCallId,
            name: p.toolName,
            input: toolArgsWireObject(p.input),
          });
        }
      }
      messages.push({ role: "assistant", content: blocks });
    } else if (msg.role === "tool") {
      const blocks: any[] = [];
      for (const p of msg.content ?? []) {
        blocks.push({
          type: "tool_result",
          tool_use_id: p.toolCallId,
          content: toolResultValue(p.output),
        });
      }
      messages.push({ role: "user", content: blocks });
    }
  }
  body.messages = messages;

  if (params.temperature !== undefined && !budget)
    body.temperature = params.temperature;
  if (params.stopSequences?.length) body.stop_sequences = params.stopSequences;
  if (params.tools?.length) {
    body.tools = params.tools.map((t: any) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }));
  }
  return JSON.stringify(body);
}

function buildGoogleBody(cfg: XhrWireConfig, params: any): string {
  const body: any = { contents: [] };
  const budget = params.reasoning
    ? GOOGLE_BUDGETS[params.reasoning]
    : undefined;

  for (const msg of params.prompt) {
    if (msg.role === "system") {
      body.systemInstruction = { parts: [{ text: msg.content }] };
    } else if (msg.role === "user") {
      const parts: any[] = [];
      for (const p of msg.content ?? []) {
        if (p.type === "text") parts.push({ text: p.text });
        else if (p.type === "file") {
          const url = fileDataToUrl(p.data, p.mediaType ?? "image/png");
          const m = /^data:([^;]+);base64,(.*)$/.exec(url);
          if (m) parts.push({ inlineData: { mimeType: m[1], data: m[2] } });
        }
      }
      body.contents.push({ role: "user", parts });
    } else if (msg.role === "assistant") {
      const parts: any[] = [];
      for (const p of msg.content ?? []) {
        if (p.type === "text") {
          if (p.text) parts.push({ text: p.text });
        } else if (p.type === "tool-call") {
          parts.push({
            functionCall: {
              name: p.toolName,
              args: toolArgsWireObject(p.input),
            },
          });
        }
      }
      body.contents.push({ role: "model", parts });
    } else if (msg.role === "tool") {
      const parts: any[] = [];
      for (const p of msg.content ?? []) {
        let value: unknown;
        try {
          value = JSON.parse(toolResultValue(p.output));
        } catch (_e) {
          value = toolResultValue(p.output);
        }
        parts.push({
          functionResponse: { name: p.toolName, response: { result: value } },
        });
      }
      body.contents.push({ role: "user", parts });
    }
  }

  const generationConfig: any = {};
  if (params.temperature !== undefined)
    generationConfig.temperature = params.temperature;
  if (params.maxOutputTokens !== undefined)
    generationConfig.maxOutputTokens = params.maxOutputTokens;
  if (params.stopSequences?.length)
    generationConfig.stopSequences = params.stopSequences;
  if (budget) generationConfig.thinkingConfig = { thinkingBudget: budget };
  if (Object.keys(generationConfig).length)
    body.generationConfig = generationConfig;

  if (params.tools?.length) {
    body.tools = [
      {
        functionDeclarations: params.tools.map((t: any) => ({
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        })),
      },
    ];
  }
  return JSON.stringify(body);
}

function buildResponsesBody(cfg: XhrWireConfig, params: any): string {
  const body: any = { model: cfg.modelId, stream: true, input: [] };
  for (const msg of params.prompt) {
    if (msg.role === "system") {
      body.instructions = msg.content;
    } else if (msg.role === "user") {
      body.input.push({
        role: "user",
        content: (msg.content ?? [])
          .filter((p: any) => p.type === "text")
          .map((p: any) => ({ type: "input_text", text: p.text })),
      });
    } else if (msg.role === "assistant") {
      for (const p of msg.content ?? []) {
        if (p.type === "text" && p.text) {
          body.input.push({
            role: "assistant",
            content: [{ type: "output_text", text: p.text }],
          });
        } else if (p.type === "tool-call") {
          body.input.push({
            type: "function_call",
            call_id: p.toolCallId,
            name: p.toolName,
            arguments: toolArgsWireString(p.input),
          });
        }
      }
    } else if (msg.role === "tool") {
      for (const p of msg.content ?? []) {
        body.input.push({
          type: "function_call_output",
          call_id: p.toolCallId,
          output: toolResultValue(p.output),
        });
      }
    }
  }
  if (params.maxOutputTokens !== undefined)
    body.max_output_tokens = params.maxOutputTokens;
  if (params.temperature !== undefined) body.temperature = params.temperature;
  const effort = params.reasoning ? OPENAI_EFFORT[params.reasoning] : undefined;
  if (effort) body.reasoning = { effort };
  if (params.tools?.length) {
    body.tools = params.tools.map((t: any) => ({
      type: "function",
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    }));
  }
  return JSON.stringify(body);
}

function buildWireBody(cfg: XhrWireConfig, params: any): string {
  switch (cfg.wire) {
    case "openai-chat":
      return buildOpenAIChatBody(cfg, params);
    case "anthropic-messages":
      return buildAnthropicBody(cfg, params);
    case "google-generateContent":
      return buildGoogleBody(cfg, params);
    case "openai-responses":
      return buildResponsesBody(cfg, params);
  }
}

/**
 * 导出仅供 wire 快照一致性测试（tests/eval/xhrwire-snapshot.test.ts，R8-B）：
 * 四套手搓请求体是历史上 wire 失真事故的高发面，任何 builder 改动都必须
 * 有快照 diff + 用例更新随行。生产代码勿调用。
 */
export const __buildWireBodyForSnapshot = buildWireBody;

// ── SSE event parsers (wire JSON → normalized accumulators + emit) ──────────

interface ParserState {
  text: string;
  reasoning: string;
  tools: Map<string, ToolAccum>;
  order: string[];
  usage: WireFinal["usage"];
  finishRaw: string | undefined;
  googleToolSeq: number;
  /** openai-chat: tool_call index → accumulator id (later chunks omit the id). */
  openaiIndex: Map<string, string>;
}

function newParserState(): ParserState {
  return {
    text: "",
    reasoning: "",
    tools: new Map(),
    order: [],
    usage: null,
    finishRaw: undefined,
    googleToolSeq: 0,
    openaiIndex: new Map(),
  };
}

function getTool(state: ParserState, id: string, name?: string): ToolAccum {
  let tc = state.tools.get(id);
  if (!tc) {
    tc = { id, name: name ?? "", args: "", started: false, done: false };
    state.tools.set(id, tc);
    state.order.push(id);
  }
  if (name && !tc.name) tc.name = name;
  return tc;
}

function processOpenAILine(
  state: ParserState,
  emit: Emit,
  line: string,
): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data: ")) return false;
  const sseData = trimmed.slice(6);
  if (sseData === "[DONE]") return true;

  let parsed: any;
  try {
    parsed = JSON.parse(sseData);
  } catch (e) {
    safeDebug(
      "[z-search] XhrWire: partial JSON chunk (normal during streaming): " + e,
    );
    return false;
  }

  if (parsed.usage) {
    state.usage = {
      promptTokens: parsed.usage.prompt_tokens ?? 0,
      completionTokens: parsed.usage.completion_tokens ?? 0,
      cacheReadTokens: parsed.usage.prompt_tokens_details?.cached_tokens ?? 0,
      cacheWriteTokens: 0,
      reasoningTokens:
        parsed.usage.completion_tokens_details?.reasoning_tokens ?? 0,
    };
  }

  const choice = parsed.choices?.[0];
  if (!choice) return false;
  if (choice.finish_reason) state.finishRaw = choice.finish_reason;

  const delta = choice.delta;
  if (!delta) return false;

  if (delta.reasoning_content || delta.reasoning) {
    const r = delta.reasoning_content ?? delta.reasoning;
    if (typeof r === "string" && r) {
      state.reasoning += r;
      emit({ kind: "reasoning", delta: r });
    }
  }
  if (delta.content) {
    state.text += delta.content;
    emit({ kind: "text", delta: delta.content });
  }
  if (delta.tool_calls) {
    for (const tc of delta.tool_calls) {
      const idx = String(tc.index ?? 0);
      // Key by wire index — later chunks carry only {index, function.arguments}.
      let acc = state.tools.get(state.openaiIndex.get(idx) ?? "");
      if (!acc) {
        acc = getTool(state, tc.id || `call-${idx}`);
        state.openaiIndex.set(idx, acc.id);
      }
      if (tc.function?.name) acc.name = tc.function.name;
      if (!acc.started) {
        acc.started = true;
        emit({ kind: "tool-start", id: acc.id, name: acc.name });
      }
      if (tc.function?.arguments) {
        acc.args += tc.function.arguments;
        emit({ kind: "tool-delta", id: acc.id, delta: tc.function.arguments });
      }
    }
  }
  return false;
}

function processAnthropicEvent(
  state: ParserState,
  emit: Emit,
  eventType: string,
  dataStr: string,
): boolean {
  let parsed: any;
  try {
    parsed = JSON.parse(dataStr);
  } catch (e) {
    safeDebug("[z-search] XhrWire: anthropic event JSON parse failed: " + e);
    return false;
  }

  switch (eventType) {
    case "message_start": {
      const u = parsed.message?.usage;
      if (u) {
        state.usage = {
          promptTokens: u.input_tokens ?? 0,
          completionTokens: 0,
          cacheReadTokens: u.cache_read_input_tokens ?? 0,
          cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
          reasoningTokens: 0,
        };
      }
      break;
    }
    case "content_block_start": {
      const block = parsed.content_block;
      if (block?.type === "tool_use") {
        const acc = getTool(
          state,
          block.id ?? `block-${parsed.index}`,
          block.name,
        );
        acc.started = true;
        emit({ kind: "tool-start", id: acc.id, name: acc.name });
      } else if (block?.type === "thinking") {
        emit({ kind: "reasoning-start" });
      }
      break;
    }
    case "content_block_delta": {
      const delta = parsed.delta;
      if (!delta) break;
      if (delta.type === "text_delta" && delta.text) {
        state.text += delta.text;
        emit({ kind: "text", delta: delta.text });
      } else if (delta.type === "thinking_delta" && delta.thinking) {
        state.reasoning += delta.thinking;
        emit({ kind: "reasoning", delta: delta.thinking });
      } else if (delta.type === "input_json_delta" && delta.partial_json) {
        const acc =
          [...state.tools.values()].find((b) => !b.done) ??
          getTool(state, `block-${parsed.index}`);
        acc.args += delta.partial_json;
        emit({ kind: "tool-delta", id: acc.id, delta: delta.partial_json });
      }
      break;
    }
    case "message_delta": {
      if (parsed.usage?.output_tokens && state.usage) {
        state.usage.completionTokens = parsed.usage.output_tokens;
      }
      if (parsed.delta?.stop_reason) state.finishRaw = parsed.delta.stop_reason;
      break;
    }
    case "message_stop": {
      return true;
    }
  }
  return false;
}

function processGoogleData(
  state: ParserState,
  emit: Emit,
  dataStr: string,
): boolean {
  let parsed: any;
  try {
    parsed = JSON.parse(dataStr);
  } catch (e) {
    safeDebug("[z-search] XhrWire: google chunk JSON parse failed: " + e);
    return false;
  }
  if (parsed.error) {
    throw new Error(
      parsed.error.message ||
        `Google API error${parsed.error.status ? " " + parsed.error.status : ""}`,
    );
  }

  const cand = parsed.candidates?.[0];
  if (cand?.finishReason) state.finishRaw = cand.finishReason;
  const parts = cand?.content?.parts;
  if (parts) {
    for (const part of parts) {
      if (part.functionCall) {
        const id = `gcall-${state.googleToolSeq++}`;
        const acc = getTool(state, id, part.functionCall.name);
        acc.started = true;
        emit({ kind: "tool-start", id: acc.id, name: acc.name });
        const args = JSON.stringify(part.functionCall.args ?? {});
        acc.args = args;
        emit({ kind: "tool-delta", id: acc.id, delta: args });
        acc.done = true;
        emit({ kind: "tool-end", id: acc.id });
      } else if (part.thought === true && part.text) {
        state.reasoning += part.text;
        emit({ kind: "reasoning", delta: part.text });
      } else if (part.text) {
        state.text += part.text;
        emit({ kind: "text", delta: part.text });
      }
    }
  }
  const u = parsed.usageMetadata;
  if (u) {
    // usageMetadata is cumulative per chunk — later chunks may omit fields
    // (e.g. cachedContentTokenCount), so merge over the previous snapshot.
    const prev = state.usage ?? {
      promptTokens: 0,
      completionTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
    };
    state.usage = {
      promptTokens: u.promptTokenCount ?? prev.promptTokens,
      completionTokens:
        u.candidatesTokenCount != null
          ? (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0)
          : prev.completionTokens,
      cacheReadTokens: u.cachedContentTokenCount ?? prev.cacheReadTokens,
      cacheWriteTokens: prev.cacheWriteTokens,
      reasoningTokens: u.thoughtsTokenCount ?? prev.reasoningTokens,
    };
  }
  return false;
}

function processResponsesData(
  state: ParserState,
  emit: Emit,
  dataStr: string,
): boolean {
  let parsed: any;
  try {
    parsed = JSON.parse(dataStr);
  } catch (e) {
    safeDebug("[z-search] XhrWire: responses chunk JSON parse failed: " + e);
    return false;
  }
  switch (parsed.type) {
    case "response.output_text.delta": {
      if (parsed.delta) {
        state.text += parsed.delta;
        emit({ kind: "text", delta: parsed.delta });
      }
      break;
    }
    case "response.reasoning_summary_text.delta":
    case "response.reasoning_text.delta": {
      if (parsed.delta) {
        state.reasoning += parsed.delta;
        emit({ kind: "reasoning", delta: parsed.delta });
      }
      break;
    }
    case "response.output_item.added": {
      if (parsed.item?.type === "function_call") {
        const acc = getTool(
          state,
          parsed.item.item_id ?? parsed.item.id ?? `fc-${state.order.length}`,
          parsed.item.name,
        );
        acc.started = true;
        emit({ kind: "tool-start", id: acc.id, name: acc.name });
      }
      break;
    }
    case "response.function_call_arguments.delta": {
      const acc = getTool(state, parsed.item_id ?? "");
      if (parsed.delta) {
        acc.args += parsed.delta;
        emit({ kind: "tool-delta", id: acc.id, delta: parsed.delta });
      }
      break;
    }
    case "response.function_call_arguments.done": {
      const acc = getTool(state, parsed.item_id ?? "");
      if (parsed.arguments) acc.args = parsed.arguments;
      acc.done = true;
      emit({ kind: "tool-end", id: acc.id });
      break;
    }
    case "response.completed": {
      const u = parsed.response?.usage;
      if (u) {
        state.usage = {
          promptTokens: u.input_tokens ?? 0,
          completionTokens: u.output_tokens ?? 0,
          cacheReadTokens: u.input_tokens_details?.cached_tokens ?? 0,
          cacheWriteTokens: 0,
          reasoningTokens: u.output_tokens_details?.reasoning_tokens ?? 0,
        };
      }
      if (parsed.response?.incomplete_details?.reason === "max_output_tokens")
        state.finishRaw = "max_output_tokens";
      return true;
    }
    case "response.incomplete": {
      if (parsed.response?.incomplete_details?.reason === "max_output_tokens")
        state.finishRaw = "max_output_tokens";
      return true;
    }
    case "error":
    case "response.error": {
      throw new Error(
        parsed.message || parsed.error?.message || "Responses API stream error",
      );
    }
  }
  return false;
}

// ── XHR runner ──────────────────────────────────────────────────────────────

async function runWireStream(
  cfg: XhrWireConfig,
  params: any,
  emit: Emit,
): Promise<WireFinal> {
  const state = newParserState();
  const body = buildWireBody(cfg, params);
  const headers = {
    "Content-Type": "application/json",
    ...(await cfg.getHeaders()),
  };

  const lineHandlers: Record<XhrWire, (line: string) => boolean> = {
    "openai-chat": (line) => processOpenAILine(state, emit, line),
    "openai-responses": (line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) return false;
      return processResponsesData(state, emit, trimmed.slice(5).trim());
    },
    "anthropic-messages": (_line) => {
      // Anthropic pairs "event: <type>" with the following "data: <json>".
      return false; // handled via pendingEventType in the runner below
    },
    "google-generateContent": (line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) return false;
      return processGoogleData(state, emit, trimmed.slice(5).trim());
    },
  };

  return new Promise<WireFinal>((resolve, reject) => {
    let resolved = false;
    let completed = false;
    let pendingEventType = "message";
    let lastPosition = 0;
    let lineBuffer = "";

    const finalize = () => {
      if (resolved) return;
      resolved = true;
      clearAbortWatch();
      for (const id of state.order) {
        const tc = state.tools.get(id)!;
        tc.done = true;
      }
      resolve({
        text: state.text,
        reasoning: state.reasoning,
        toolCalls: state.order.map((id) => state.tools.get(id)!),
        usage: state.usage,
        // V4 structured finish reason — the SDK reads `.unified` off this
        // object at the stream boundary; a bare string normalizes to undefined
        // (RealSdkProbe red + XhrWireMiddleware.test `.finishReason.unified`
        // assertions both pin the object shape).
        finishReason: mapFinishReason(state.finishRaw, state.order.length > 0),
      });
    };

    const processLine = (line: string) => {
      if (completed) return;
      if (cfg.wire === "anthropic-messages") {
        const trimmed = line.trim();
        if (trimmed.startsWith("event:")) {
          pendingEventType = trimmed.slice(6).trim();
        } else if (trimmed.startsWith("data:")) {
          completed = processAnthropicEvent(
            state,
            emit,
            pendingEventType,
            trimmed.slice(5).trim(),
          );
          pendingEventType = "message";
        } else if (trimmed === "") {
          pendingEventType = "message";
        }
      } else {
        completed = lineHandlers[cfg.wire](line);
      }
    };

    // Abort: poll the AbortSignal (mirrors the legacy StreamingFetch poller) so
    // abort works even when the server goes quiet, and finish gracefully with
    // partial content instead of throwing.
    let xhrRef: XMLHttpRequest | null = null;
    let abortTimer: ReturnType<typeof setInterval> | null = null;
    const clearAbortWatch = () => {
      if (abortTimer) {
        clearInterval(abortTimer);
        abortTimer = null;
      }
    };
    const startAbortWatch = (xhr: XMLHttpRequest) => {
      xhrRef = xhr;
      abortTimer = setInterval(() => {
        if (params.abortSignal?.aborted) {
          xhrRef?.abort();
          finalize();
        }
      }, 100);
    };

    const requestObserver = (xhr: XMLHttpRequest) => {
      startAbortWatch(xhr);
      xhr.onprogress = () => {
        if (params.abortSignal?.aborted) {
          xhr.abort();
          finalize();
          return;
        }
        const responseText = xhr.responseText ?? "";
        const newText = responseText.substring(lastPosition);
        lastPosition = responseText.length;
        lineBuffer += newText;
        const lines = lineBuffer.split("\n");
        lineBuffer = lines.pop() || "";
        for (const line of lines) {
          if (completed) break;
          processLine(line);
        }
      };
      xhr.onreadystatechange = () => {
        if (xhr.readyState === 4) {
          if (lineBuffer.length > 0) {
            processLine(lineBuffer);
            lineBuffer = "";
          }
          if (!resolved) {
            const status = xhr.status;
            if (status >= 200 && status < 300) {
              finalize();
            } else {
              clearAbortWatch();
              let errorMsg = `HTTP ${status}`;
              const errText = xhr.responseText ?? "";
              try {
                const errBody = JSON.parse(errText);
                if (errBody.error?.message) errorMsg = errBody.error.message;
                else if (typeof errBody.message === "string")
                  errorMsg = errBody.message;
                else errorMsg += ": " + errText.slice(0, 200);
              } catch (_e) {
                if (errText) errorMsg += ": " + errText.slice(0, 200);
              }
              // 4xx 诊断（request_params_invalid 批）：请求体尾段随错误落 debug 日志，
              // 网关拒格式时可直接对账是哪个字段（replay 的 tool_calls/arguments 等）。
              if (status >= 400) {
                safeDebug(
                  `[z-search] XhrWire: ${cfg.wire} HTTP ${status} — ` +
                    `request body (tail 500): ${body.slice(-500)}`,
                );
              }
              reject(buildHttpError(status, errorMsg, errText));
            }
          }
        }
      };
    };

    try {
      Zotero.HTTP.request("POST", cfg.url, {
        body,
        headers,
        requestObserver,
        timeout: 300000,
      });
    } catch (err) {
      reject(
        new Error(
          `Network error: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }
  });
}

// ── middleware factory ──────────────────────────────────────────────────────

export function createXhrWireMiddleware(
  cfg: XhrWireConfig,
): LanguageModelMiddleware {
  // Wires whose non-streaming (generate) path already works through the
  // official provider + ZoteroFetch full-text responses keep generate
  // passthrough; openai-chat/anthropic-messages always stream (many gateways
  // return EMPTY bodies for non-streaming requests — 2026-08-23 incident).
  const interceptGenerate =
    cfg.wire === "openai-chat" || cfg.wire === "anthropic-messages";

  return {
    specificationVersion: "v4",

    ...(interceptGenerate
      ? {
          wrapGenerate: async ({ params }) => {
            const final = await runWireStream(cfg, params, () => {});
            const content: any[] = [];
            if (final.reasoning)
              content.push({ type: "reasoning", text: final.reasoning });
            if (final.text) content.push({ type: "text", text: final.text });
            for (const tc of final.toolCalls) {
              content.push({
                type: "tool-call",
                toolCallId: tc.id,
                toolName: tc.name,
                input: tc.args,
              });
            }
            return {
              content,
              // V4 structured finish reason: {unified, raw}
              finishReason: final.finishReason,
              usage: nestedUsage(
                final.usage ?? {
                  promptTokens: 0,
                  completionTokens: 0,
                  cacheReadTokens: 0,
                  cacheWriteTokens: 0,
                  reasoningTokens: 0,
                },
              ),
              warnings: [],
            } as any;
          },
        }
      : {}),

    /* eslint-disable-next-line @typescript-eslint/no-unused-vars -- doStream is part of the LanguageModelMiddleware type; this implementation delegates to runWireStream instead */
    wrapStream: async ({ doStream, params }) => {
      let writer: any;
      const readable: any = new ReadableStream({
        // start() runs synchronously during construction — writer is set below.
        start(c: any) {
          writer = c;
        },
      });

      const enqueue = (part: any) => {
        try {
          writer.enqueue(part);
        } catch (_e) {
          /* stream already closed */
        }
      };

      let streamStartSent = false;
      let textStarted = false;
      let reasoningStarted = false;

      const finalPromise = runWireStream(cfg, params, (event) => {
        if (!streamStartSent) {
          streamStartSent = true;
          enqueue({ type: "stream-start", warnings: [] });
        }
        switch (event.kind) {
          case "text":
            if (!textStarted) {
              textStarted = true;
              enqueue({ type: "text-start", id: "t0" });
            }
            enqueue({ type: "text-delta", id: "t0", delta: event.delta });
            break;
          case "reasoning":
            if (!reasoningStarted) {
              reasoningStarted = true;
              enqueue({ type: "reasoning-start", id: "r0" });
            }
            enqueue({ type: "reasoning-delta", id: "r0", delta: event.delta });
            break;
          case "tool-start":
            enqueue({
              type: "tool-input-start",
              id: event.id,
              toolName: event.name,
            });
            break;
          case "tool-delta":
            enqueue({
              type: "tool-input-delta",
              id: event.id,
              delta: event.delta,
            });
            break;
          case "tool-end":
            break; // tool-call part emitted at finalize (needs full args)
        }
      });

      finalPromise
        .then((final) => {
          for (const tc of final.toolCalls) {
            enqueue({ type: "tool-input-end", id: tc.id });
            enqueue({
              type: "tool-call",
              toolCallId: tc.id,
              toolName: tc.name,
              input: tc.args || "{}",
            });
          }
          if (reasoningStarted) enqueue({ type: "reasoning-end", id: "r0" });
          if (textStarted) enqueue({ type: "text-end", id: "t0" });
          enqueue({
            type: "finish",
            usage: nestedUsage(
              final.usage ?? {
                promptTokens: 0,
                completionTokens: 0,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
                reasoningTokens: 0,
              },
            ),
            finishReason: final.finishReason,
          });
          try {
            writer.close();
          } catch (_e) {
            /* already closed */
          }
        })
        .catch((error) => {
          enqueue({ type: "error", error });
          try {
            writer.close();
          } catch (_e) {
            /* already closed */
          }
        });

      return { stream: readable } as any;
    },
  };
}
