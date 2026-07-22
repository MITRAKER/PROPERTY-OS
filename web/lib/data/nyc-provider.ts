import {
  PUBLIC_RECORD_GAPS,
  type PropertyContext,
  type PropertyDataProvider,
  type PropertyFactSheet,
  type PublicSignal,
  type SourceRef,
} from "../agents/property-context.ts";
import { compareAddresses, fetchOwnerMailing } from "./owner-mailing.ts";

// Official NYC Open Data endpoints (no API key needed for light MVP usage).
const GEOSEARCH_URL = "https://geosearch.planninglabs.nyc/v2/search";
const PLUTO_URL = "https://data.cityofnewyork.us/resource/64uk-42ks.json";
const HPD_VIOLATIONS_URL = "https://data.cityofnewyork.us/resource/wvxf-dwi5.json";
const DOB_PERMITS_URL = "https://data.cityofnewyork.us/resource/ipu4-2q9a.json";
const ACRIS_LEGALS_URL = "https://data.cityofnewyork.us/resource/8h5j-fqxa.json"; // property <-> document links
const ACRIS_MASTER_URL = "https://data.cityofnewyork.us/resource/bnx9-e6tj.json"; // document details

const BOROUGH_NAMES: Record<string, string> = {
  "1": "Manhattan",
  "2": "Bronx",
  "3": "Brooklyn",
  "4": "Queens",
  "5": "Staten Island",
};

const ACRIS_DOC_LABELS: Record<string, string> = {
  DEED: "Deed",
  MTGE: "Mortgage",
  SAT: "Satisfaction of mortgage",
  ASST: "Assignment of mortgage",
  AGMT: "Agreement",
  RPTT: "Property transfer tax filing",
};

async function fetchJson(url: string, timeoutMs = 8_000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
    if (!response.ok) throw new Error(`Upstream ${response.status} for ${new URL(url).host}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function toNumber(value: unknown): number | undefined {
  const parsed = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

// A BBL is borough (1) + block (5) + lot (4), e.g. 1000477501.
export function parseBbl(bbl: string): { borough: string; block: number; lot: number } | null {
  const digits = bbl.replace(/\D/g, "");
  if (digits.length !== 10) return null;
  return { borough: digits.slice(0, 1), block: Number(digits.slice(1, 6)), lot: Number(digits.slice(6, 10)) };
}

type GeoSearchHit = {
  label: string;
  bbl: string | null;
  bin: string | null;
  coordinates: { latitude: number; longitude: number } | null;
};

function extractGeoSearchHit(payload: unknown): GeoSearchHit | null {
  const features = (payload as { features?: unknown[] })?.features;
  if (!Array.isArray(features) || features.length === 0) return null;
  const feature = features[0] as {
    properties?: Record<string, unknown> & { addendum?: { pad?: { bbl?: string; bin?: string } } };
    geometry?: { coordinates?: [number, number] };
  };
  const props = feature.properties ?? {};
  const pad = props.addendum?.pad ?? {};
  const bbl = (props.pad_bbl as string) ?? pad.bbl ?? null;
  const bin = (props.pad_bin as string) ?? pad.bin ?? null;
  const coordinates = feature.geometry?.coordinates
    ? { latitude: feature.geometry.coordinates[1], longitude: feature.geometry.coordinates[0] }
    : null;
  return { label: (props.label as string) ?? "", bbl, bin, coordinates };
}

type Parsed = { borough: string; block: number; lot: number };

// Live provider: reads only official NYC Open Data endpoints. This is a data
// ingestion service, not an agent — it does not analyze or invent anything, and
// it records the source and retrieval time for every fact.
export class NycPropertyDataProvider implements PropertyDataProvider {
  readonly name = "nyc";
  readonly provenance = "nyc_open_data" as const;

  async getByAddress(address: string): Promise<PropertyContext> {
    const now = () => new Date().toISOString();
    const sources: SourceRef[] = [];
    const missingInformation = [...PUBLIC_RECORD_GAPS];

    // 1. GeoSearch: authoritative address -> BBL/BIN/coordinates.
    const geo = extractGeoSearchHit(await fetchJson(`${GEOSEARCH_URL}?text=${encodeURIComponent(address)}&size=1`));
    if (!geo || !geo.bbl) {
      throw new Error(`NYC GeoSearch could not resolve "${address}" to a tax lot (BBL).`);
    }
    sources.push({ name: "NYC GeoSearch", recordId: geo.bbl, retrievedAt: now(), url: GEOSEARCH_URL });
    const parsed = parseBbl(geo.bbl);

    const context: PropertyContext = {
      propertyId: geo.bbl,
      address: geo.label || address,
      bbl: geo.bbl,
      bin: geo.bin,
      coordinates: geo.coordinates,
      facts: {},
      publicSignals: [],
      crmTimeline: [], // public records carry no CRM history
      sources,
      missingInformation,
      provenance: "nyc_open_data",
    };

    // 2-6. Independent lookups run in parallel once we have the BBL/BIN.
    const [pluto, hpd, dob, acris, mailing] = await Promise.allSettled([
      this.fetchPluto(geo.bbl),
      parsed ? this.fetchHpdViolations(parsed) : Promise.resolve(null),
      geo.bin ? this.fetchDobPermits(geo.bin) : Promise.resolve(null),
      parsed ? this.fetchAcrisDocuments(parsed) : Promise.resolve(null),
      parsed ? fetchOwnerMailing(parsed.borough, parsed.block, parsed.lot) : Promise.resolve(null),
    ]);

    if (pluto.status === "fulfilled" && pluto.value) {
      context.facts = pluto.value.facts;
      context.publicSignals.push(...pluto.value.signals);
      if (!context.coordinates && pluto.value.coordinates) context.coordinates = pluto.value.coordinates;
      sources.push({ name: "NYC PLUTO", recordId: geo.bbl, retrievedAt: now(), url: PLUTO_URL });
    } else {
      missingInformation.push("pluto_unavailable");
    }

    if (hpd.status === "fulfilled" && hpd.value) {
      context.publicSignals.push(...hpd.value);
      sources.push({ name: "NYC HPD Violations", recordId: bblKey(parsed), retrievedAt: now(), url: HPD_VIOLATIONS_URL });
    } else if (parsed) {
      missingInformation.push("hpd_unavailable");
    }

    if (dob.status === "fulfilled" && dob.value) {
      context.publicSignals.push(...dob.value);
      sources.push({ name: "NYC DOB Permits", recordId: geo.bin ?? "", retrievedAt: now(), url: DOB_PERMITS_URL });
    } else if (geo.bin) {
      missingInformation.push("dob_unavailable");
    }

    if (acris.status === "fulfilled" && acris.value) {
      context.publicSignals.push(...acris.value);
      sources.push({ name: "NYC ACRIS", recordId: bblKey(parsed), retrievedAt: now(), url: ACRIS_MASTER_URL });
    } else if (parsed) {
      missingInformation.push("acris_unavailable");
    }

    // Absentee detection: the owner's mailing address vs the property address.
    if (mailing.status === "fulfilled" && mailing.value) {
      const owner = mailing.value;
      context.facts.ownerMailingAddress = [owner.mailingAddress, owner.city, owner.state].filter(Boolean).join(", ");
      const verdict = compareAddresses(context.address, owner);
      if (verdict.absentee) {
        context.publicSignals.push({
          type: "absentee_owner",
          source: owner.source,
          description: `${verdict.reason} Owner on record: ${owner.ownerName} (${owner.contactType}).`,
        });
      }
      sources.push({ name: owner.source, recordId: bblKey(parsed), retrievedAt: now(), url: "" });
    } else if (parsed) {
      missingInformation.push("owner_mailing_address_unavailable");
    }

    if (parsed && BOROUGH_NAMES[parsed.borough] && !new RegExp(BOROUGH_NAMES[parsed.borough], "i").test(context.address)) {
      context.address = `${context.address}, ${BOROUGH_NAMES[parsed.borough]}`;
    }

    return context;
  }

  private async fetchPluto(bbl: string): Promise<{ facts: PropertyFactSheet; signals: PublicSignal[]; coordinates: { latitude: number; longitude: number } | null }> {
    const rows = (await fetchJson(`${PLUTO_URL}?bbl=${encodeURIComponent(bbl)}&$limit=1`)) as Array<Record<string, unknown>>;
    const lot = rows?.[0];
    if (!lot) throw new Error("No PLUTO record");
    const facts: PropertyFactSheet = {
      ownerName: str(lot.ownername),
      yearBuilt: toNumber(lot.yearbuilt),
      totalUnits: toNumber(lot.unitstotal),
      buildingArea: toNumber(lot.bldgarea),
      lotArea: toNumber(lot.lotarea),
      assessedValue: toNumber(lot.assesstot),
      propertyType: str(lot.bldgclass),
    };
    const signals: PublicSignal[] = [];
    const year = toNumber(lot.yearbuilt);
    if (year && year > 1800) {
      signals.push({
        type: "building_age",
        date: `${year}`,
        source: "NYC PLUTO",
        description: `Built in ${year} (${new Date().getUTCFullYear() - year} years old).`,
      });
    }
    const latitude = toNumber(lot.latitude);
    const longitude = toNumber(lot.longitude);
    return { facts, signals, coordinates: latitude && longitude ? { latitude, longitude } : null };
  }

  private async fetchHpdViolations(parsed: Parsed): Promise<PublicSignal[]> {
    const url = `${HPD_VIOLATIONS_URL}?boroid=${parsed.borough}&block=${parsed.block}&lot=${parsed.lot}&$limit=25&$order=approveddate DESC`;
    const rows = (await fetchJson(url)) as Array<Record<string, unknown>>;
    return (rows ?? []).map((violation) => {
      const cls = str(violation.class) ?? "?";
      const status = str(violation.currentstatus) ?? "";
      const desc = str(violation.novdescription) ?? "Housing violation";
      return {
        type: "violation",
        date: str(violation.approveddate) ?? str(violation.inspectiondate),
        source: "NYC HPD",
        description: `Class ${cls} violation: ${desc}${status ? ` (${status})` : ""}`,
      } satisfies PublicSignal;
    });
  }

  private async fetchDobPermits(bin: string): Promise<PublicSignal[]> {
    const url = `${DOB_PERMITS_URL}?bin__=${encodeURIComponent(bin)}&$limit=10&$order=issuance_date DESC`;
    const rows = (await fetchJson(url)) as Array<Record<string, unknown>>;
    return (rows ?? []).map((permit) => {
      const type = str(permit.permit_type) ?? str(permit.job_type) ?? "Permit";
      const status = str(permit.permit_status) ?? str(permit.filing_status) ?? "";
      const work = str(permit.work_type) ?? str(permit.permit_subtype) ?? str(permit.job_type) ?? "work";
      return {
        type: "permit",
        date: str(permit.issuance_date)?.slice(0, 10) ?? str(permit.filing_date)?.slice(0, 10),
        source: "NYC DOB",
        description: `DOB ${type} permit${status ? ` (${status})` : ""} — ${work}`,
      } satisfies PublicSignal;
    });
  }

  // Two-step ACRIS: property -> document links (legals), then document details (master).
  private async fetchAcrisDocuments(parsed: Parsed): Promise<PublicSignal[]> {
    const legalsUrl = `${ACRIS_LEGALS_URL}?borough=${parsed.borough}&block=${parsed.block}&lot=${parsed.lot}&$select=document_id&$limit=40`;
    const legals = (await fetchJson(legalsUrl)) as Array<Record<string, unknown>>;
    const documentIds = Array.from(new Set((legals ?? []).map((row) => str(row.document_id)).filter((id): id is string => Boolean(id)))).slice(0, 30);
    if (documentIds.length === 0) return [];

    const inList = documentIds.map((id) => `'${id.replace(/'/g, "")}'`).join(",");
    const masterUrl = `${ACRIS_MASTER_URL}?$where=document_id in(${encodeURIComponent(inList)})&$order=recorded_datetime DESC&$limit=10`;
    const master = (await fetchJson(masterUrl)) as Array<Record<string, unknown>>;

    return (master ?? []).map((doc) => {
      const docType = str(doc.doc_type) ?? "DOC";
      const label = ACRIS_DOC_LABELS[docType] ?? docType;
      const recorded = str(doc.recorded_datetime)?.slice(0, 10) ?? str(doc.document_date)?.slice(0, 10);
      const amount = toNumber(doc.document_amt);
      return {
        type: "recorded_document",
        date: recorded,
        source: "NYC ACRIS",
        description: `${label} (${docType})${recorded ? ` recorded ${recorded}` : ""}${amount && amount > 0 ? ` — $${amount.toLocaleString("en-US")}` : ""}`,
      } satisfies PublicSignal;
    });
  }
}

function bblKey(parsed: Parsed | null): string {
  return parsed ? `${parsed.borough}-${parsed.block}-${parsed.lot}` : "";
}
