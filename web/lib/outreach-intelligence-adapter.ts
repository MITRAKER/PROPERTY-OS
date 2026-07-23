import type { Channel, OutreachRequest, Permissions, PropertyContext, RelationshipContext } from "./outreach.ts";

export type PropertyIntelligenceSignal = {
  type?: string;
  evidence: string;
  source?: string;
};

export type PropertyIntelligenceResult = {
  address: string;
  ownerName: string;
  signals: PropertyIntelligenceSignal[];
};

export type FollowUpResult = {
  summary?: string;
  sentiment?: string;
  evidenceQuotes?: string[];
  doNotContact?: boolean;
};

export function propertyContextFromIntelligence(result: PropertyIntelligenceResult): PropertyContext {
  return {
    address: result.address,
    ownerName: result.ownerName,
    facts: result.signals.map((signal) => signal.evidence),
  };
}

export function relationshipContextFromFollowUp(result: FollowUpResult): RelationshipContext {
  return {
    lastConversation: result.evidenceQuotes?.[0] ?? result.summary,
    notes: result.evidenceQuotes,
    relationshipStatus: result.sentiment,
  };
}

// Follow-Up's own do-not-contact read must never be dropped by merging with a stale CRM flag,
// so this only ever turns permissions.doNotContact on, never off.
export function permissionsFromFollowUp(followUp: FollowUpResult, basePermissions: Permissions): Permissions {
  return {
    ...basePermissions,
    doNotContact: basePermissions.doNotContact || Boolean(followUp.doNotContact),
  };
}

export function buildOutreachRequest(params: {
  propertyId: string;
  channel: Channel;
  propertyIntelligence: PropertyIntelligenceResult;
  followUp: FollowUpResult;
  permissions: Permissions;
}): OutreachRequest {
  return {
    propertyId: params.propertyId,
    channel: params.channel,
    propertyContext: propertyContextFromIntelligence(params.propertyIntelligence),
    relationshipContext: relationshipContextFromFollowUp(params.followUp),
    permissions: permissionsFromFollowUp(params.followUp, params.permissions),
  };
}
