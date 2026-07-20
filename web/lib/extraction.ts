import Anthropic from "@anthropic-ai/sdk";
import type { LeadRecord } from "./briefing.ts";

export type Motivation = "possible_sale" | "not_selling" | "unclear";
export type Confidence = "high" | "medium" | "low";
export type RecommendedAction = "call" | "review" | "wait" | "do_not_contact";

export type LeadExtraction = {
  rowNumber: number;
  summary: string;
  followUpRequested: boolean;
  followUpDate: string | null;
  motivation: Motivation;
  doNotContact: boolean;
  propertySignals: string[];
  recommendedAction: RecommendedAction;
  evidenceQuotes: string[];
  confidence: Confidence;
};

export type ExtractionMetrics = {
  provider: "claude" | "local_fallback";
  model: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  fallbackCount: number;
  warning: string | null;
};

export type ExtractionBatch = {
  extractions: LeadExtraction[];
  metrics: ExtractionMetrics;
};

type AnthropicMessageResponse = {
  content: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
};

export type AnthropicClientLike = {
  messages: {
    create: (input: Record<string, unknown>) => Promise<AnthropicMessageResponse>;
  };
};

const MOTIVATIONS: Motivation[] = ["possible_sale", "not_selling", "unclear"];
const ACTIONS: RecommendedAction[] = ["call", "review", "wait", "do_not_contact"];
const CONFIDENCES: Confidence[] = ["high", "medium", "low"];
const DNC_PATTERN = /\b(?:dnc|do\s+not\s+(?:call|contact)|don't\s+(?:call|contact)|never\s+call|remove\s+me|stop\s+contacting)\b/i;
const FOLLOW_UP_PATTERN = /\b(?:call(?:\s+me|\s+back)?|cb|follow[ -]?up|reach\s+out)\b/i;

const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    extractions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          rowNumber: { type: "integer" },
          summary: { type: "string" },
          followUpRequested: { type: "boolean" },
          followUpDate: { type: ["string", "null"] },
          motivation: { type: "string", enum: MOTIVATIONS },
          doNotContact: { type: "boolean" },
          propertySignals: { type: "array", items: { type: "string" } },
          recommendedAction: { type: "string", enum: ACTIONS },
          evidenceQuotes: { type: "array", items: { type: "string" } },
          confidence: { type: "string", enum: CONFIDENCES },
        },
        required: [
          "rowNumber",
          "summary",
          "followUpRequested",
          "followUpDate",
          "motivation",
          "doNotContact",
          "propertySignals",
          "recommendedAction",
          "evidenceQuotes",
          "confidence",
        ],
      },
    },
  },
  required: ["extractions"],
} as const;

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(now: Date, days: number) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days));
}

function dateForWeekday(now: Date, weekday: number, forceNextWeek: boolean) {
  let daysAhead = (weekday - now.getUTCDay() + 7) % 7;
  if (forceNextWeek) daysAhead = daysAhead === 0 ? 7 : daysAhead + 7;
  return toIsoDate(addDays(now, daysAhead));
}

function extractFollowUpDate(lead: LeadRecord, now: Date): string | null {
  if (isIsoDate(lead.followUpDate)) return lead.followUpDate;

  const note = lead.notes;
  if (/\btomorrow\b/i.test(note)) return toIsoDate(addDays(now, 1));

  const weeks = note.match(/\bin\s+(\d{1,2})\s+w(?:ee)?ks?\b/i);
  if (weeks) return toIsoDate(addDays(now, Number(weeks[1]) * 7));

  const weekdayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const weekday = note.match(/\b(?:(next|nxt)\s+)?(sun(?:day)?|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?)\b/i);
  if (weekday) {
    const prefix = weekday[2].toLowerCase().slice(0, 3);
    const index = weekdayNames.findIndex((name) => name.startsWith(prefix));
    if (index >= 0) return dateForWeekday(now, index, Boolean(weekday[1]));
  }

  const iso = note.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso && isIsoDate(iso[1])) return iso[1];

  const shortDate = note.match(/\b(0?[1-9]|1[0-2])[/-](0?[1-9]|[12]\d|3[01])(?:[/-](\d{2,4}))?\b/);
  if (shortDate) {
    const yearText = shortDate[3];
    const year = yearText ? Number(yearText.length === 2 ? `20${yearText}` : yearText) : now.getUTCFullYear();
    const candidate = `${year}-${shortDate[1].padStart(2, "0")}-${shortDate[2].padStart(2, "0")}`;
    if (isIsoDate(candidate)) return candidate;
  }

  return null;
}

function detectMotivation(note: string): Motivation {
  if (/\b(?:not\s+(?:for\s+sale|selling)|no\s+interest\s+in\s+selling|keeping\s+(?:it|as)|never\s+selling)\b/i.test(note)) {
    return "not_selling";
  }
  if (/\b(?:inherit(?:ed|ance)|probate|estate\s+sale|sell(?:ing)?|listing|list\b|offer|cash\s+out|downsiz|expired\s+listing)\b/i.test(note)) {
    return "possible_sale";
  }
  return "unclear";
}

function detectSignals(note: string) {
  const definitions: Array<[RegExp, string]> = [
    [/\b(?:inherit(?:ed|ance)|probate|estate)\b/i, "inheritance_or_estate"],
    [/\b(?:violat(?:ion|n)|dob)\b/i, "property_violation"],
    [/\b(?:tax\s+(?:lien|lein))\b/i, "tax_lien"],
    [/\b(?:vacant|vacancy)\b/i, "vacancy"],
    [/\b(?:absentee|out\s+of\s+state)\b/i, "absentee_owner"],
    [/\bexpired\s+listing\b/i, "expired_listing"],
    [/\b(?:landlord\s+tired|tired\s+of\s+repairs)\b/i, "landlord_fatigue"],
    [/\b(?:permit|contractor\s+issue)\b/i, "permit_or_repair_issue"],
  ];
  return definitions.filter(([pattern]) => pattern.test(note)).map(([, label]) => label);
}

function evidenceFor(note: string) {
  const compact = note.replace(/\s+/g, " ").trim();
  return compact ? [compact.slice(0, 220)] : [];
}

function localExtractOne(lead: LeadRecord, now: Date): LeadExtraction {
  const doNotContact = DNC_PATTERN.test(lead.notes);
  const motivation = detectMotivation(lead.notes);
  const blocksFollowUp = /\b(?:no\s+permission\s+to\s+call|no\s+callback\s+request)\b/i.test(lead.notes);
  const followUpRequested = !doNotContact && !blocksFollowUp && (Boolean(lead.followUpDate) || FOLLOW_UP_PATTERN.test(lead.notes));
  const followUpDate = followUpRequested ? extractFollowUpDate(lead, now) : null;
  const propertySignals = detectSignals(lead.notes);
  const ambiguity = /\b(?:conflicting|wrong\s+address|verify|date\s+unknown|no\s+owner\s+convo|no\s+permission)\b|\?/i.test(lead.notes);

  let recommendedAction: RecommendedAction = "review";
  if (doNotContact) recommendedAction = "do_not_contact";
  else if (motivation === "not_selling" && !followUpRequested) recommendedAction = "wait";
  else if (followUpRequested && followUpDate) recommendedAction = "call";

  let confidence: Confidence = "medium";
  if (doNotContact || (followUpRequested && followUpDate && !ambiguity)) confidence = "high";
  else if (ambiguity || (followUpRequested && !followUpDate)) confidence = "low";

  return {
    rowNumber: lead.rowNumber,
    summary: lead.notes.replace(/\s+/g, " ").trim().slice(0, 180),
    followUpRequested,
    followUpDate,
    motivation,
    doNotContact,
    propertySignals,
    recommendedAction,
    evidenceQuotes: evidenceFor(lead.notes),
    confidence,
  };
}

export function extractLocally(leads: LeadRecord[], now = new Date(), warning: string | null = null): ExtractionBatch {
  const startedAt = Date.now();
  const extractions = leads.map((lead) => localExtractOne(lead, now));
  return {
    extractions,
    metrics: {
      provider: "local_fallback",
      model: "deterministic-local-v1",
      latencyMs: Date.now() - startedAt,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      fallbackCount: 0,
      warning,
    },
  };
}

function modelRates(model: string) {
  if (model.includes("opus-4-8")) return { input: 5, output: 25 };
  return { input: 1, output: 5 };
}

export function estimateClaudeCost(model: string, inputTokens: number, outputTokens: number) {
  const rates = modelRates(model);
  return (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000;
}

function parseResponse(response: AnthropicMessageResponse) {
  const text = response.content.find((block) => block.type === "text")?.text;
  if (!text) throw new Error("Claude returned no structured extraction content.");
  const parsed = JSON.parse(text) as { extractions?: unknown };
  if (!Array.isArray(parsed.extractions)) throw new Error("Claude returned an invalid extraction list.");
  return parsed.extractions;
}

function validateExtraction(candidate: unknown, lead: LeadRecord, local: LeadExtraction): LeadExtraction {
  if (!candidate || typeof candidate !== "object") return local;
  const value = candidate as Record<string, unknown>;
  if (value.rowNumber !== lead.rowNumber) return local;

  const motivation = MOTIVATIONS.includes(value.motivation as Motivation) ? value.motivation as Motivation : local.motivation;
  const confidence = CONFIDENCES.includes(value.confidence as Confidence) ? value.confidence as Confidence : "low";
  let recommendedAction = ACTIONS.includes(value.recommendedAction as RecommendedAction)
    ? value.recommendedAction as RecommendedAction
    : local.recommendedAction;
  const followUpDate = value.followUpDate === null || isIsoDate(value.followUpDate) ? value.followUpDate : null;
  const evidenceQuotes = Array.isArray(value.evidenceQuotes)
    ? value.evidenceQuotes.filter((quote): quote is string => typeof quote === "string" && quote.length > 0 && lead.notes.includes(quote)).slice(0, 3)
    : [];
  const deterministicDnc = DNC_PATTERN.test(lead.notes);
  const doNotContact = deterministicDnc || value.doNotContact === true;
  if (doNotContact) recommendedAction = "do_not_contact";

  return {
    rowNumber: lead.rowNumber,
    summary: typeof value.summary === "string" && value.summary.trim() ? value.summary.trim().slice(0, 240) : local.summary,
    followUpRequested: typeof value.followUpRequested === "boolean" ? value.followUpRequested : local.followUpRequested,
    followUpDate,
    motivation,
    doNotContact,
    propertySignals: Array.isArray(value.propertySignals)
      ? value.propertySignals.filter((signal): signal is string => typeof signal === "string").slice(0, 8)
      : local.propertySignals,
    recommendedAction,
    evidenceQuotes: evidenceQuotes.length ? evidenceQuotes : local.evidenceQuotes,
    confidence: deterministicDnc ? "high" : confidence,
  };
}

function extractionPrompt(leads: LeadRecord[], now: Date) {
  return `Today is ${toIsoDate(now)}. Extract only facts supported by each imported record.

Rules:
- Treat each property as the record. Do not rank records.
- Never use age, race, religion, disability, familial status, sex, national origin, or another protected trait.
- A follow-up date must be YYYY-MM-DD or null. Resolve relative dates using today's date.
- Set doNotContact when the note requests no calls/contact, and recommend do_not_contact.
- Evidence quotes must be exact substrings from the note.
- Use low confidence and recommend review when facts conflict, the address may be wrong, or timing is unclear.
- Do not invent property facts, intent, permissions, or dates.

Records:
${JSON.stringify(leads.map((lead) => ({
  rowNumber: lead.rowNumber,
  address: lead.address,
  ownerName: lead.ownerName,
  lastContact: lead.lastContact || null,
  importedFollowUpDate: lead.followUpDate || null,
  notes: lead.notes,
})))}`;
}

async function callClaude(client: AnthropicClientLike, model: string, leads: LeadRecord[], now: Date) {
  const response = await client.messages.create({
    model,
    max_tokens: 5_000,
    temperature: 0,
    system: "You extract auditable real-estate CRM note fields. Return only the requested structured output.",
    messages: [{ role: "user", content: extractionPrompt(leads, now) }],
    output_config: {
      format: {
        type: "json_schema",
        schema: EXTRACTION_SCHEMA,
      },
    },
  });
  return {
    candidates: parseResponse(response),
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
  };
}

export async function extractLeadsWithAnthropic(
  leads: LeadRecord[],
  options: {
    apiKey: string;
    model?: string;
    fallbackModel?: string;
    enableOpusFallback?: boolean;
    now?: Date;
    client?: AnthropicClientLike;
  },
): Promise<ExtractionBatch> {
  const now = options.now ?? new Date();
  const model = options.model ?? "claude-haiku-4-5";
  const fallbackModel = options.fallbackModel ?? "claude-opus-4-8";
  const client = options.client ?? (new Anthropic({ apiKey: options.apiKey }) as unknown as AnthropicClientLike);
  const local = extractLocally(leads, now).extractions;
  const startedAt = Date.now();
  const primary = await callClaude(client, model, leads, now);
  const byRow = new Map(
    primary.candidates
      .filter((candidate): candidate is Record<string, unknown> => Boolean(candidate && typeof candidate === "object"))
      .map((candidate) => [candidate.rowNumber, candidate]),
  );
  const extractions = leads.map((lead, index) => validateExtraction(byRow.get(lead.rowNumber), lead, local[index]));

  let inputTokens = primary.inputTokens;
  let outputTokens = primary.outputTokens;
  let estimatedCostUsd = estimateClaudeCost(model, inputTokens, outputTokens);
  let fallbackCount = 0;

  if (options.enableOpusFallback) {
    for (let index = 0; index < extractions.length; index += 1) {
      if (extractions[index].confidence !== "low") continue;
      const fallback = await callClaude(client, fallbackModel, [leads[index]], now);
      const candidate = fallback.candidates[0];
      extractions[index] = validateExtraction(candidate, leads[index], extractions[index]);
      inputTokens += fallback.inputTokens;
      outputTokens += fallback.outputTokens;
      estimatedCostUsd += estimateClaudeCost(fallbackModel, fallback.inputTokens, fallback.outputTokens);
      fallbackCount += 1;
    }
  }

  return {
    extractions,
    metrics: {
      provider: "claude",
      model,
      latencyMs: Date.now() - startedAt,
      inputTokens,
      outputTokens,
      estimatedCostUsd,
      fallbackCount,
      warning: null,
    },
  };
}
