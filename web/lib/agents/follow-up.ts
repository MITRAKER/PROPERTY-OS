import { extractLeadsWithAnthropic, extractLocally } from "../extraction.ts";
import type { ExtractionBatch, ExtractionMetrics, LeadExtraction } from "../extraction.ts";
import type { LeadRecord } from "../briefing.ts";
import type { AnthropicClientLike } from "./anthropic.ts";
import type { ModelRunLog } from "./types.ts";

export type Sentiment = "open_but_not_ready" | "warm" | "cold" | "neutral";

export type FollowUpResult = LeadExtraction & {
  sentiment: Sentiment;
  recommendedFollowUp: string | null;
};

export type FollowUpBatch = {
  results: FollowUpResult[];
  run: ModelRunLog;
  metrics: ExtractionMetrics;
};

function detectSentiment(extraction: LeadExtraction, note: string): Sentiment {
  if (extraction.doNotContact) return "cold";
  if (/\b(?:not\s+(?:selling|ready)|no\s+interest|keeping\b|next\s+spring)\b/i.test(note)) {
    return "open_but_not_ready";
  }
  if (extraction.motivation === "possible_sale" && extraction.followUpRequested) return "warm";
  if (extraction.motivation === "not_selling") return "cold";
  return "neutral";
}

function toRun(batch: ExtractionBatch): ModelRunLog {
  return {
    agent: "follow_up",
    provider: batch.metrics.provider,
    model: batch.metrics.model,
    latencyMs: batch.metrics.latencyMs,
    inputTokens: batch.metrics.inputTokens,
    outputTokens: batch.metrics.outputTokens,
    estimatedCostUsd: batch.metrics.estimatedCostUsd,
    fallbackCount: batch.metrics.fallbackCount,
    summary: `Analyzed ${batch.extractions.length} lead notes for motivation, timing, and permission.`,
  };
}

function decorate(batch: ExtractionBatch, leads: LeadRecord[]): FollowUpBatch {
  const noteByRow = new Map(leads.map((lead) => [lead.rowNumber, lead.notes]));
  const results = batch.extractions.map((extraction) => ({
    ...extraction,
    sentiment: detectSentiment(extraction, noteByRow.get(extraction.rowNumber) ?? ""),
    recommendedFollowUp: extraction.followUpDate,
  }));
  return { results, run: toRun(batch), metrics: batch.metrics };
}

// Follow-Up Agent: analyzes CRM notes/transcripts for motivation, timeline,
// promises, sentiment, and next action. It proposes; deterministic code and the
// human approval gate decide what actually gets written or sent.
export async function runFollowUpAgent(
  leads: LeadRecord[],
  options: {
    apiKey?: string;
    model?: string;
    fallbackModel?: string;
    enableOpusFallback?: boolean;
    now?: Date;
    client?: AnthropicClientLike;
  } = {},
): Promise<FollowUpBatch> {
  const now = options.now ?? new Date();

  if (!options.apiKey && !options.client) {
    return decorate(
      extractLocally(leads, now, "No Anthropic key configured; the Follow-Up Agent used the deterministic local model."),
      leads,
    );
  }

  try {
    const batch = await extractLeadsWithAnthropic(leads, {
      apiKey: options.apiKey ?? "local",
      model: options.model,
      fallbackModel: options.fallbackModel,
      enableOpusFallback: options.enableOpusFallback,
      now,
      client: options.client,
    });
    return decorate(batch, leads);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown error";
    return decorate(
      extractLocally(leads, now, `Claude was unavailable (${detail}); the Follow-Up Agent used the deterministic local model.`),
      leads,
    );
  }
}
