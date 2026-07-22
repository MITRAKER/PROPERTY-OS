import type { ComplianceCheck, OutreachChannel } from "./types.ts";

// Deterministic permission state. The model never decides these values; they are
// read from the contact_permissions table (or a safe default).
export type ContactPermission = {
  doNotContact: boolean;
  phoneAllowed: boolean;
  emailAllowed: boolean;
  mailAllowed: boolean;
  textAllowed: boolean;
};

// Text starts OFF. Cold SMS to a skip-traced cell with no prior consent is the
// highest-risk outreach under the TCPA, so the safe default is to block it until
// a person deliberately enables the text channel for a property.
export const DEFAULT_PERMISSION: ContactPermission = {
  doNotContact: false,
  phoneAllowed: true,
  emailAllowed: true,
  mailAllowed: true,
  textAllowed: false,
};

// TCPA / state quiet hours: live calling and texting are only permitted 8am–9pm
// in the contacted party's local time. We don't reliably know each owner's zone,
// so we gate on one configured business timezone (default US Eastern for NY).
export const QUIET_HOURS = { startHour: 8, endHour: 21 };

export function hourInTimeZone(date: Date, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hour12: false }).formatToParts(date);
    const value = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
    return value === 24 ? 0 : value;
  } catch {
    return date.getHours();
  }
}

const DNC_PATTERN =
  /\b(?:dnc|do\s+not\s+(?:call|contact)|don't\s+(?:call|contact)|never\s+call|remove\s+me|stop\s+contacting)\b/i;

// Fair-housing guard: these traits must never be used as an outreach rationale.
const PROTECTED_ATTRIBUTE_PATTERN =
  /\b(?:race|religio(?:n|us)|disab(?:led|ility)|national\s+origin|ethnic(?:ity)?|\d{2,3}\s*years?\s*old|elderly|pregnan(?:t|cy)|familial\s+status|\bgender\b|\bsex\b)\b/i;

const CHANNEL_FIELD: Record<OutreachChannel, keyof ContactPermission> = {
  call: "phoneAllowed",
  text: "textAllowed",
  email: "emailAllowed",
  direct_mail: "mailAllowed",
};

export function checkDoNotCall(permission: ContactPermission, notes: string): ComplianceCheck {
  const flagged = permission.doNotContact || DNC_PATTERN.test(notes);
  return {
    name: "do_not_contact",
    passed: !flagged,
    detail: flagged
      ? "This property is marked do-not-contact. Outreach is blocked."
      : "No do-not-contact restriction found.",
  };
}

export function checkChannelPermission(permission: ContactPermission, channel: OutreachChannel): ComplianceCheck {
  const allowed = permission[CHANNEL_FIELD[channel]];
  return {
    name: "channel_permission",
    passed: allowed,
    detail: allowed
      ? `The ${channel.replace("_", " ")} channel is permitted for this property.`
      : `The ${channel.replace("_", " ")} channel is not permitted for this property.`,
  };
}

// Internal do-not-contact ("suppression") scrub. A number or email a person has
// opted out of is blocked across the whole workspace, on every property and
// channel — this is the workspace-wide DNC. (The National DNC Registry is a
// separate, external scrub the caller layers on before dialing.)
export function checkSuppression(suppressed: boolean): ComplianceCheck {
  return {
    name: "suppression_list",
    passed: !suppressed,
    detail: suppressed
      ? "This number or email is on your do-not-contact list. Outreach is blocked everywhere."
      : "Recipient is not on the do-not-contact list.",
  };
}

export function checkQuietHours(
  channel: OutreachChannel,
  now: Date = new Date(),
  timeZone: string = "America/New_York",
): ComplianceCheck {
  // Only live calling and texting are time-restricted; email and mail are not.
  if (channel !== "call" && channel !== "text") {
    return { name: "calling_hours", passed: true, detail: "Calling-hours rule does not apply to this channel." };
  }
  const hour = hourInTimeZone(now, timeZone);
  const withinHours = hour >= QUIET_HOURS.startHour && hour < QUIET_HOURS.endHour;
  return {
    name: "calling_hours",
    passed: withinHours,
    detail: withinHours
      ? `Within permitted contact hours (8am–9pm ${timeZone}).`
      : `Outside permitted contact hours (8am–9pm ${timeZone}); ${channel === "text" ? "texting" : "calling"} is blocked right now.`,
  };
}

export function checkProtectedAttributeUsage(rationale: string): ComplianceCheck {
  const flagged = PROTECTED_ATTRIBUTE_PATTERN.test(rationale);
  return {
    name: "protected_attribute_usage",
    passed: !flagged,
    detail: flagged
      ? "The rationale references a protected attribute and cannot be used as a selling signal."
      : "No protected attributes were used as a signal.",
  };
}

export function checkExistingRelationship(lastContact: string | undefined): ComplianceCheck {
  const known = Boolean(lastContact && lastContact.trim().length > 0);
  return {
    name: "existing_relationship",
    passed: true,
    detail: known
      ? "A prior conversation is on record with this owner."
      : "No prior conversation is recorded; treat as a cold contact.",
  };
}

export type ComplianceResult = {
  checks: ComplianceCheck[];
  allowed: boolean;
  warnings: string[];
};

export function runComplianceChecks(input: {
  permission: ContactPermission;
  channel: OutreachChannel;
  notes: string;
  rationale: string;
  lastContact?: string;
}): ComplianceResult {
  const checks = [
    checkDoNotCall(input.permission, input.notes),
    checkChannelPermission(input.permission, input.channel),
    checkProtectedAttributeUsage(input.rationale),
    checkExistingRelationship(input.lastContact),
  ];
  // A blocking failure on do-not-contact or channel permission disallows outreach.
  const blocking = checks.filter(
    (check) => !check.passed && (check.name === "do_not_contact" || check.name === "channel_permission" || check.name === "protected_attribute_usage"),
  );
  return {
    checks,
    allowed: blocking.length === 0,
    warnings: checks.filter((check) => !check.passed).map((check) => check.detail),
  };
}
