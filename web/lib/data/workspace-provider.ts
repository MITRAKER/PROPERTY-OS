import type { PropertyRecord } from "../property-model.ts";
import {
  PUBLIC_RECORD_GAPS,
  type CrmTimelineEvent,
  type PropertyContext,
  type PropertyDataProvider,
  type PublicSignal,
} from "../agents/property-context.ts";

const SIGNAL_TYPES: Array<[RegExp, string]> = [
  [/violation/i, "violation"],
  [/probate|inherit|estate/i, "estate_event"],
  [/tax\s*lien|lien/i, "lien"],
  [/vacant|vacancy/i, "vacancy"],
  [/expired\s*listing/i, "expired_listing"],
  [/absentee/i, "absentee_owner"],
  [/permit|repair/i, "permit_or_repair"],
];

function signalType(label: string): string {
  for (const [pattern, type] of SIGNAL_TYPES) {
    if (pattern.test(label)) return type;
  }
  return "note_signal";
}

const TIMELINE_TYPES: Record<string, string> = {
  call: "call_note",
  note: "note",
  signal: "public_signal",
  task: "task",
};

// Converts a real workspace property record into the same normalized
// PropertyContext shape the live NYC provider produces, so the agent code is
// identical either way. The signals come from the property's own CRM notes.
export function contextFromRecord(record: PropertyRecord, retrievedAt = new Date().toISOString()): PropertyContext {
  const publicSignals: PublicSignal[] = record.signals.map((label) => ({
    type: signalType(label),
    source: "workspace_record",
    description: label,
  }));

  const crmTimeline: CrmTimelineEvent[] = record.timeline.map((event) => ({
    date: event.date,
    type: TIMELINE_TYPES[event.type] ?? "note",
    text: `${event.title}: ${event.detail}`,
  }));

  return {
    propertyId: record.id,
    address: record.address,
    bbl: record.bbl ?? null,
    bin: record.bin ?? null,
    coordinates: record.latitude != null && record.longitude != null ? { latitude: record.latitude, longitude: record.longitude } : null,
    facts: {
      ownerName: record.ownerName,
      ownershipYears: record.ownershipYears || undefined,
      assessedValue: record.assessedValue ?? undefined,
      yearBuilt: record.yearBuilt ?? undefined,
    },
    publicSignals,
    crmTimeline,
    sources: [{ name: "Property OS workspace", retrievedAt }],
    missingInformation: [...PUBLIC_RECORD_GAPS],
    provenance: "workspace",
  };
}

// Default provider: reads the workspace's own records. No network calls.
export class WorkspacePropertyDataProvider implements PropertyDataProvider {
  readonly name = "workspace";
  readonly provenance = "workspace" as const;
  private readonly records: PropertyRecord[];

  constructor(records: PropertyRecord[] = []) {
    this.records = records;
  }

  async getByAddress(address: string): Promise<PropertyContext> {
    const query = address.trim().toLowerCase();
    const record =
      this.records.find((item) => item.address.toLowerCase() === query) ??
      this.records.find((item) => item.address.toLowerCase().includes(query));
    if (!record) {
      throw new Error(`No workspace property matches "${address}". Use the NYC source for a live public-record lookup.`);
    }
    return contextFromRecord(record);
  }
}
