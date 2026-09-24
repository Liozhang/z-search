/**
 * Cost Tracker — Per-session token usage accumulation.
 *
 * Accumulates input/output/cache/reasoning tokens per session.
 */

import type { AIUsage } from "../../types/ai";

interface SessionUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  modelId: string;
}

class CostTracker {
  private sessions = new Map<string, SessionUsage>();
  /** Track last access time for cleanup */
  private lastAccess = new Map<string, number>();

  /**
   * Record usage from a single API response.
   */
  recordUsage(sessionId: string, usage: AIUsage, modelId: string): void {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        modelId,
      };
      this.sessions.set(sessionId, session);
    }

    session.inputTokens += usage.promptTokens ?? 0;
    session.outputTokens += usage.completionTokens ?? 0;
    session.cacheReadTokens += usage.cacheReadTokens ?? 0;
    session.cacheWriteTokens += usage.cacheWriteTokens ?? 0;
    session.reasoningTokens += usage.reasoningTokens ?? 0;
    // Keep the first model to avoid mid-session inconsistency
    if (modelId && !session.modelId) session.modelId = modelId;

    this.lastAccess.set(sessionId, Date.now());
    if (this.sessions.size > 100) this.cleanup();
  }

  /**
   * Get accumulated usage for a session.
   */
  getTotal(sessionId: string): (SessionUsage & { total: number }) | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    return {
      ...session,
      total: session.inputTokens + session.outputTokens,
    };
  }

  /**
   * Reset a session's usage (e.g., on session switch).
   */
  resetSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.lastAccess.delete(sessionId);
  }

  /**
   * Clean up sessions not accessed in the last 24 hours.
   */
  cleanup(maxAgeMs = 24 * 60 * 60 * 1000): void {
    const now = Date.now();
    for (const [id, time] of this.lastAccess) {
      if (now - time > maxAgeMs) {
        this.sessions.delete(id);
        this.lastAccess.delete(id);
      }
    }
  }
}

export default new CostTracker();
