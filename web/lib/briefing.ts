import { extractLocally } from "./extraction.ts";
import type { Confidence, ExtractionMetrics, LeadExtraction } from "./extraction.ts";
import { selectTopPriorities } from "./property-intelligence.ts";

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

  // Property Intelligence Agent owns deterministic ranking + Top 3 selection.
  const priorities = selectTopPriorities(allowed, now, 3);

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
