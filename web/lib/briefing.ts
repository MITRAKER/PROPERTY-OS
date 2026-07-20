import { extractLocally } from "./extraction.ts";
import type { Confidence, ExtractionMetrics, LeadExtraction } from "./extraction.ts";

export type LeadRecord = {
  address: string;
  ownerName: string;
  lastContact: string;
  followUpDate: string;
  notes: string;
  rowNumber: number;
};

export type RejectedRow = {
  rowNumber: number;
  reason: string;
};

export type BriefingPriority = {
  rank: number;
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

export type BriefingResult = {
  importedCount: number;
  rejectedRows: RejectedRow[];
  generatedAt: string;
  priorities: BriefingPriority[];
  metrics: ExtractionMetrics;
  manualReviewCount: number;
  doNotContactCount: number;
};

type RankedLead = Omit<BriefingPriority, "rank"> & { score: number };

const DAY_MS = 86_400_000;

const headerAliases: Record<keyof Omit<LeadRecord, "rowNumber">, string[]> = {
  address: ["address", "property_address", "property", "street_address"],
  ownerName: ["owner_name", "owner", "contact_name", "name"],
  lastContact: ["last_contact", "last_contact_date", "contacted_at"],
  followUpDate: ["follow_up_date", "followup_date", "next_contact", "callback_date"],
  notes: ["notes", "note", "lead_notes", "conversation_notes"],
};

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function parseCsvRows(csvText: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < csvText.length; index += 1) {
    const character = csvText[index];
    const nextCharacter = csvText[index + 1];

    if (character === '"' && quoted && nextCharacter === '"') {
      field += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(field.trim());
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && nextCharacter === "\n") index += 1;
      row.push(field.trim());
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  row.push(field.trim());
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

function findColumn(headers: string[], aliases: string[]) {
  return headers.findIndex((header) => aliases.includes(header));
}

export function parseLeadCsv(csvText: string): {
  leads: LeadRecord[];
  rejectedRows: RejectedRow[];
} {
  const rows = parseCsvRows(csvText.replace(/^\uFEFF/, ""));
  if (rows.length < 2) {
    throw new Error("The CSV needs a header row and at least one property record.");
  }

  const headers = rows[0].map(normalizeHeader);
  const columns = Object.fromEntries(
    Object.entries(headerAliases).map(([field, aliases]) => [field, findColumn(headers, aliases)]),
  ) as Record<keyof Omit<LeadRecord, "rowNumber">, number>;

  if (columns.address < 0 || columns.notes < 0) {
    throw new Error("The CSV must include address and notes columns.");
  }

  const leads: LeadRecord[] = [];
  const rejectedRows: RejectedRow[] = [];

  rows.slice(1).forEach((values, index) => {
    const rowNumber = index + 2;
    const valueAt = (column: number) => (column >= 0 ? values[column]?.trim() ?? "" : "");
    const address = valueAt(columns.address);
    const notes = valueAt(columns.notes);

    if (!address || !notes) {
      rejectedRows.push({
        rowNumber,
        reason: !address ? "Missing property address" : "Missing lead notes",
      });
      return;
    }

    leads.push({
      address,
      notes,
      ownerName: valueAt(columns.ownerName) || "Owner not provided",
      lastContact: valueAt(columns.lastContact),
      followUpDate: valueAt(columns.followUpDate),
      rowNumber,
    });
  });

  if (leads.length === 0) throw new Error("No valid property records were found in the CSV.");
  return { leads, rejectedRows };
}

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

const signalDefinitions: Record<string, { points: number; reason: string }> = {
  inheritance_or_estate: { points: 28, reason: "Notes contain an inheritance or estate signal" },
  property_violation: { points: 20, reason: "Notes mention a property violation" },
  tax_lien: { points: 18, reason: "Notes mention a possible tax lien" },
  vacancy: { points: 14, reason: "Notes contain a vacancy signal" },
  absentee_owner: { points: 12, reason: "Notes contain an absentee-owner signal" },
  expired_listing: { points: 18, reason: "Notes mention an expired listing" },
  landlord_fatigue: { points: 14, reason: "Notes contain a landlord-fatigue signal" },
  permit_or_repair_issue: { points: 10, reason: "Notes mention a permit or repair issue" },
};

function rankLead(lead: LeadRecord, extraction: LeadExtraction, now: Date): RankedLead {
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

  const recommendedAction = extraction.recommendedAction === "call"
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

export function generateBriefingFromLeads(
  leads: LeadRecord[],
  extractions: LeadExtraction[],
  rejectedRows: RejectedRow[],
  metrics: ExtractionMetrics,
  now = new Date(),
): BriefingResult {
  const extractionByRow = new Map(extractions.map((extraction) => [extraction.rowNumber, extraction]));
  const allowed = leads
    .map((lead) => ({ lead, extraction: extractionByRow.get(lead.rowNumber) }))
    .filter((item): item is { lead: LeadRecord; extraction: LeadExtraction } => Boolean(item.extraction));

  const priorities = allowed
    .filter(({ extraction }) => !extraction.doNotContact)
    .map(({ lead, extraction }) => rankLead(lead, extraction, now))
    .sort((a, b) => b.score - a.score || a.address.localeCompare(b.address))
    .slice(0, 3)
    .map((item, index): BriefingPriority => ({
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

  return {
    importedCount: leads.length,
    rejectedRows,
    generatedAt: now.toISOString(),
    priorities,
    metrics,
    manualReviewCount: allowed.filter(({ extraction }) => extraction.confidence === "low" || extraction.recommendedAction === "review").length,
    doNotContactCount: allowed.filter(({ extraction }) => extraction.doNotContact).length,
  };
}

export function generateBriefing(csvText: string, now = new Date()): BriefingResult {
  const { leads, rejectedRows } = parseLeadCsv(csvText);
  const extraction = extractLocally(leads, now);
  return generateBriefingFromLeads(leads, extraction.extractions, rejectedRows, extraction.metrics, now);
}
