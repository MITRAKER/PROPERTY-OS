import { callStructuredJson, createAnthropicClient } from "./anthropic.ts";
import type { AnthropicClientLike } from "./anthropic.ts";
import { DEFAULT_PERMISSION, runComplianceChecks } from "./compliance.ts";
import type { ContactPermission } from "./compliance.ts";
import type { ModelRunLog, OutreachChannel, OutreachResult, PropertyFacts } from "./types.ts";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    message: { type: "string" },
  },
  required: ["message"],
} as const;

const CHANNEL_LABEL: Record<OutreachChannel, string> = {
  call: "call script",
  text: "text message",
  email: "email",
  direct_mail: "letter",
};

export type OutreachInput = {
  property: PropertyFacts;
  channel: OutreachChannel;
  permission?: ContactPermission;
  rationale: string;
};

function templateMessage(input: OutreachInput): string {
  const { property, channel } = input;
  const opener = property.lastContact
    ? `Hi ${property.ownerName}, this is your agent following up on our last conversation about ${property.address}.`
    : `Hi ${property.ownerName}, I work with homeowners near ${property.address} and wanted to reach out.`;
  const body =
    channel === "direct_mail"
      ? "If you have ever considered your options for the property, I would be glad to share a no-obligation overview of what it could mean for you."
      : "When you have a moment, I would welcome a short conversation about your plans for the property whenever the timing is right for you.";
  return `${opener} ${body} — sent only after your approval.`;
}

// Outreach & Compliance Agent: runs deterministic compliance tools first, drafts
// personalized outreach only when allowed, and NEVER sends. Every result requires
// human approval before anyone acts on it.
export async function runOutreachAgent(
  input: OutreachInput,
  options: { apiKey?: string; model?: string; client?: AnthropicClientLike } = {},
): Promise<{ result: OutreachResult; run: ModelRunLog }> {
  const permission = input.permission ?? DEFAULT_PERMISSION;
  const compliance = runComplianceChecks({
    permission,
    channel: input.channel,
    notes: input.property.notes,
    rationale: input.rationale,
    lastContact: input.property.lastContact,
  });

  const blockedRun: ModelRunLog = {
    agent: "outreach_compliance",
    provider: "local_fallback",
    model: "compliance-gate",
    latencyMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0,
    fallbackCount: 0,
    summary: `Compliance gate ${compliance.allowed ? "cleared" : "blocked"} ${input.channel} outreach for ${input.property.address}.`,
  };

  if (!compliance.allowed) {
    return {
      result: {
        propertyId: input.property.id,
        channel: input.channel,
        allowed: false,
        message: "",
        approvalRequired: true,
        complianceWarnings: compliance.warnings,
        checks: compliance.checks,
      },
      run: blockedRun,
    };
  }

  let message = templateMessage(input);
  let run = blockedRun;

  if (options.apiKey || options.client) {
    try {
      const model = options.model ?? "claude-haiku-4-5";
      const client = options.client ?? createAnthropicClient(options.apiKey ?? "");
      const call = await callStructuredJson<{ message: string }>(client, {
        model,
        system: "You draft warm, compliant real-estate outreach. Never promise anything false. Never reference protected attributes. The message is a draft only and will not be sent without human approval.",
        prompt: draftPrompt(input),
        schema: SCHEMA,
        maxTokens: 700,
      });
      if (call.data.message?.trim()) message = call.data.message.trim();
      run = {
        agent: "outreach_compliance",
        provider: "claude",
        model,
        latencyMs: call.latencyMs,
        inputTokens: call.inputTokens,
        outputTokens: call.outputTokens,
        estimatedCostUsd: call.costUsd,
        fallbackCount: 0,
        summary: `Drafted a ${CHANNEL_LABEL[input.channel]} for ${input.property.address}; held for approval.`,
      };
    } catch {
      // Fall back to the deterministic template; still never sends.
    }
  }

  return {
    result: {
      propertyId: input.property.id,
      channel: input.channel,
      allowed: true,
      message,
      approvalRequired: true,
      complianceWarnings: compliance.warnings,
      checks: compliance.checks,
    },
    run,
  };
}

function draftPrompt(input: OutreachInput) {
  return `Draft a short ${CHANNEL_LABEL[input.channel]} to ${input.property.ownerName} about ${input.property.address}.
Context (do not invent beyond this): ${input.rationale}
Notes on file: ${input.property.notes}
Keep it under 90 words, warm, no pressure, and make clear there is no obligation.`;
}
