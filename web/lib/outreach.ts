import Anthropic from "@anthropic-ai/sdk";
import type { AnthropicClientLike } from "./extraction.ts";

export type Channel = "email" | "phone" | "text" | "letter";

export type PropertyContext = {
  address: string;
  ownerName: string;
  facts?: string[];
};

export type RelationshipContext = {
  lastConversation?: string;
  relationshipStatus?: string;
  notes?: string[];
};

export type Permissions = {
  doNotContact: boolean;
  emailAllowed?: boolean;
  phoneAllowed?: boolean;
  textAllowed?: boolean;
  letterAllowed?: boolean;
  consentOnFile?: boolean;
};

export type OutreachRequest = {
  propertyId: string;
  channel: Channel;
  propertyContext: PropertyContext;
  relationshipContext: RelationshipContext;
  permissions: Permissions;
};

export type OutreachResult = {
  propertyId: string;
  channel: Channel;
  allowed: boolean;
  approvalRequired: boolean;
  subject: string | null;
  message: string | null;
  complianceWarnings: string[];
  evidenceUsed: string[];
};

type ComplianceCheck = {
  allowed: boolean;
  approvalRequired: boolean;
  warnings: string[];
};

// Letters carry a lower regulatory bar than TCPA-covered phone/text or CAN-SPAM email,
// so absent an explicit flag we default them to allowed; every other channel defaults to denied.
const CHANNEL_PERMISSION_KEY: Record<Channel, keyof Permissions> = {
  email: "emailAllowed",
  phone: "phoneAllowed",
  text: "textAllowed",
  letter: "letterAllowed",
};

const CHANNEL_DEFAULT_ALLOWED: Record<Channel, boolean> = {
  email: false,
  phone: false,
  text: false,
  letter: true,
};

// TCPA calling-hours rule: live calls/texts are only permitted 8am–9pm in the
// contacted party's local time. We don't reliably know each owner's time zone,
// so this gates on one configured business time zone (US Eastern, for NY).
const QUIET_HOURS = { startHour: 8, endHour: 21 };
const TIME_RESTRICTED_CHANNELS: Channel[] = ["phone", "text"];
const DEFAULT_TIME_ZONE = "America/New_York";

function hourInTimeZone(date: Date, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hour12: false }).formatToParts(date);
    const value = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
    return value === 24 ? 0 : value;
  } catch {
    return date.getHours();
  }
}

// Fair-housing guard: these traits must never ground an outreach draft, even if
// they slipped into imported notes or CRM history.
const PROTECTED_ATTRIBUTE_PATTERN =
  /\b(?:race|religio(?:n|us)|disab(?:led|ility)|national\s+origin|ethnic(?:ity)?|\d{2,3}\s*years?\s*old|elderly|pregnan(?:t|cy)|familial\s+status|\bgender\b|\bsex\b)\b/i;

function evidenceText(propertyContext: PropertyContext, relationshipContext: RelationshipContext): string {
  return [
    relationshipContext.lastConversation,
    ...(relationshipContext.notes ?? []),
    ...(propertyContext.facts ?? []),
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ");
}

export function checkCompliance(request: OutreachRequest, now: Date = new Date()): ComplianceCheck {
  const { channel, permissions, propertyContext, relationshipContext } = request;

  if (permissions.doNotContact) {
    return { allowed: false, approvalRequired: false, warnings: ["The record is marked do not contact."] };
  }

  const channelPermission = permissions[CHANNEL_PERMISSION_KEY[channel]];
  const channelAllowed = channelPermission ?? CHANNEL_DEFAULT_ALLOWED[channel];
  if (!channelAllowed) {
    return {
      allowed: false,
      approvalRequired: false,
      warnings: [`No documented permission for ${channel} outreach.`],
    };
  }

  if (permissions.consentOnFile === false) {
    return {
      allowed: false,
      approvalRequired: false,
      warnings: [`No documented consent on file for ${channel} outreach.`],
    };
  }

  if (TIME_RESTRICTED_CHANNELS.includes(channel)) {
    const hour = hourInTimeZone(now, DEFAULT_TIME_ZONE);
    const withinQuietHours = hour >= QUIET_HOURS.startHour && hour < QUIET_HOURS.endHour;
    if (!withinQuietHours) {
      return {
        allowed: false,
        approvalRequired: false,
        warnings: [`Outside permitted contact hours (8am–9pm ${DEFAULT_TIME_ZONE}); ${channel} outreach is blocked right now.`],
      };
    }
  }

  if (PROTECTED_ATTRIBUTE_PATTERN.test(evidenceText(propertyContext, relationshipContext))) {
    return {
      allowed: false,
      approvalRequired: false,
      warnings: ["The supplied evidence references a protected attribute and cannot be used for outreach."],
    };
  }

  const warnings: string[] = [];
  const hasRelationshipHistory = Boolean(
    relationshipContext.lastConversation
      || relationshipContext.relationshipStatus
      || (relationshipContext.notes && relationshipContext.notes.length > 0),
  );
  if (!hasRelationshipHistory) {
    warnings.push("No prior relationship history on file; treat as first-touch outreach.");
  }

  // A draft never sends itself, so every allowed request still needs a human to approve it.
  return { allowed: true, approvalRequired: true, warnings };
}

function draftEmail(propertyContext: PropertyContext, relationshipContext: RelationshipContext) {
  const { address, ownerName, facts } = propertyContext;
  const evidenceUsed: string[] = [];
  const sentences = [`Hi ${ownerName},`];

  if (relationshipContext.lastConversation) {
    sentences.push(`When we last spoke, you mentioned: "${relationshipContext.lastConversation}"`);
    evidenceUsed.push(`Relationship note on file: "${relationshipContext.lastConversation}"`);
  }

  sentences.push(`I wanted to follow up about ${address}.`);

  (facts ?? []).forEach((fact) => {
    sentences.push(fact);
    evidenceUsed.push(`Property fact on file: "${fact}"`);
  });

  return {
    subject: `Following up about ${address}`,
    message: sentences.join(" "),
    evidenceUsed,
  };
}

function draftPhoneScript(propertyContext: PropertyContext, relationshipContext: RelationshipContext) {
  const { address, ownerName, facts } = propertyContext;
  const evidenceUsed: string[] = [];
  const lines = [`Call script for ${ownerName} about ${address}:`, `- Open: "Hi ${ownerName}, this is a follow-up about ${address}."`];

  if (relationshipContext.lastConversation) {
    lines.push(`- Reference: "${relationshipContext.lastConversation}"`);
    evidenceUsed.push(`Relationship note on file: "${relationshipContext.lastConversation}"`);
  }

  (facts ?? []).forEach((fact) => {
    lines.push(`- Mention: "${fact}"`);
    evidenceUsed.push(`Property fact on file: "${fact}"`);
  });

  lines.push('- Close: "Would it be alright if I followed up with next steps?"');

  return { subject: null, message: lines.join("\n"), evidenceUsed };
}

function draftText(propertyContext: PropertyContext, relationshipContext: RelationshipContext) {
  const { address, ownerName, facts } = propertyContext;
  const evidenceUsed: string[] = [];
  const parts = [`Hi ${ownerName}, following up about ${address}.`];

  if (relationshipContext.lastConversation) {
    parts.push(`You mentioned: "${relationshipContext.lastConversation}"`);
    evidenceUsed.push(`Relationship note on file: "${relationshipContext.lastConversation}"`);
  }

  (facts ?? []).forEach((fact) => {
    parts.push(fact);
    evidenceUsed.push(`Property fact on file: "${fact}"`);
  });

  parts.push("Let me know if you'd like to chat.");

  return { subject: null, message: parts.join(" "), evidenceUsed };
}

function draftLetter(propertyContext: PropertyContext, relationshipContext: RelationshipContext) {
  const { address, ownerName, facts } = propertyContext;
  const evidenceUsed: string[] = [];
  const paragraphs = [`Dear ${ownerName},`];

  if (relationshipContext.lastConversation) {
    paragraphs.push(`When we last spoke, you mentioned: "${relationshipContext.lastConversation}"`);
    evidenceUsed.push(`Relationship note on file: "${relationshipContext.lastConversation}"`);
  }

  paragraphs.push(`I wanted to reach out regarding ${address}.`);

  (facts ?? []).forEach((fact) => {
    paragraphs.push(fact);
    evidenceUsed.push(`Property fact on file: "${fact}"`);
  });

  paragraphs.push("Please let me know if you have any questions.");

  return { subject: null, message: paragraphs.join("\n\n"), evidenceUsed };
}

export function draftMessage(
  channel: Channel,
  propertyContext: PropertyContext,
  relationshipContext: RelationshipContext,
): { subject: string | null; message: string; evidenceUsed: string[] } {
  switch (channel) {
    case "email":
      return draftEmail(propertyContext, relationshipContext);
    case "phone":
      return draftPhoneScript(propertyContext, relationshipContext);
    case "text":
      return draftText(propertyContext, relationshipContext);
    case "letter":
      return draftLetter(propertyContext, relationshipContext);
  }
}

function blockedResult(request: OutreachRequest, warnings: string[]): OutreachResult {
  return {
    propertyId: request.propertyId,
    channel: request.channel,
    allowed: false,
    approvalRequired: false,
    subject: null,
    message: null,
    complianceWarnings: warnings,
    evidenceUsed: [],
  };
}

export function prepareOutreach(request: OutreachRequest, now: Date = new Date()): OutreachResult {
  const compliance = checkCompliance(request, now);
  if (!compliance.allowed) return blockedResult(request, compliance.warnings);

  const draft = draftMessage(request.channel, request.propertyContext, request.relationshipContext);

  return {
    propertyId: request.propertyId,
    channel: request.channel,
    allowed: true,
    approvalRequired: compliance.approvalRequired,
    subject: draft.subject,
    message: draft.message,
    complianceWarnings: compliance.warnings,
    evidenceUsed: draft.evidenceUsed,
  };
}

type Fact = { id: string; text: string };

// Claude cites facts by id rather than free-typing evidence text, so evidenceUsed can only ever
// be built from strings we supplied — the model can personalize prose but can't invent evidence.
function collectFacts(propertyContext: PropertyContext, relationshipContext: RelationshipContext): Fact[] {
  const facts: Fact[] = [];

  if (relationshipContext.lastConversation) {
    facts.push({ id: "relationship-last-conversation", text: relationshipContext.lastConversation });
  }
  (relationshipContext.notes ?? []).forEach((note, index) => {
    facts.push({ id: `relationship-note-${index}`, text: note });
  });
  (propertyContext.facts ?? []).forEach((fact, index) => {
    facts.push({ id: `property-fact-${index}`, text: fact });
  });

  return facts;
}

const DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    subject: { type: ["string", "null"] },
    message: { type: "string" },
    usedFactIds: { type: "array", items: { type: "string" } },
  },
  required: ["subject", "message", "usedFactIds"],
} as const;

function draftPrompt(channel: Channel, propertyContext: PropertyContext, facts: Fact[]) {
  return `Draft a ${channel} outreach ${channel === "phone" ? "call script" : "message"} to ${propertyContext.ownerName} about ${propertyContext.address}.

Rules:
- Use only the facts listed below. Do not invent names, dates, numbers, or claims not present in this list.
- If the list is empty, keep the message generic and do not fabricate history.
- Never use age, race, religion, disability, familial status, sex, national origin, or another protected trait.
- Keep the tone professional and warm. For "phone", write it as a short script with an opening line and a closing question.
- Set usedFactIds to only the ids of facts you actually referenced.
- Set subject for channel "email" only; for every other channel, subject must be null.

Available facts:
${JSON.stringify(facts)}`;
}

async function callDraftClaude(client: AnthropicClientLike, model: string, channel: Channel, propertyContext: PropertyContext, facts: Fact[]) {
  const response = await client.messages.create({
    model,
    max_tokens: 1_000,
    temperature: 0,
    system: "You draft auditable real-estate outreach messages. Return only the requested structured output.",
    messages: [{ role: "user", content: draftPrompt(channel, propertyContext, facts) }],
    output_config: {
      format: {
        type: "json_schema",
        schema: DRAFT_SCHEMA,
      },
    },
  });
  const text = response.content.find((block) => block.type === "text")?.text;
  if (!text) throw new Error("Claude returned no structured draft content.");
  return JSON.parse(text) as { subject?: unknown; message?: unknown; usedFactIds?: unknown };
}

function validateDraft(
  candidate: { subject?: unknown; message?: unknown; usedFactIds?: unknown },
  facts: Fact[],
  channel: Channel,
  local: { subject: string | null; message: string; evidenceUsed: string[] },
): { subject: string | null; message: string; evidenceUsed: string[] } {
  const message = typeof candidate.message === "string" && candidate.message.trim() ? candidate.message.trim() : null;
  if (!message) return local;

  const subject = channel === "email"
    ? (typeof candidate.subject === "string" && candidate.subject.trim() ? candidate.subject.trim() : local.subject)
    : null;

  const factById = new Map(facts.map((fact) => [fact.id, fact.text]));
  const usedFactIds = Array.isArray(candidate.usedFactIds)
    ? candidate.usedFactIds.filter((id): id is string => typeof id === "string" && factById.has(id))
    : [];
  const evidenceUsed = usedFactIds.map((id) => `Fact on file: "${factById.get(id)}"`);

  return { subject, message, evidenceUsed };
}

export async function prepareOutreachWithAnthropic(
  request: OutreachRequest,
  options: { apiKey: string; model?: string; client?: AnthropicClientLike; now?: Date },
): Promise<OutreachResult> {
  const now = options.now ?? new Date();
  const compliance = checkCompliance(request, now);
  if (!compliance.allowed) return blockedResult(request, compliance.warnings);

  const model = options.model ?? "claude-haiku-4-5";
  const client = options.client ?? (new Anthropic({ apiKey: options.apiKey }) as unknown as AnthropicClientLike);
  const local = draftMessage(request.channel, request.propertyContext, request.relationshipContext);
  const facts = collectFacts(request.propertyContext, request.relationshipContext);
  const candidate = await callDraftClaude(client, model, request.channel, request.propertyContext, facts);
  const draft = validateDraft(candidate, facts, request.channel, local);

  return {
    propertyId: request.propertyId,
    channel: request.channel,
    allowed: true,
    approvalRequired: compliance.approvalRequired,
    subject: draft.subject,
    message: draft.message,
    complianceWarnings: compliance.warnings,
    evidenceUsed: draft.evidenceUsed,
  };
}
