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
  reasons: string[];
  evidence: string[];
  recommendedAction: string;
  lastContact: string | null;
  followUpDate: string | null;
};

export type BriefingResult = {
  importedCount: number;
  rejectedRows: RejectedRow[];
  generatedAt: string;
  priorities: BriefingPriority[];
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
    Object.entries(headerAliases).map(([field, aliases]) => [
      field,
      findColumn(headers, aliases),
    ]),
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

  if (leads.length === 0) {
    throw new Error("No valid property records were found in the CSV.");
  }

  return { leads, rejectedRows };
}

function parseDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function daysBetween(earlier: Date, later: Date) {
  return Math.floor((later.getTime() - earlier.getTime()) / DAY_MS);
}

function pluralizeDays(value: number) {
  return `${value} day${value === 1 ? "" : "s"}`;
}

function rankLead(lead: LeadRecord, now: Date): RankedLead {
  let score = 0;
  const reasons: string[] = [];
  const evidence: string[] = [];
  const normalizedNotes = lead.notes.toLowerCase();
  const followUp = parseDate(lead.followUpDate);
  const lastContact = parseDate(lead.lastContact);

  if (followUp) {
    const daysLate = daysBetween(followUp, now);
    if (daysLate >= 0) {
      score += 50 + Math.min(daysLate, 20);
      reasons.push(`Follow-up is ${pluralizeDays(daysLate)} overdue`);
      evidence.push(`Follow-up date in the imported record: ${lead.followUpDate}`);
    } else if (daysLate >= -7) {
      score += 30;
      reasons.push(`Follow-up is due in ${pluralizeDays(Math.abs(daysLate))}`);
      evidence.push(`Follow-up date in the imported record: ${lead.followUpDate}`);
    }
  }

  const signals: Array<{ terms: string[]; points: number; reason: string }> = [
    {
      terms: ["inherited", "inheritance", "probate", "estate"],
      points: 28,
      reason: "Notes contain an inheritance or estate signal",
    },
    {
      terms: ["violation", "code issue", "dob"],
      points: 20,
      reason: "Notes mention a property violation",
    },
    {
      terms: ["call me", "call back", "follow up", "reach out"],
      points: 18,
      reason: "The owner requested or invited follow-up",
    },
    {
      terms: ["sell", "selling", "listing", "offer"],
      points: 16,
      reason: "Notes contain a possible selling signal",
    },
    {
      terms: ["vacant", "absentee", "out of state"],
      points: 12,
      reason: "Notes contain a vacancy or absentee-owner signal",
    },
  ];

  signals.forEach((signal) => {
    if (signal.terms.some((term) => normalizedNotes.includes(term))) {
      score += signal.points;
      reasons.push(signal.reason);
    }
  });

  if (lastContact) {
    const quietDays = Math.max(0, daysBetween(lastContact, now));
    if (quietDays >= 30) {
      score += 20;
      reasons.push(`No recorded contact for ${pluralizeDays(quietDays)}`);
    } else if (quietDays >= 14) {
      score += 12;
      reasons.push(`Last contact was ${pluralizeDays(quietDays)} ago`);
    }
    evidence.push(`Last contact in the imported record: ${lead.lastContact}`);
  }

  evidence.unshift(`Lead note: “${lead.notes.slice(0, 180)}${lead.notes.length > 180 ? "…" : "”"}`);

  const hasOverdueFollowUp = followUp && daysBetween(followUp, now) >= 0;
  const recommendedAction = hasOverdueFollowUp
    ? `Call ${lead.ownerName} today and reference the documented follow-up.`
    : `Review the note, then contact ${lead.ownerName} with a property-specific check-in.`;

  return {
    score,
    address: lead.address,
    ownerName: lead.ownerName,
    headline: reasons[0] ?? "Review this property lead",
    reasons: reasons.slice(0, 3),
    evidence: evidence.slice(0, 3),
    recommendedAction,
    lastContact: lead.lastContact || null,
    followUpDate: lead.followUpDate || null,
  };
}

export function generateBriefing(
  csvText: string,
  now = new Date(),
): BriefingResult {
  const { leads, rejectedRows } = parseLeadCsv(csvText);
  const priorities = leads
    .map((lead) => rankLead(lead, now))
    .sort((a, b) => b.score - a.score || a.address.localeCompare(b.address))
    .slice(0, 3)
    .map(({ score: _score, ...priority }, index) => ({
      ...priority,
      rank: index + 1,
    }));

  return {
    importedCount: leads.length,
    rejectedRows,
    generatedAt: now.toISOString(),
    priorities,
  };
}
