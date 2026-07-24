/**
 * Property Intelligence Agent
 *
 * Deterministic, explainable ranking for the Morning Briefing Top 3.
 * Claude (Follow-Up Extraction) only extracts structure — this module owns scoring.
 * Protected attributes (including owner age) must never affect the score.
 * Live NYC public-record signals (HPD/ACRIS/etc.) are deferred to Phase 3.
 */

import type { LeadRecord } from "./briefing.ts";
import type { Confidence, LeadExtraction } from "./extraction.ts";

export type ScoredProperty = {
  score: number;
  address: string;
  ownerName: string;
  headline: string;
  summary: string;
  reasons: string[];
  evidence: string[];
  recommendedAction: string;
  lastContact: string | null;
  followUpDate: string | null;
  confidence: Confidence;
};

export type RankedPriority = Omit<ScoredProperty, "score"> & { rank: number };

const DAY_MS = 86_400_000;

/** Phase-1 note-derived signals only. Public-record enrichment is Phase 3. */
export const signalDefinitions: Record<string, { points: number; reason: string }> = {
  inheritance_or_estate: { points: 28, reason: "Notes contain an inheritance or estate signal" },
  property_violation: { points: 20, reason: "Notes mention a property violation" },
  tax_lien: { points: 18, reason: "Notes mention a possible tax lien" },
  vacancy: { points: 14, reason: "Notes contain a vacancy signal" },
  absentee_owner: { points: 12, reason: "Notes contain an absentee-owner signal" },
  expired_listing: { points: 18, reason: "Notes mention an expired listing" },
  landlord_fatigue: { points: 14, reason: "Notes contain a landlord-fatigue signal" },
  permit_or_repair_issue: { points: 10, reason: "Notes mention a permit or repair issue" },
};

/** Explicit denylist — never used in scoring even if present on a lead or note. */
export const PROTECTED_ATTRIBUTE_KEYS = [
  "age",
  "owner_age",
  "date_of_birth",
  "dob",
  "race",
  "ethnicity",
  "national_origin",
  "religion",
  "familial_status",
  "disability",
  "sex",
  "gender",
] as const;

function parseDate(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function daysBetween(earlier: Date, later: Date) {
  return Math.floor((later.getTime() - earlier.getTime()) / DAY_MS);
}

function pluralizeDays(value: number) {
  return `${value} day${value === 1 ? "" : "s"}`;
}

/**
 * Score one property from CSV fields + Follow-Up Extraction output.
 * Returns an explainable score with reasons and evidence — not a black-box %.
 */
export function scoreProperty(
  lead: LeadRecord,
  extraction: LeadExtraction,
  now: Date = new Date(),
): ScoredProperty {
  let score = 0;
  const reasons: string[] = [];
  const evidence: string[] = extraction.evidenceQuotes.map((quote) => `Lead note: "${quote}"`);
  const followUp = parseDate(extraction.followUpDate);
  const lastContact = parseDate(lead.lastContact);

  if (followUp) {
    const daysLate = daysBetween(followUp, now);
    if (daysLate >= 0) {
      score += 50 + Math.min(daysLate, 20);
      reasons.push(daysLate === 0 ? "Follow-up is due today" : `Follow-up is ${pluralizeDays(daysLate)} overdue`);
    } else if (daysLate >= -7) {
      score += 30;
      reasons.push(`Follow-up is due in ${pluralizeDays(Math.abs(daysLate))}`);
    }
    evidence.push(`Extracted follow-up date: ${extraction.followUpDate}`);
  } else if (extraction.followUpRequested) {
    score += 8;
    reasons.push("Follow-up was requested, but the timing needs review");
  }

  extraction.propertySignals.forEach((signal) => {
    const definition = signalDefinitions[signal];
    if (!definition) return;
    score += definition.points;
    reasons.push(definition.reason);
  });

  if (extraction.followUpRequested) score += 18;
  if (extraction.motivation === "possible_sale") {
    score += 16;
    reasons.push("Notes contain a possible selling signal");
  } else if (extraction.motivation === "not_selling") {
    score -= 45;
    reasons.push("Notes say the owner is not currently selling");
  }

  if (lastContact) {
    const quietDays = Math.max(0, daysBetween(lastContact, now));
    if (quietDays >= 30) {
      score += 20;
      reasons.push(`No recorded contact for ${pluralizeDays(quietDays)}`);
    } else if (quietDays >= 14) {
      score += 12;
      reasons.push(`Last contact was ${pluralizeDays(quietDays)} ago`);
    }
    evidence.push(`Imported last contact: ${lead.lastContact}`);
  }

  if (extraction.confidence === "low") score -= 8;

  const recommendedAction =
    extraction.recommendedAction === "call"
      ? `Call ${lead.ownerName} today and reference the documented follow-up.`
      : extraction.recommendedAction === "wait"
        ? `Keep ${lead.ownerName} in the workspace without initiating outreach.`
        : `Review the evidence for ${lead.ownerName} before deciding whether to contact them.`;

  return {
    score,
    address: lead.address,
    ownerName: lead.ownerName,
    headline: reasons[0] ?? "Review this property lead",
    summary: extraction.summary,
    reasons: reasons.slice(0, 3),
    evidence: evidence.slice(0, 3),
    recommendedAction,
    lastContact: lead.lastContact || null,
    followUpDate: extraction.followUpDate,
    confidence: extraction.confidence,
  };
}

/**
 * Rank eligible properties and return the Top N briefing cards.
 * Do-not-contact records must be filtered out before calling this, or pass them
 * in and they will be excluded here as a second safeguard.
 */
export function selectTopPriorities(
  items: Array<{ lead: LeadRecord; extraction: LeadExtraction }>,
  now: Date = new Date(),
  limit = 3,
): RankedPriority[] {
  return items
    .filter(({ extraction }) => !extraction.doNotContact)
    .map(({ lead, extraction }) => scoreProperty(lead, extraction, now))
    .sort((a, b) => b.score - a.score || a.address.localeCompare(b.address))
    .slice(0, limit)
    .map((item, index): RankedPriority => ({
      rank: index + 1,
      address: item.address,
      ownerName: item.ownerName,
      headline: item.headline,
      summary: item.summary,
      reasons: item.reasons,
      evidence: item.evidence,
      recommendedAction: item.recommendedAction,
      lastContact: item.lastContact,
      followUpDate: item.followUpDate,
      confidence: item.confidence,
    }));
}
