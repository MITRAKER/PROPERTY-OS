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

export function checkCompliance(request: OutreachRequest): ComplianceCheck {
  const { channel, permissions, relationshipContext } = request;

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

export function prepareOutreach(request: OutreachRequest): OutreachResult {
  const compliance = checkCompliance(request);

  if (!compliance.allowed) {
    return {
      propertyId: request.propertyId,
      channel: request.channel,
      allowed: false,
      approvalRequired: false,
      subject: null,
      message: null,
      complianceWarnings: compliance.warnings,
      evidenceUsed: [],
    };
  }

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
