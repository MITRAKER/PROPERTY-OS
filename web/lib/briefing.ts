import { extractLocally } from "./extraction.ts";
import type { Confidence, ExtractionMetrics, LeadExtraction } from "./extraction.ts";
import type { PropertyRecord, PropertyStatus } from "./property-model.ts";

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

// An imported lead becomes a real property workspace. `doNotContact` rides along
// so the deterministic permission layer can be persisted with the property.
export type ImportedPropertyRecord = PropertyRecord & { doNotContact: boolean };

const SIGNAL_LABELS: Record<string, string> = {
  inheritance_or_estate: "Inherited / estate",
  property_violation: "Violation",
  tax_lien: "Tax lien",
  vacancy: "Vacant",
  absentee_owner: "Absentee owner",
  expired_listing: "Expired listing",
  landlord_fatigue: "Landlord fatigue",
  permit_or_repair_issue: "Permit / repair",
};

const MAP_CLASSES = ["parcel-a", "parcel-b", "parcel-c", "parcel-d", "parcel-e", "parcel-f", "parcel-g", "parcel-h"];

function slugifyAddress(address: string) {
  return address.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function importScore(extraction: LeadExtraction): number {
  if (extraction.doNotContact) return 28;
  if (extraction.recommendedAction === "call") return extraction.confidence === "high" ? 92 : 84;
  if (extraction.motivation === "possible_sale") return 78;
  if (extraction.recommendedAction === "wait") return 52;
  return 62;
}

function importStatus(extraction: LeadExtraction): { status: PropertyStatus; statusLabel: string } {
  if (extraction.doNotContact) return { status: "review", statusLabel: "Do not contact" };
  if (extraction.propertySignals.includes("inheritance_or_estate")) return { status: "inherited", statusLabel: "Inherited" };
  if (extraction.propertySignals.includes("property_violation")) return { status: "violation", statusLabel: "Violation" };
  if (extraction.recommendedAction === "call") return { status: "urgent", statusLabel: "Call today" };
  if (extraction.motivation === "possible_sale") return { status: "warm", statusLabel: "Warm lead" };
  return { status: "review", statusLabel: "Needs review" };
}

function importNextAction(lead: LeadRecord, extraction: LeadExtraction): string {
  if (extraction.doNotContact) return `Do not contact ${lead.ownerName}. Keep the record for compliance only.`;
  if (extraction.recommendedAction === "call") return `Call ${lead.ownerName} and reference the documented follow-up.`;
  if (extraction.recommendedAction === "wait") return `Hold ${lead.ownerName} in the workspace; no outreach yet.`;
  return `Review the evidence for ${lead.ownerName} before contacting them.`;
}

export function buildImportedProperties(
  leads: LeadRecord[],
  extractions: LeadExtraction[],
  now = new Date(),
): ImportedPropertyRecord[] {
  const byRow = new Map(extractions.map((extraction) => [extraction.rowNumber, extraction]));
  return leads.map((lead, index) => {
    const extraction = byRow.get(lead.rowNumber);
    const signals = (extraction?.propertySignals ?? []).map((signal) => SIGNAL_LABELS[signal] ?? signal);
    if (extraction?.motivation === "possible_sale") signals.push("Possible sale");
    const status = extraction ? importStatus(extraction) : { status: "review" as PropertyStatus, statusLabel: "Needs review" };
    return {
      id: `import-${slugifyAddress(lead.address)}`,
      address: lead.address,
      neighborhood: "Imported lead",
      ownerName: lead.ownerName,
      status: status.status,
      statusLabel: status.statusLabel,
      score: extraction ? importScore(extraction) : 50,
      equity: "Unknown",
      ownershipYears: 0,
      lastContact: lead.lastContact || "",
      followUpDate: extraction?.followUpDate ?? null,
      nextAction: extraction ? importNextAction(lead, extraction) : `Review ${lead.ownerName}.`,
      summary: extraction?.summary ?? lead.notes.slice(0, 180),
      signals: signals.length ? Array.from(new Set(signals)) : ["Imported lead"],
      mapClass: MAP_CLASSES[index % MAP_CLASSES.length],
      timeline: [
        {
          date: now.toISOString().slice(0, 10),
          title: "Imported from CSV",
          detail: `Follow-Up Agent analyzed the note. Recommended action: ${extraction?.recommendedAction ?? "review"}.`,
          type: "note" as const,
        },
      ],
      doNotContact: extraction?.doNotContact ?? false,
    };
  });
}
