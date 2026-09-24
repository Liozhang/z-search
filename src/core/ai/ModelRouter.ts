/**
 * Internal Model Router — Task→Feature mapping.
 *
 * Maps every AI call point to the appropriate feature, ensuring
 * each task uses the correct model without relying on getActive().
 */

import AIProviderRegistry from "./AIProviderRegistry";
import ConfigManager from "../../utils/config/ConfigManager";
import type { AIFeature } from "../../types/config";
import type { IAIProvider } from "../../types/ai";

/** Internal task → feature routing map */
const TASK_FEATURE_MAP: Record<string, AIFeature> = {
  // Agent — strong reasoning, multi-step tool use
  "agent.agent": "agent",
  "research.clarify": "agent",
  "research.brief": "agent",

  // Chat — standard reasoning, cost-effective
  "agent.chat": "chat",
  "extract.pdf-evidence": "chat",
  "extract.profile": "chat",
  "plan.coding": "chat",
  "bg.session-title": "chat",
  "bg.extract-keywords": "chat",
  "bg.annotate-comment": "chat",
  "ctx.summarize": "chat",
  "compact.task": "agent",

  // Translation — dedicated language task
  "translate.text": "translation",
  "translate.reader": "translation",

  // Metadata — paper metadata extraction & scoring → uses agent model
  "metadata.extract": "agent",
  "bg.paper-scorer": "agent",

  // Cross-domain discovery — structured analysis with reasoning
  // "crossdomain.analysis" 已随跨域发现整域退役（断裂审计 2026-09-12）。

  // Tracking — declarative LLM change detector (phase 3); uses chat model
  "tracking.detect": "chat",
};

class ModelRouter {
  /** Resolve a task to an AI provider via feature routing */
  resolve(taskKey: string): IAIProvider | null {
    const feature = TASK_FEATURE_MAP[taskKey] || "chat";
    return AIProviderRegistry.getProviderForFeature(feature);
  }

  /** Get the model ID for a task (for cost tracking) */
  resolveModelId(taskKey: string): string {
    const feature = TASK_FEATURE_MAP[taskKey] || "chat";
    return ConfigManager.getModelForFeature(feature);
  }
}

const modelRouter = new ModelRouter();
export default modelRouter;
export { TASK_FEATURE_MAP };
