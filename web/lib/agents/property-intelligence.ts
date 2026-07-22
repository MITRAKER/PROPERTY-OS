import { callStructuredJson } from "./anthropic.ts";
import type { AnthropicClientLike } from "./anthropic.ts";
import type { ModelRunLog, PropertyFacts, PropertyIntelligenceResult, PropertySignal } from "./types.ts";
import type { PropertyContext } from "./property-context.ts";

const SIGNAL_RULES: Array<[RegExp, string]> = [
  [/\b(?:inherit(?:ed|ance)|probate|estate)\b/i, "inheritance_or_estate"],
  [/\b(?:violat(?:ion|n)|dob)\b/i, "property_violation"],
  [/\b(?:tax\s+(?:lien|lein))\b/i, "tax_lien"],
  [/\b(?:vacant|vacancy)\b/i, "vacancy"],
  [/\b(?:absentee|out\s+of\s+state|tenant\s+occupied)\b/i, "absentee_owner"],
  [/\bexpired\s+listing\b/i, "expired_listing"],
  [/\b(?:landlord\s+tired|tired\s+of\s+repairs)\b/i, "landlord_fatigue"],
  [/\b(?:permit|contractor\s+issue)\b/i, "permit_or_repair_issue"],
];

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          propertyId: { type: "string" },
          recommendedPriority: { type: "string", enum: ["high", "medium", "low"] },
          explanation: { type: "string" },
          signals: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                type: { type: "string" },
                value: { type: "string" },
                source: { type: "string" },
              },
              required: ["type", "value", "source"],
            },
          },
        },
        required: ["propertyId", "recommendedPriority", "explanation", "signals"],
      },
    },
  },
  required: ["results"],
} as const;

function localSignals(facts: PropertyFacts): PropertySignal[] {
  const signals: PropertySignal[] = [];
  const haystack = `${facts.notes} ${(facts.signalLabels ?? []).join(" ")}`;
  for (const [pattern, type] of SIGNAL_RULES) {
    if (pattern.test(haystack)) {
      signals.push({ type, value: type.replace(/_/g, " "), source: "lead_note" });
    }
  }
  if ((facts.ownershipYears ?? 0) >= 20) {
    signals.push({ type: "ownership_length", value: `${facts.ownershipYears} years`, source: "property_record" });
  }
  return signals;
}

function localPriority(facts: PropertyFacts, signals: PropertySignal[]): "high" | "medium" | "low" {
  const strong = signals.some((signal) =>
    ["inheritance_or_estate", "expired_listing", "property_violation"].includes(signal.type),
  );
  if (facts.followUpDate && strong) return "high";
  if (facts.followUpDate || strong) return "medium";
  return "low";
}

function interpretLocally(facts: PropertyFacts): PropertyIntelligenceResult {
  const signals = localSignals(facts);
  const priority = localPriority(facts, signals);
  const reasonParts = signals.map((signal) => signal.value);
  if (facts.followUpDate) reasonParts.push(`follow-up on ${facts.followUpDate}`);
  const explanation = reasonParts.length
    ? `Evidence: ${reasonParts.join(", ")}.`
    : "No strong opportunity signals in the current record.";
  return { propertyId: facts.id, signals, recommendedPriority: priority, explanation };
}

// Property Intelligence Agent: interprets the property records we hold into
// source-backed signals and a suggested priority. It never invents facts and it
// does not own the final score — deterministic ranking code does.
export async function runPropertyIntelligenceAgent(
  properties: PropertyFacts[],
  options: { apiKey?: string; model?: string; client?: AnthropicClientLike } = {},
): Promise<{ results: PropertyIntelligenceResult[]; run: ModelRunLog }> {
  const startedAt = Date.now();
  const localResults = properties.map(interpretLocally);

  if (!options.apiKey && !options.client) {
    return {
      results: localResults,
      run: localRun(properties.length, Date.now() - startedAt),
    };
  }

  try {
    const model = options.model ?? "claude-haiku-4-5";
    const client = options.client ?? (await import("./anthropic.ts")).createAnthropicClient(options.apiKey ?? "");
    const call = await callStructuredJson<{ results: PropertyIntelligenceResult[] }>(client, {
      model,
      system: "You interpret real-estate property records into evidence-backed opportunity signals. Never invent facts. Never use age, race, religion, disability, familial status, sex, or national origin as a signal.",
      prompt: intelligencePrompt(properties),
      schema: SCHEMA,
      maxTokens: 3_000,
    });

    const byId = new Map(call.data.results.map((result) => [result.propertyId, result]));
    const results = properties.map((facts, index) => byId.get(facts.id) ?? localResults[index]);

    return {
      results,
      run: {
        agent: "property_intelligence",
        provider: "claude",
        model,
        latencyMs: call.latencyMs,
        inputTokens: call.inputTokens,
        outputTokens: call.outputTokens,
        estimatedCostUsd: call.costUsd,
        fallbackCount: 0,
        summary: `Interpreted ${properties.length} property records into opportunity signals.`,
      },
    };
  } catch {
    return {
      results: localResults,
      run: localRun(properties.length, Date.now() - startedAt),
    };
  }
}

function localRun(count: number, latencyMs: number): ModelRunLog {
  return {
    agent: "property_intelligence",
    provider: "local_fallback",
    model: "deterministic-local-v1",
    latencyMs,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0,
    fallbackCount: 0,
    summary: `Interpreted ${count} property records with the deterministic local model.`,
  };
}

function intelligencePrompt(properties: PropertyFacts[]) {
  return `Interpret these property records into opportunity signals. Return only supported facts.

${JSON.stringify(
  properties.map((property) => ({
    propertyId: property.id,
    address: property.address,
    ownershipYears: property.ownershipYears ?? null,
    lastContact: property.lastContact ?? null,
    followUpDate: property.followUpDate ?? null,
    knownSignals: property.signalLabels ?? [],
    notes: property.notes,
  })),
)}`;
}

// --- PropertyContext analysis (data-provider-driven path) ---
// This is the agent's single-property entry point. It analyzes a normalized
// PropertyContext produced by a data provider (demo today, NYC Open Data later)
// and NEVER fetches, scrapes, or invents. Every signal cites the evidence and the
// source it came from. The data source can be swapped without changing this code.

export type AnalyzedSignal = {
  type: string;
  evidence: string;
  source: string;
  confidence: "high" | "medium" | "low";
};

export type PropertyIntelligenceReport = {
  propertyId: string;
  address: string;
  signals: AnalyzedSignal[];
  recommendedPriority: "high" | "medium" | "low";
  missingInformation: string[];
  sources: PropertyContext["sources"];
};

// Order matters: more specific patterns come first (e.g. "satisfaction of
// mortgage" before "mortgage").
const PUBLIC_SIGNAL_MAP: Array<[RegExp, string, "high" | "medium" | "low"]> = [
  [/estate|probate|inherit/i, "inheritance_or_estate", "high"],
  [/expired\s*listing/i, "expired_listing", "high"],
  [/lien/i, "tax_lien", "high"],
  [/violation/i, "property_violation", "medium"],
  [/vacan/i, "vacancy", "medium"],
  [/absentee/i, "absentee_owner", "medium"],
  [/permit|repair/i, "permit_or_repair_issue", "medium"],
  [/satisfaction\s+of\s+mortgage|\(sat\)/i, "mortgage_satisfied", "medium"],
  [/mortgage|\(mtge\)/i, "recorded_mortgage", "low"],
  [/\bdeed\b|\(deed\)|property\s+transfer|\(rptt\)|conveyance/i, "ownership_transfer", "low"],
];

function mapPublicSignal(description: string): { type: string; confidence: "high" | "medium" | "low" } {
  for (const [pattern, type, confidence] of PUBLIC_SIGNAL_MAP) {
    if (pattern.test(description)) {
      const escalated = type === "property_violation" && /\bopen\b|active/i.test(description);
      return { type, confidence: escalated ? "high" : confidence };
    }
  }
  return { type: "public_record_signal", confidence: "low" };
}

export function analyzePropertyContext(context: PropertyContext): {
  report: PropertyIntelligenceReport;
  run: ModelRunLog;
} {
  const startedAt = Date.now();
  const signals: AnalyzedSignal[] = [];

  for (const publicSignal of context.publicSignals) {
    if (publicSignal.type === "building_age") continue;
    const mapped = mapPublicSignal(`${publicSignal.type} ${publicSignal.description}`);
    signals.push({
      type: mapped.type,
      evidence: publicSignal.description,
      source: publicSignal.source,
      confidence: mapped.confidence,
    });
  }

  for (const event of context.crmTimeline) {
    if (/\b(?:call|reach|follow[\s-]?up|reconnect|call\s+back|cb)\b/i.test(event.text)) {
      signals.push({ type: "follow_up_commitment", evidence: event.text, source: "crm_timeline", confidence: "high" });
    } else if (/\b(?:sell|list|offer|cash\s*out|downsiz)\b/i.test(event.text)) {
      signals.push({ type: "seller_interest", evidence: event.text, source: "crm_timeline", confidence: "medium" });
    } else if (/\b(?:not\s+selling|keeping|no\s+interest)\b/i.test(event.text)) {
      signals.push({ type: "not_selling", evidence: event.text, source: "crm_timeline", confidence: "high" });
    }
  }

  if ((context.facts.ownershipYears ?? 0) >= 20) {
    signals.push({
      type: "long_ownership",
      evidence: `${context.facts.ownershipYears} years of ownership on record`,
      source: "property_record",
      confidence: "high",
    });
  }

  const has = (type: string) => signals.some((signal) => signal.type === type);
  const strongOpportunity = signals.some((signal) =>
    ["inheritance_or_estate", "expired_listing", "seller_interest", "property_violation", "follow_up_commitment"].includes(signal.type),
  );
  let recommendedPriority: "high" | "medium" | "low";
  if (has("not_selling") && !has("seller_interest")) recommendedPriority = "low";
  else if (strongOpportunity && (has("follow_up_commitment") || has("seller_interest"))) recommendedPriority = "high";
  else if (strongOpportunity) recommendedPriority = "medium";
  else recommendedPriority = "low";

  // De-duplicate identical evidence and cap repeats per type so one busy category
  // (e.g. many DOB permits) does not crowd out other signals.
  const seen = new Set<string>();
  const perType = new Map<string, number>();
  const curated: AnalyzedSignal[] = [];
  for (const signal of signals) {
    const key = `${signal.type}::${signal.evidence}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const count = (perType.get(signal.type) ?? 0) + 1;
    perType.set(signal.type, count);
    if (count > 3) continue;
    curated.push(signal);
  }

  const report: PropertyIntelligenceReport = {
    propertyId: context.propertyId,
    address: context.address,
    signals: curated.slice(0, 12),
    recommendedPriority,
    missingInformation: context.missingInformation,
    sources: context.sources,
  };

  return {
    report,
    run: {
      agent: "property_intelligence",
      provider: "local_fallback",
      model: "deterministic-context-v1",
      latencyMs: Date.now() - startedAt,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      fallbackCount: 0,
      summary: `Analyzed ${context.provenance} PropertyContext for ${context.address}: ${signals.length} evidence-backed signals.`,
    },
  };
}
