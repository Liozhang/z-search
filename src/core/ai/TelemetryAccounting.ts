/**
 * TelemetryAccounting — single-point token accounting via SDK telemetry.
 *
 * Per-call integration instances (`telemetry.integrations`, SDK v7) close over
 * the request identity (feature/sessionId/soulId/item/collection), so events
 * need no correlation plumbing. Replaces the scattered manual record sites:
 * new call paths (e.g. multi-step steps) are covered automatically — the
 * M-4 vanished-force-synthesis-tokens class of bug becomes impossible.
 *
 * Fed events: `onLanguageModelCallEnd` (per model call; flattened
 * LanguageModelUsage). Embedding paths keep their own accounting for now —
 * they run outside UnifiedAIProvider's language-model calls.
 */
import type { AIRequest, AIUsage } from "../../types/ai";
import { safeDebug } from "../../utils/logger";

/** Map the SDK's flattened LanguageModelUsage to our AIUsage record. */
function toAIUsage(usage: any): AIUsage | null {
  if (!usage) return null;
  const promptTokens = usage.inputTokens ?? 0;
  const completionTokens = usage.outputTokens ?? 0;
  const totalTokens = usage.totalTokens ?? promptTokens + completionTokens;
  if (!totalTokens) return null;
  return {
    promptTokens,
    completionTokens,
    totalTokens,
    cacheReadTokens: usage.inputTokenDetails?.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.inputTokenDetails?.cacheWriteTokens ?? 0,
    reasoningTokens: usage.outputTokenDetails?.reasoningTokens ?? 0,
  };
}

/**
 * Build a per-call telemetry integration that feeds TokenUsageStore (global,
 * feature-scoped) and CostTracker (session-scoped, only when the request
 * carries a sessionId).
 */
export function createUsageAccountingIntegration(
  request: AIRequest,
  modelId: string,
) {
  return {
    onLanguageModelCallEnd: async (event: any) => {
      const usage = toAIUsage(event?.usage);
      if (!usage) return;
      try {
        const { default: TokenUsageStore } = await import("./TokenUsageStore");
        TokenUsageStore.record({
          feature:
            request.feature ||
            (() => {
              safeDebug(
                "[z-search] TokenUsage: feature is unknown, sessionId=" +
                  (request.sessionId || "none"),
              );
              return "unknown";
            })(),
          modelId,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          totalTokens: usage.totalTokens,
          cacheReadTokens: usage.cacheReadTokens ?? 0,
          cacheWriteTokens: usage.cacheWriteTokens ?? 0,
          reasoningTokens: usage.reasoningTokens ?? 0,
          sessionId: request.sessionId,
          soulId: request.soulId,
          itemId: request.itemId,
          collectionId: request.collectionId,
        });
      } catch (e) {
        safeDebug(
          "[z-search] TelemetryAccounting: TokenUsageStore record failed: " + e,
        );
      }
      if (request.sessionId) {
        try {
          const { default: costTracker } = await import("./CostTracker");
          costTracker.recordUsage(request.sessionId, usage, modelId);
        } catch (e) {
          safeDebug(
            "[z-search] TelemetryAccounting: CostTracker record failed: " + e,
          );
        }
      }
    },
  };
}
