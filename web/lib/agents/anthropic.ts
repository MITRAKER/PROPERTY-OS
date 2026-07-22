import Anthropic from "@anthropic-ai/sdk";
import { estimateClaudeCost } from "../extraction.ts";
import type { AnthropicClientLike } from "../extraction.ts";

export type { AnthropicClientLike };
export { estimateClaudeCost };

export function createAnthropicClient(apiKey: string): AnthropicClientLike {
  return new Anthropic({ apiKey }) as unknown as AnthropicClientLike;
}

export type StructuredCall = {
  model: string;
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
};

export type StructuredResult<T> = {
  data: T;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
};

// Single place that talks to Claude with JSON-schema structured output. Every
// specialist agent goes through here so latency, tokens, and cost are measured
// the same way and can be logged as an auditable model run.
export async function callStructuredJson<T>(
  client: AnthropicClientLike,
  call: StructuredCall,
): Promise<StructuredResult<T>> {
  const startedAt = Date.now();
  const response = await client.messages.create({
    model: call.model,
    max_tokens: call.maxTokens ?? 2_000,
    temperature: 0,
    system: call.system,
    messages: [{ role: "user", content: call.prompt }],
    output_config: {
      format: {
        type: "json_schema",
        schema: call.schema,
      },
    },
  });

  const text = response.content.find((block) => block.type === "text")?.text;
  if (!text) throw new Error("Claude returned no structured content.");
  const data = JSON.parse(text) as T;
  const inputTokens = response.usage?.input_tokens ?? 0;
  const outputTokens = response.usage?.output_tokens ?? 0;

  return {
    data,
    inputTokens,
    outputTokens,
    costUsd: estimateClaudeCost(call.model, inputTokens, outputTokens),
    latencyMs: Date.now() - startedAt,
  };
}
