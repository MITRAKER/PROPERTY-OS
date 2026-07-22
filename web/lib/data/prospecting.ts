// Lead prospecting from live NYC public records.
// A realtor clicks an area on the map; we pull the real tax lots in that radius
// from PLUTO and rank them as prospective leads. Every candidate carries the
// evidence and the source it came from — nothing is invented, and public records
// never supply phone, email, or contact permission.

const PLUTO_URL = "https://data.cityofnewyork.us/resource/64uk-42ks.json";

export type ProspectCandidate = {
  bbl: string;
  address: string;
  ownerName: string;
  yearBuilt: number | null;
  unitsTotal: number | null;
  assessedValue: number | null;
  buildingClass: string | null;
  latitude: number | null;
  longitude: number | null;
  score: number;
  reasons: string[];
  source: string;
};

// Degrees per metre. Longitude degrees shrink with latitude.
export function boundingBox(latitude: number, longitude: number, meters: number) {
  const dLat = meters / 111_320;
  const dLon = meters / (111_320 * Math.max(Math.cos((latitude * Math.PI) / 180), 0.01));
  return {
    minLat: latitude - dLat,
    maxLat: latitude + dLat,
    minLon: longitude - dLon,
    maxLon: longitude + dLon,
  };
}

const ENTITY_PATTERN = /\b(LLC|L\.L\.C|INC|CORP|CO\b|COMPANY|LP\b|L\.P|TRUST|BOARD|MANAGERS|ASSOC|ASSOCIATES|PARTNERS|HOLDINGS|REALTY|PROPERTIES|CHURCH|CITY OF|HOUSING|AUTHORITY|NYC)\b/i;

export function looksIndividuallyOwned(ownerName: string): boolean {
  if (!ownerName.trim()) return false;
  return !ENTITY_PATTERN.test(ownerName);
}

// Transparent candidate scoring — every point has a stated reason.
export function scoreCandidate(input: {
  ownerName: string;
  yearBuilt: number | null;
  unitsTotal: number | null;
  assessedValue: number | null;
}): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 40;

  if (looksIndividuallyOwned(input.ownerName)) {
    score += 18;
    reasons.push("Individually owned (not a corporate entity)");
  } else if (input.ownerName.trim()) {
    score -= 10;
    reasons.push("Owned by a company or institution");
  }

  if (input.unitsTotal !== null && input.unitsTotal >= 1 && input.unitsTotal <= 2) {
    score += 15;
    reasons.push(`${input.unitsTotal}-family home (typical listing target)`);
  }

  if (input.yearBuilt !== null && input.yearBuilt > 1800 && input.yearBuilt <= 1960) {
    score += 12;
    reasons.push(`Built in ${input.yearBuilt} (older housing stock)`);
  }

  if (input.assessedValue !== null && input.assessedValue >= 50_000) {
    score += 10;
    reasons.push("Above-median assessed value for the area");
  }

  return { score: Math.max(0, Math.min(100, score)), reasons };
}

function toNumber(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeBbl(value: unknown): string {
  const parsed = toNumber(value);
  return parsed === null ? "" : String(Math.round(parsed));
}

async function fetchJson(url: string, timeoutMs = 9_000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
    if (!response.ok) throw new Error(`NYC PLUTO returned ${response.status}.`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

// Returns real tax lots near a point, ranked as prospective leads.
export async function prospectNearby(
  latitude: number,
  longitude: number,
  meters = 250,
  limit = 40,
): Promise<ProspectCandidate[]> {
  const box = boundingBox(latitude, longitude, meters);
  const where = `latitude between ${box.minLat} and ${box.maxLat} AND longitude between ${box.minLon} and ${box.maxLon}`;
  const select = "bbl,address,ownername,yearbuilt,unitstotal,assesstot,bldgclass,latitude,longitude";
  const url = `${PLUTO_URL}?$where=${encodeURIComponent(where)}&$select=${select}&$limit=${limit}`;

  const rows = (await fetchJson(url)) as Array<Record<string, unknown>>;
  const candidates: ProspectCandidate[] = [];

  for (const row of rows ?? []) {
    const address = typeof row.address === "string" ? row.address.trim() : "";
    const bbl = normalizeBbl(row.bbl);
    if (!address || !bbl) continue;

    const ownerName = typeof row.ownername === "string" ? row.ownername.trim() : "";
    const yearBuilt = toNumber(row.yearbuilt);
    const unitsTotal = toNumber(row.unitstotal);
    const assessedValue = toNumber(row.assesstot);
    const { score, reasons } = scoreCandidate({ ownerName, yearBuilt, unitsTotal, assessedValue });

    candidates.push({
      bbl,
      address,
      ownerName: ownerName || "Owner not listed",
      yearBuilt: yearBuilt && yearBuilt > 1800 ? yearBuilt : null,
      unitsTotal,
      assessedValue,
      buildingClass: typeof row.bldgclass === "string" ? row.bldgclass : null,
      latitude: toNumber(row.latitude),
      longitude: toNumber(row.longitude),
      score,
      reasons,
      source: "NYC PLUTO",
    });
  }

  return candidates.sort((a, b) => b.score - a.score);
}
