// Absentee-owner detection from free public records.
//
// Public data never gives a phone number, but it does give the address the owner
// receives mail at. When that differs from the property address, the owner does
// not live there — one of the strongest listing signals available, and free.
//
// Primary source: HPD Registration Contacts (registered buildings).
// Fallback: DOB job filings, which carry the owner's mailing address.

const HPD_REGISTRATIONS_URL = "https://data.cityofnewyork.us/resource/tesw-yqqr.json";
const HPD_CONTACTS_URL = "https://data.cityofnewyork.us/resource/feu5-w2e2.json";
const DOB_FILINGS_URL = "https://data.cityofnewyork.us/resource/ic3t-wcy2.json";

export const BOROUGH_NAMES: Record<string, string> = {
  "1": "MANHATTAN",
  "2": "BRONX",
  "3": "BROOKLYN",
  "4": "QUEENS",
  "5": "STATEN ISLAND",
};

export type OwnerMailing = {
  ownerName: string;
  contactType: string;
  mailingAddress: string;
  city: string;
  state: string;
  zip: string;
  source: string;
};

const STREET_WORDS: Array<[RegExp, string]> = [
  [/\bSTREET\b/g, "ST"],
  [/\bAVENUE\b/g, "AVE"],
  [/\bBOULEVARD\b/g, "BLVD"],
  [/\bROAD\b/g, "RD"],
  [/\bPLACE\b/g, "PL"],
  [/\bDRIVE\b/g, "DR"],
  [/\bLANE\b/g, "LN"],
  [/\bCOURT\b/g, "CT"],
  [/\bTERRACE\b/g, "TER"],
  [/\bPARKWAY\b/g, "PKWY"],
  [/\bHIGHWAY\b/g, "HWY"],
  [/\bSQUARE\b/g, "SQ"],
  [/\bNORTH\b/g, "N"],
  [/\bSOUTH\b/g, "S"],
  [/\bEAST\b/g, "E"],
  [/\bWEST\b/g, "W"],
];

// Canonicalises street addresses so "2361 Broadway" and "2361 BROADWAY." match,
// and "1ST STREET" matches "1 ST".
export function normalizeAddress(value: string): string {
  let text = (value ?? "").toUpperCase().replace(/[.,#]/g, " ");
  // Strip ordinal suffixes on numbers first, so "1ST" -> "1" before STREET -> ST.
  text = text.replace(/\b(\d+)(ST|ND|RD|TH)\b/g, "$1");
  for (const [pattern, replacement] of STREET_WORDS) text = text.replace(pattern, replacement);
  return text.replace(/\s+/g, " ").trim();
}

export type AbsenteeVerdict = { absentee: boolean; outOfState: boolean; reason: string };

// Compares the property address with the owner's mailing address.
export function compareAddresses(
  propertyAddress: string,
  mailing: { mailingAddress: string; city?: string; state?: string },
): AbsenteeVerdict {
  const property = normalizeAddress(propertyAddress);
  const owner = normalizeAddress(mailing.mailingAddress);
  const outOfState = Boolean(mailing.state && mailing.state.trim().toUpperCase() !== "NY");

  if (!property || !owner) {
    return { absentee: false, outOfState, reason: "Owner mailing address not on record." };
  }
  if (property === owner) {
    return { absentee: false, outOfState: false, reason: "Owner receives mail at the property (likely owner-occupied)." };
  }

  const where = [mailing.mailingAddress, mailing.city, mailing.state].filter(Boolean).join(", ");
  return {
    absentee: true,
    outOfState,
    reason: outOfState
      ? `Out-of-state owner: mail goes to ${where}, not the property.`
      : `Absentee owner: mail goes to ${where}, not the property.`,
  };
}

async function fetchJson(url: string, timeoutMs = 8_000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
    if (!response.ok) throw new Error(`Upstream ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// Owners first, managing agents last — an agent's address is not the owner's.
const CONTACT_PRIORITY = ["INDIVIDUALOWNER", "CORPORATEOWNER", "HEADOFFICER", "OFFICER", "AGENT"];

function rankContact(type: string): number {
  const index = CONTACT_PRIORITY.indexOf(type.toUpperCase());
  return index === -1 ? CONTACT_PRIORITY.length : index;
}

async function fromHpd(borough: string, block: number, lot: number): Promise<OwnerMailing | null> {
  const registrations = (await fetchJson(
    `${HPD_REGISTRATIONS_URL}?boroid=${borough}&block=${block}&lot=${lot}&$limit=1`,
  )) as Array<Record<string, unknown>>;
  const registrationId = str(registrations?.[0]?.registrationid);
  if (!registrationId) return null;

  const contacts = (await fetchJson(
    `${HPD_CONTACTS_URL}?registrationid=${encodeURIComponent(registrationId)}&$limit=25`,
  )) as Array<Record<string, unknown>>;
  if (!contacts?.length) return null;

  const best = [...contacts].sort((a, b) => rankContact(str(a.type)) - rankContact(str(b.type)))[0];
  const house = str(best.businesshousenumber);
  const street = str(best.businessstreetname);
  if (!house && !street) return null;

  const name = str(best.corporationname) || `${str(best.firstname)} ${str(best.lastname)}`.trim();
  return {
    ownerName: name || "Owner on record",
    contactType: str(best.type) || "Contact",
    mailingAddress: [house, street].filter(Boolean).join(" "),
    city: str(best.businesscity),
    state: str(best.businessstate),
    zip: str(best.businesszip),
    source: "NYC HPD Registration Contacts",
  };
}

async function fromDob(borough: string, block: number, lot: number): Promise<OwnerMailing | null> {
  const boroughName = BOROUGH_NAMES[borough];
  if (!boroughName) return null;
  const paddedLot = String(lot).padStart(5, "0");
  const rows = (await fetchJson(
    `${DOB_FILINGS_URL}?borough=${encodeURIComponent(boroughName)}&block=${block}&lot=${paddedLot}&$limit=5`,
  )) as Array<Record<string, unknown>>;

  const row = (rows ?? []).find((item) => str(item.owner_s_house_number) || str(item.owner_shouse_street_name));
  if (!row) return null;

  const name = str(row.owner_s_business_name) ||
    `${str(row.owner_s_first_name)} ${str(row.owner_s_last_name)}`.trim();
  return {
    ownerName: name || "Owner on record",
    contactType: str(row.owner_type) || "Owner",
    mailingAddress: [str(row.owner_s_house_number), str(row.owner_shouse_street_name)].filter(Boolean).join(" "),
    city: "",
    state: "",
    zip: "",
    source: "NYC DOB job filings",
  };
}

// Best-effort: HPD first (richer, includes city/state), then DOB.
export async function fetchOwnerMailing(
  borough: string,
  block: number,
  lot: number,
): Promise<OwnerMailing | null> {
  try {
    const hpd = await fromHpd(borough, block, lot);
    if (hpd) return hpd;
  } catch {
    // fall through to DOB
  }
  try {
    return await fromDob(borough, block, lot);
  } catch {
    return null;
  }
}
