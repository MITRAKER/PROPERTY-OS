// Contact data model + the CSV bridge for bulk skip tracing.
//
// Bulk CSV is the cheapest skip-trace tier, so the workspace exports a
// vendor-neutral file and imports whatever comes back. Nothing here talks to a
// vendor — that lives behind ContactDataProvider.

export type ContactType = "phone" | "email";

export type ContactRecord = {
  type: ContactType;
  value: string;
  label?: string;
  source: string;
};

// --- Normalisation -------------------------------------------------------

// US-centric: keep 10 digits, tolerate a leading country code.
export function normalizePhone(value: string): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (local.length !== 10) return null;
  return `+1${local}`;
}

export function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, "").slice(-10);
  if (digits.length !== 10) return value;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function normalizeEmail(value: string): string | null {
  const trimmed = (value ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed)) return null;
  return trimmed;
}

// Accepts either kind and reports which it is.
export function normalizeContact(value: string): { type: ContactType; value: string } | null {
  const email = normalizeEmail(value);
  if (email) return { type: "email", value: email };
  const phone = normalizePhone(value);
  if (phone) return { type: "phone", value: phone };
  return null;
}

// --- Owner names ---------------------------------------------------------

// Public records write owners as "LAST, FIRST M" or "FIRST LAST". Skip-trace
// vendors want them split, so make a best effort and never throw.
export function splitOwnerName(ownerName: string): { first: string; last: string } {
  const name = (ownerName ?? "").trim();
  if (!name) return { first: "", last: "" };

  if (name.includes(",")) {
    const [last, rest] = name.split(",", 2);
    return { first: (rest ?? "").trim().split(/\s+/)[0] ?? "", last: last.trim() };
  }

  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return { first: "", last: parts[0] };
  return { first: parts[0], last: parts[parts.length - 1] };
}

// --- CSV -----------------------------------------------------------------

export function csvEscape(value: string): string {
  const text = value ?? "";
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const SKIP_TRACE_COLUMNS = [
  "property_id",
  "address",
  "owner_name",
  "owner_first_name",
  "owner_last_name",
  "mailing_address",
] as const;

export type SkipTraceRow = {
  propertyId: string;
  address: string;
  ownerName: string;
  mailingAddress?: string | null;
};

// Vendor-neutral export: the columns every bulk skip tracer accepts.
export function buildSkipTraceCsv(rows: SkipTraceRow[]): string {
  const lines = [SKIP_TRACE_COLUMNS.join(",")];
  for (const row of rows) {
    const { first, last } = splitOwnerName(row.ownerName);
    lines.push(
      [row.propertyId, row.address, row.ownerName, first, last, row.mailingAddress ?? ""]
        .map((cell) => csvEscape(String(cell ?? "")))
        .join(","),
    );
  }
  return lines.join("\r\n");
}

// --- Import --------------------------------------------------------------

export type ImportedContact = {
  propertyId?: string;
  address?: string;
  contacts: Array<{ type: ContactType; value: string }>;
};

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && quoted && line[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells.map((value) => value.trim());
}

// Parses whatever a vendor returns. Matches rows back by property_id when the
// export round-trips, otherwise by address. Any column whose header mentions
// phone/mobile/landline/email is harvested.
export function parseSkipTraceCsv(csvText: string): ImportedContact[] {
  const lines = (csvText ?? "").split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]).map((header) => header.toLowerCase().replace(/\s+/g, "_"));
  const propertyIdIndex = headers.findIndex((header) => header === "property_id");
  const addressIndex = headers.findIndex((header) => header === "address" || header === "property_address");
  const contactIndexes = headers
    .map((header, index) => ({ header, index }))
    .filter(({ header }) => /phone|mobile|landline|cell|email/.test(header));

  const results: ImportedContact[] = [];
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    const contacts: Array<{ type: ContactType; value: string }> = [];
    const seen = new Set<string>();

    for (const { index } of contactIndexes) {
      const raw = cells[index];
      if (!raw) continue;
      const normalized = normalizeContact(raw);
      if (!normalized || seen.has(normalized.value)) continue;
      seen.add(normalized.value);
      contacts.push(normalized);
    }

    if (contacts.length === 0) continue;
    results.push({
      propertyId: propertyIdIndex >= 0 ? cells[propertyIdIndex] || undefined : undefined,
      address: addressIndex >= 0 ? cells[addressIndex] || undefined : undefined,
      contacts,
    });
  }
  return results;
}
