// The normalized record the Property Intelligence Agent analyzes. A data provider
// (demo today, NYC Open Data later) produces this; the agent only reads it. The
// agent never fetches, scrapes, or modifies records.

export type SourceRef = {
  name: string;
  recordId?: string;
  retrievedAt: string; // ISO timestamp
  url?: string;
};

export type PublicSignal = {
  type: string; // e.g. "violation", "permit", "sale", "mortgage"
  date?: string;
  source: string; // provenance label, e.g. "NYC HPD", "demo_hpd_record"
  description: string;
};

export type CrmTimelineEvent = {
  date: string;
  type: string; // e.g. "call_note", "email", "task"
  text: string;
};

export type PropertyFactSheet = {
  ownerName?: string;
  ownerMailingAddress?: string;
  ownershipYears?: number;
  yearBuilt?: number;
  totalUnits?: number;
  buildingArea?: number;
  lotArea?: number;
  assessedValue?: number;
  propertyType?: string;
};

export type PropertyContext = {
  propertyId: string;
  address: string;
  bbl?: string | null;
  bin?: string | null;
  coordinates?: { latitude: number; longitude: number } | null;
  facts: PropertyFactSheet;
  publicSignals: PublicSignal[];
  crmTimeline: CrmTimelineEvent[];
  sources: SourceRef[];
  // Facts a public-record provider structurally cannot supply. These belong to the
  // CRM or authorized integrations, never to public data.
  missingInformation: string[];
  provenance: "workspace" | "nyc_open_data";
};

// A data provider turns an address (or property id) into a normalized
// PropertyContext. Swapping providers must not require changing the agent.
export interface PropertyDataProvider {
  readonly name: string;
  readonly provenance: "workspace" | "nyc_open_data";
  getByAddress(address: string): Promise<PropertyContext>;
}

// Facts that public property records cannot provide. Always surfaced as
// missingInformation so the agent (and UI) never imply they came from public data.
export const PUBLIC_RECORD_GAPS = [
  "phone_number",
  "email_address",
  "contact_permission",
  "verified_sale_intent",
  "private_call_or_message_history",
];
