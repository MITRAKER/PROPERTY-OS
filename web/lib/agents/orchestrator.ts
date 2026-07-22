import type { PropertyRecord } from "../property-model.ts";
import type { AnthropicClientLike } from "./anthropic.ts";
import { DEFAULT_PERMISSION } from "./compliance.ts";
import type { ContactPermission } from "./compliance.ts";
import { runPropertyIntelligenceAgent } from "./property-intelligence.ts";
import { runOutreachAgent } from "./outreach-compliance.ts";
import type { ComplianceCheck, ModelRunLog, OutreachChannel, PropertyFacts } from "./types.ts";

export type OrchestratorIntent =
  | "prioritize"
  | "property_status"
  | "draft_outreach"
  | "prospecting_plan"
  | "help";

export type OrchestratorRecommendation = {
  propertyId: string;
  address: string;
  ownerName: string;
  reason: string;
  action: string;
  priority: "high" | "medium" | "low";
};

export type OrchestratorDraft = {
  propertyId: string;
  address: string;
  channel: OutreachChannel;
  allowed: boolean;
  message: string;
  complianceWarnings: string[];
  checks: ComplianceCheck[];
};

export type OrchestratorResponse = {
  intent: OrchestratorIntent;
  reply: string;
  recommendations: OrchestratorRecommendation[];
  drafts: OrchestratorDraft[];
  trace: ModelRunLog[];
};

export type OrchestratorContext = {
  properties: PropertyRecord[];
  permissions?: Record<string, ContactPermission>;
  apiKey?: string;
  client?: AnthropicClientLike;
  now?: Date;
};

const OUTREACH_WORDS = /\b(?:draft|write|compose|email|e-mail|script|letter|text|reach\s+out|follow[- ]?up\s+with|outreach|message)\b/i;
const STATUS_WORDS = /\b(?:status|happened|what'?s\s+(?:going\s+on|up)|tell\s+me\s+about|update\s+on|history)\b/i;
const PLAN_WORDS = /\b(?:plan|prospect|farm|route|door[- ]?knock|neighborhood|area)\b/i;

function permissionFor(context: OrchestratorContext, propertyId: string): ContactPermission {
  return context.permissions?.[propertyId] ?? DEFAULT_PERMISSION;
}

function toFacts(property: PropertyRecord): PropertyFacts {
  return {
    id: property.id,
    address: property.address,
    ownerName: property.ownerName,
    neighborhood: property.neighborhood,
    ownershipYears: property.ownershipYears,
    lastContact: property.lastContact,
    followUpDate: property.followUpDate,
    notes: `${property.summary} ${property.signals.join(", ")}`,
    signalLabels: property.signals,
  };
}

function matchProperty(message: string, properties: PropertyRecord[]): PropertyRecord | null {
  const lower = message.toLowerCase();
  let best: { property: PropertyRecord; weight: number } | null = null;
  for (const property of properties) {
    const address = property.address.toLowerCase();
    const streetNumber = address.split(" ")[0];
    const ownerLast = property.ownerName.toLowerCase().split(" ").pop() ?? "";
    let weight = 0;
    if (lower.includes(address)) weight = Math.max(weight, 100);
    if (property.ownerName && lower.includes(property.ownerName.toLowerCase())) weight = Math.max(weight, 90);
    if (streetNumber.length >= 2 && lower.includes(streetNumber)) weight = Math.max(weight, 40);
    if (ownerLast.length >= 3 && new RegExp(`\\b${ownerLast}\\b`).test(lower)) weight = Math.max(weight, 50);
    if (weight > 0 && (!best || weight > best.weight)) best = { property, weight };
  }
  return best?.property ?? null;
}

export function classifyIntent(message: string): OrchestratorIntent {
  const text = message.trim();
  if (!text) return "help";
  if (OUTREACH_WORDS.test(text)) return "draft_outreach";
  if (STATUS_WORDS.test(text)) return "property_status";
  if (PLAN_WORDS.test(text) && !/\bcall\b/i.test(text)) return "prospecting_plan";
  return "prioritize";
}

function detectChannel(message: string): OutreachChannel {
  if (/\b(?:e-?mail)\b/i.test(message)) return "email";
  if (/\b(?:letter|mail)\b/i.test(message)) return "direct_mail";
  if (/\b(?:text|sms)\b/i.test(message)) return "text";
  return "call";
}

function eligible(context: OrchestratorContext): PropertyRecord[] {
  return context.properties.filter((property) => !permissionFor(context, property.id).doNotContact);
}

// Orchestrator Agent: understands intent, calls the specialists as tools,
// combines their structured results, applies deterministic ranking, and requires
// human approval before any consequential action. It is the only agent the user
// talks to directly.
export async function runOrchestrator(
  message: string,
  context: OrchestratorContext,
): Promise<OrchestratorResponse> {
  const intent = classifyIntent(message);
  const trace: ModelRunLog[] = [];

  if (intent === "draft_outreach") {
    const target = matchProperty(message, context.properties);
    if (!target) {
      return {
        intent,
        reply: "Tell me which property or owner to draft for (for example, \"draft an email for 123 Main Street\").",
        recommendations: [],
        drafts: [],
        trace,
      };
    }
    const channel = detectChannel(message);
    const { result, run } = await runOutreachAgent(
      {
        property: toFacts(target),
        channel,
        permission: permissionFor(context, target.id),
        rationale: `${target.summary} Recommended next action: ${target.nextAction}`,
      },
      { apiKey: context.apiKey, client: context.client },
    );
    trace.push(run);
    const reply = result.allowed
      ? `I drafted a ${channel.replace("_", " ")} for ${target.address}. It is held for your approval and will not be sent automatically.`
      : `I cannot draft outreach for ${target.address}: ${result.complianceWarnings.join(" ") || "compliance checks blocked it."}`;
    return {
      intent,
      reply,
      recommendations: [],
      drafts: [
        {
          propertyId: target.id,
          address: target.address,
          channel: result.channel,
          allowed: result.allowed,
          message: result.message,
          complianceWarnings: result.complianceWarnings,
          checks: result.checks,
        },
      ],
      trace,
    };
  }

  if (intent === "property_status") {
    const target = matchProperty(message, context.properties);
    if (!target) {
      return {
        intent,
        reply: "Which property would you like an update on? Name the address or owner.",
        recommendations: [],
        drafts: [],
        trace,
      };
    }
    const reply = `${target.address} (${target.ownerName}): ${target.summary} Signals: ${target.signals.join(", ") || "none on file"}. Follow-up: ${target.followUpDate ?? "needs review"}. Last contact: ${target.lastContact || "unknown"}.`;
    return {
      intent,
      reply,
      recommendations: [
        {
          propertyId: target.id,
          address: target.address,
          ownerName: target.ownerName,
          reason: target.summary,
          action: target.nextAction,
          priority: target.score >= 90 ? "high" : target.score >= 75 ? "medium" : "low",
        },
      ],
      drafts: [],
      trace,
    };
  }

  // prioritize + prospecting_plan share the ranking path.
  let pool = eligible(context);
  if (intent === "prospecting_plan") {
    const lower = message.toLowerCase();
    const scoped = pool.filter((property) => lower.includes(property.neighborhood.split(",")[0].toLowerCase()));
    if (scoped.length > 0) pool = scoped;
  }

  if (pool.length === 0) {
    return {
      intent: intent === "prospecting_plan" ? "prospecting_plan" : "prioritize",
      reply: "No contactable properties are available. Import leads or clear a do-not-contact flag first.",
      recommendations: [],
      drafts: [],
      trace,
    };
  }

  const ranked = [...pool].sort((a, b) => b.score - a.score).slice(0, intent === "prospecting_plan" ? 5 : 3);
  const intelligence = await runPropertyIntelligenceAgent(ranked.map(toFacts), {
    apiKey: context.apiKey,
    client: context.client,
  });
  trace.push(intelligence.run);
  const explanationById = new Map(intelligence.results.map((result) => [result.propertyId, result]));

  const recommendations = ranked.map((property): OrchestratorRecommendation => {
    const analysis = explanationById.get(property.id);
    return {
      propertyId: property.id,
      address: property.address,
      ownerName: property.ownerName,
      reason: analysis?.explanation ?? property.summary,
      action: property.nextAction,
      priority: analysis?.recommendedPriority ?? (property.score >= 90 ? "high" : "medium"),
    };
  });

  const reply =
    intent === "prospecting_plan"
      ? `Here is a prospecting plan for ${ranked[0].neighborhood.split(",")[0]}: ${recommendations.length} properties ranked by opportunity. No outreach is sent without your approval.`
      : `Your top ${recommendations.length} properties to contact today, ranked by evidence. Nothing is contacted automatically.`;

  return {
    intent: intent === "prospecting_plan" ? "prospecting_plan" : "prioritize",
    reply,
    recommendations,
    drafts: [],
    trace,
  };
}
