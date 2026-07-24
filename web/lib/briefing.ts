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

type LeadField = keyof Omit<LeadRecord, "rowNumber">;

// Header hints only. Matching is fuzzy, and any field the headers do not reveal is
// inferred from the data itself — so an unfamiliar export still imports and no
// particular column naming is ever required.
const headerAliases: Record<LeadField, string[]> = {
  address: ["address", "property address", "street address", "site address", "full address", "property", "street", "location", "addr"],
  ownerName: ["owner name", "owner", "seller", "landlord", "contact name", "contact", "full name", "name"],
  lastContact: ["last contact", "last contacted", "last contact date", "contacted at", "last touch", "last call", "last activity"],
  followUpDate: ["follow up date", "follow up", "followup", "next contact", "next action", "callback date", "callback", "due date", "reminder"],
  notes: ["notes", "note", "lead notes", "conversation notes", "comments", "comment", "remarks", "description", "details", "memo", "summary", "activity", "history"],
};

const LEAD_FIELDS: LeadField[] = ["address", "ownerName", "lastContact", "followUpDate", "notes"];

function normalizeHeader(value: string) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// 3 = exact label, 2 = one contains the other, 1 = shares a significant word.
function headerScore(header: string, aliases: string[]): number {
  if (!header) return 0;
  let best = 0;
  for (const alias of aliases) {
    if (header === alias) return 3;
    if (header.includes(alias) || alias.includes(header)) {
      best = Math.max(best, 2);
      continue;
    }
    const headerWords = new Set(header.split(" "));
    if (alias.split(" ").some((word) => word.length > 3 && headerWords.has(word))) best = Math.max(best, 1);
  }
  return best;
}

const STREET_WORD =
  /\b(st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|ct|court|pl|place|ter|terrace|way|hwy|pkwy|cir|circle|sq|square|apt|unit|ste|suite)\b/i;

function looksLikeAddress(value: string) {
  const text = (value ?? "").trim();
  if (!text) return false;
  return /^\d+[\w-]*\s+\S/.test(text) || STREET_WORD.test(text);
}

function looksLikeDate(value: string) {
  const text = (value ?? "").trim();
  if (!text || !/\d/.test(text)) return false;
  if (/^\d{4}-\d{1,2}-\d{1,2}/.test(text)) return true;
  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(text)) return true;
  return !Number.isNaN(Date.parse(text)) && /[/-]|\b\d{4}\b/.test(text);
}

function looksLikeName(value: string) {
  const text = (value ?? "").trim();
  if (!text || /\d/.test(text) || STREET_WORD.test(text)) return false;
  const words = text.split(/[\s,]+/).filter(Boolean);
  return words.length >= 2 && words.length <= 4 && words.every((word) => /^[A-Za-z][A-Za-z'.-]*$/.test(word));
}

function wordCount(value: string) {
  return (value ?? "").trim().split(/\s+/).filter(Boolean).length;
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

type ColumnProfile = {
  index: number;
  address: number;
  date: number;
  name: number;
  avgWords: number;
  futureDates: number;
  pastDates: number;
};

// What each column actually contains, judged from the data rather than its label.
function profileColumns(dataRows: string[][], columnCount: number): ColumnProfile[] {
  const sample = dataRows.slice(0, 50);
  const now = Date.now();
  const profiles: ColumnProfile[] = [];

  for (let index = 0; index < columnCount; index += 1) {
    const values = sample.map((row) => (row[index] ?? "").trim()).filter((value) => value.length > 0);
    const denominator = Math.max(values.length, 1);
    let futureDates = 0;
    let pastDates = 0;

    for (const value of values) {
      if (!looksLikeDate(value)) continue;
      const parsed = Date.parse(value);
      if (Number.isNaN(parsed)) continue;
      if (parsed >= now) futureDates += 1;
      else pastDates += 1;
    }

    profiles.push({
      index,
      address: values.filter(looksLikeAddress).length / denominator,
      date: values.filter(looksLikeDate).length / denominator,
      name: values.filter(looksLikeName).length / denominator,
      avgWords: values.reduce((sum, value) => sum + wordCount(value), 0) / denominator,
      futureDates,
      pastDates,
    });
  }

  return profiles;
}

// Headers get first say; anything they leave unresolved is inferred from content.
function resolveColumns(headerCells: string[], profiles: ColumnProfile[]): Record<LeadField, number> {
  const columns: Record<LeadField, number> = {
    address: -1,
    ownerName: -1,
    lastContact: -1,
    followUpDate: -1,
    notes: -1,
  };
  const claimed = new Set<number>();

  const candidates: Array<{ field: LeadField; index: number; score: number }> = [];
  headerCells.forEach((header, index) => {
    for (const field of LEAD_FIELDS) {
      const score = headerScore(header, headerAliases[field]);
      if (score > 0) candidates.push({ field, index, score });
    }
  });
  candidates.sort((a, b) => b.score - a.score);
  for (const candidate of candidates) {
    if (columns[candidate.field] >= 0 || claimed.has(candidate.index)) continue;
    columns[candidate.field] = candidate.index;
    claimed.add(candidate.index);
  }

  const unclaimed = () => profiles.filter((profile) => !claimed.has(profile.index));
  const take = (field: LeadField, profile?: ColumnProfile) => {
    if (!profile) return;
    columns[field] = profile.index;
    claimed.add(profile.index);
  };
  const strongest = (key: (profile: ColumnProfile) => number, minimum: number) => {
    const ranked = [...unclaimed()].sort((a, b) => key(b) - key(a));
    return ranked.length > 0 && key(ranked[0]) >= minimum ? ranked[0] : undefined;
  };

  if (columns.address < 0) take("address", strongest((profile) => profile.address, 0.5));
  if (columns.notes < 0) take("notes", strongest((profile) => profile.avgWords, 3));
  if (columns.ownerName < 0) take("ownerName", strongest((profile) => profile.name, 0.5));

  const dateColumns = unclaimed()
    .filter((profile) => profile.date >= 0.6)
    .sort((a, b) => a.index - b.index);
  if (dateColumns.length > 0) {
    if (columns.lastContact < 0 && columns.followUpDate < 0) {
      if (dateColumns.length >= 2) {
        take("lastContact", dateColumns[0]);
        take("followUpDate", dateColumns[1]);
      } else {
        // One unlabelled date column: future dates read as a follow-up, past as a contact.
        const only = dateColumns[0];
        take(only.futureDates >= only.pastDates ? "followUpDate" : "lastContact", only);
      }
    } else if (columns.lastContact < 0) {
      take("lastContact", dateColumns[0]);
    } else if (columns.followUpDate < 0) {
      take("followUpDate", dateColumns[0]);
    }
  }

  // The file always imports. If nothing read as an address, take the most
  // address-like leftover column (or the first column) so every file is accepted.
  if (columns.address < 0) {
    const pick = [...unclaimed()].sort((a, b) => b.address - a.address || a.index - b.index)[0];
    columns.address = pick ? pick.index : 0;
    if (pick) claimed.add(pick.index);
  }

  return columns;
}

// A first row counts as headers when it carries recognisable labels, or when it
// plainly is not data. Files exported without a header row still import.
function looksLikeHeaderRow(row: string[]): boolean {
  const normalized = row.map(normalizeHeader);
  const labelled = normalized.some((header) =>
    LEAD_FIELDS.some((field) => headerScore(header, headerAliases[field]) >= 2),
  );
  if (labelled) return true;
  return !row.some((cell) => looksLikeAddress(cell) || looksLikeDate(cell));
}

export function parseLeadCsv(csvText: string): {
  leads: LeadRecord[];
  rejectedRows: RejectedRow[];
} {
  const rows = parseCsvRows((csvText ?? "").replace(/^\uFEFF/, ""));
  if (rows.length === 0) throw new Error("That file has no rows. Export your leads as a CSV and try again.");

  const hasHeader = looksLikeHeaderRow(rows[0]);
  const headerCells = hasHeader ? rows[0].map(normalizeHeader) : [];
  const dataRows = hasHeader ? rows.slice(1) : rows;
  if (dataRows.length === 0) throw new Error("That CSV has a header row but no property records.");

  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const columns = resolveColumns(headerCells, profileColumns(dataRows, columnCount));

  // Columns the parser understood; anything else in the row is handed to the
  // agent as notes so no information in the file is thrown away.
  const knownColumns = new Set(
    [columns.address, columns.ownerName, columns.lastContact, columns.followUpDate, columns.notes].filter((index) => index >= 0),
  );

  const leads: LeadRecord[] = [];
  const rejectedRows: RejectedRow[] = [];
  const firstRowNumber = hasHeader ? 2 : 1;

  dataRows.forEach((values, index) => {
    const rowNumber = index + firstRowNumber;
    const valueAt = (column: number) => (column >= 0 ? (values[column] ?? "").trim() : "");

    // Never reject a row: if the chosen column is blank, use the first value in
    // the row, and fall back to the row number so the record is still keyed.
    const address = valueAt(columns.address) || values.map((value) => (value ?? "").trim()).find(Boolean) || `Row ${rowNumber}`;

    // The agent sees the whole row: the notes column plus every other column the
    // parser did not map (labeled by header when there is one). Rich spreadsheet
    // fields like distress_status or assessed_value reach the agent this way.
    const baseNotes = columns.notes >= 0 ? valueAt(columns.notes) : "";
    const extraNotes = values
      .map((value, column) => {
        if (knownColumns.has(column)) return "";
        const cell = (value ?? "").trim();
        if (!cell) return "";
        const label = hasHeader ? (rows[0][column] ?? "").trim() : "";
        return label ? `${label}: ${cell}` : cell;
      })
      .filter(Boolean)
      .join(" \u00b7 ");
    const notes = [baseNotes, extraNotes].filter(Boolean).join(" \u00b7 ");

    leads.push({
      address,
      notes,
      ownerName: valueAt(columns.ownerName) || "Owner not provided",
      lastContact: valueAt(columns.lastContact),
      followUpDate: valueAt(columns.followUpDate),
      rowNumber,
    });
  });

  if (leads.length === 0) throw new Error("That file has no rows to import. Export your leads as a CSV and try again.");
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
