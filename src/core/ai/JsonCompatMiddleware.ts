import { injectJsonInstructionIntoMessages } from "@ai-sdk/provider-utils";
import type { LanguageModelMiddleware } from "ai";

/**
 * JSON compatibility layer for OpenAI-compatible gateways without native
 * structured outputs.
 *
 * The SDK's own degradation (openai-compatible with supportsStructuredOutputs
 * unset) only downgrades to `response_format: {type: "json_object"}` and DROPS
 * the schema — no instruction injection happens anywhere in the SDK, so the
 * model never learns the expected shape. This middleware restores lossless
 * behaviour at the SDK layer: strip responseFormat entirely (strict gateways
 * 400 on any response_format) and inject the JSON schema instruction into the
 * prompt instead. generateObject complements this with a brace-matching
 * repairText for replies wrapped in prose or code fences.
 */
export function createJsonCompatMiddleware(): LanguageModelMiddleware {
  return {
    specificationVersion: "v4",
    async transformParams({ params }) {
      const responseFormat = params.responseFormat;
      if (responseFormat?.type !== "json" || !responseFormat.schema) {
        return params;
      }
      return {
        ...params,
        responseFormat: undefined,
        prompt: injectJsonInstructionIntoMessages({
          messages: params.prompt,
          schema: responseFormat.schema,
        }),
      };
    },
  };
}
