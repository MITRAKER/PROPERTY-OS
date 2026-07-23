import type { AnalyzedSignal } from "./agents/property-intelligence.ts";

export type PropertyStatus = "urgent" | "inherited" | "violation" | "absentee" | "expired" | "warm" | "review";

export type PropertyTimelineEvent = {
  date: string;
  title: string;
  detail: string;
  type: "call" | "note" | "signal" | "task";
};

export type PropertyRecord = {
  id: string;
  address: string;
  neighborhood: string;
  ownerName: string;
  status: PropertyStatus;
  statusLabel: string;
  score: number;
  equity: string;
  ownershipYears: number;
  lastContact: string;
  followUpDate: string | null;
  nextAction: string;
  summary: string;
  signals: string[];
  timeline: PropertyTimelineEvent[];
  mapClass: string;
  // Real geographic + public-record fields (populated by NYC enrichment; the
  // seeded demo properties carry approximate neighborhood coordinates).
  latitude?: number | null;
  longitude?: number | null;
  bbl?: string | null;
  bin?: string | null;
  assessedValue?: number | null;
  yearBuilt?: number | null;
  ownerMailingAddress?: string | null;
  // Real, cited public-record evidence from analyzePropertyContext (populated by
  // NYC enrichment); kept separate from the short `signals` chip labels above.
  intelligenceSignals?: AnalyzedSignal[];
  enriched?: boolean;
};

export type TaskRecord = {
  id: string;
  title: string;
  address: string;
  due: string;
  time: string;
  priority: "high" | "medium" | "low";
  completed: boolean;
};

export const sampleProperties: PropertyRecord[] = [
  {
    id: "prop-001",
    latitude: 40.702,
    longitude: -73.798,
    address: "88 Linden Avenue",
    neighborhood: "Jamaica, Queens",
    ownerName: "Elena Ruiz",
    status: "inherited",
    statusLabel: "Probate",
    score: 96,
    equity: "$684K",
    ownershipYears: 31,
    lastContact: "May 12, 2026",
    followUpDate: "2026-07-18",
    nextAction: "Call today about the overdue listing-proposal follow-up.",
    summary: "The estate remains in probate. The family may list once the paperwork is organized and previously agreed to a follow-up.",
    signals: ["Probate", "2 days overdue", "31 years owned", "High equity"],
    mapClass: "parcel-a",
    timeline: [
      { date: "Jul 18", title: "Follow-up became overdue", detail: "Listing proposal review was scheduled for this date.", type: "task" },
      { date: "Jun 03", title: "Probate note added", detail: "Family is waiting for paperwork before making a listing decision.", type: "note" },
      { date: "May 12", title: "Spoke with Elena", detail: "Requested a proposal after the estate documents are organized.", type: "call" },
    ],
  },
  {
    id: "prop-002",
    latitude: 40.665,
    longitude: -73.735,
    address: "123 Main Street",
    neighborhood: "Rosedale, Queens",
    ownerName: "Sara Patel",
    status: "urgent",
    statusLabel: "Call today",
    score: 93,
    equity: "$742K",
    ownershipYears: 26,
    lastContact: "June 20, 2026",
    followUpDate: "2026-07-21",
    nextAction: "Call tomorrow and reference the inherited-property cleanup timeline.",
    summary: "Sara inherited the home from her aunt and may sell after cleanup. She explicitly requested a callback.",
    signals: ["Inherited", "Callback requested", "26 years owned", "Possible sale"],
    mapClass: "parcel-b",
    timeline: [
      { date: "Jul 20", title: "AI follow-up extracted", detail: "Messy note resolved to a callback on July 21.", type: "signal" },
      { date: "Jul 15", title: "Owner note imported", detail: "Inherited home; cleanup is underway before a possible sale.", type: "note" },
      { date: "Jun 20", title: "Last conversation", detail: "Sara asked to reconnect after the July holiday period.", type: "call" },
    ],
  },
  {
    id: "prop-003",
    latitude: 40.762,
    longitude: -73.771,
    address: "41-09 Bell Boulevard",
    neighborhood: "Bayside, Queens",
    ownerName: "Chloe Martin",
    status: "warm",
    statusLabel: "Warm lead",
    score: 89,
    equity: "$811K",
    ownershipYears: 18,
    lastContact: "July 17, 2026",
    followUpDate: "2026-07-20",
    nextAction: "Call this morning about the offer conversation.",
    summary: "Chloe requested a Monday-morning call about an offer. The property has been vacant since June.",
    signals: ["Call requested", "Vacant", "Offer interest", "Due today"],
    mapClass: "parcel-c",
    timeline: [
      { date: "Today", title: "Call due", detail: "Owner requested a Monday-morning conversation.", type: "task" },
      { date: "Jul 17", title: "Offer interest recorded", detail: "Chloe is willing to discuss an offer.", type: "call" },
      { date: "Jun 08", title: "Vacancy signal added", detail: "Property appears vacant beginning in June.", type: "signal" },
    ],
  },
  {
    id: "prop-004",
    latitude: 40.692,
    longitude: -73.76,
    address: "45 Farmers Boulevard",
    neighborhood: "St. Albans, Queens",
    ownerName: "David Chen",
    status: "violation",
    statusLabel: "Violation",
    score: 84,
    equity: "$566K",
    ownershipYears: 22,
    lastContact: "June 1, 2026",
    followUpDate: "2026-07-28",
    nextAction: "Prepare violation-resolution options before the scheduled callback.",
    summary: "An open DOB violation is creating pressure. David requested options and a callback next Tuesday after 2 PM.",
    signals: ["DOB violation", "Callback scheduled", "22 years owned"],
    mapClass: "parcel-d",
    timeline: [
      { date: "Jul 28", title: "Callback scheduled", detail: "Call after 2 PM with violation-resolution options.", type: "task" },
      { date: "Jul 20", title: "Date extracted", detail: "AI resolved 'nxt Tuesday' to July 28.", type: "signal" },
      { date: "Jun 01", title: "Violation discussed", detail: "David asked for practical paths forward.", type: "call" },
    ],
  },
  {
    id: "prop-005",
    latitude: 40.593,
    longitude: -73.774,
    address: "302 Beach 44th Street",
    neighborhood: "Edgemere, Queens",
    ownerName: "Nadia Williams",
    status: "absentee",
    statusLabel: "Absentee",
    score: 72,
    equity: "$431K",
    ownershipYears: 14,
    lastContact: "July 2, 2026",
    followUpDate: null,
    nextAction: "Review the occupied-rental context before contacting the owner.",
    summary: "The owner is absentee and the rental is occupied. Nadia may hear an offer but has not provided a timeline.",
    signals: ["Absentee owner", "Tenant occupied", "Possible offer"],
    mapClass: "parcel-e",
    timeline: [
      { date: "Jul 02", title: "Rental context confirmed", detail: "Property is occupied; no immediate sale timeline.", type: "call" },
      { date: "Jun 19", title: "Absentee signal added", detail: "Mailing address differs from property address.", type: "signal" },
    ],
  },
  {
    id: "prop-006",
    latitude: 40.688,
    longitude: -73.786,
    address: "155-20 111th Avenue",
    neighborhood: "South Jamaica, Queens",
    ownerName: "Maria Santos",
    status: "expired",
    statusLabel: "Expired listing",
    score: 78,
    equity: "$603K",
    ownershipYears: 17,
    lastContact: "July 8, 2026",
    followUpDate: "2026-08-03",
    nextAction: "Call after the owner's vacation and discuss a refreshed listing plan.",
    summary: "The listing expired last month. Maria remains open to listing and asked for a callback after vacation.",
    signals: ["Expired listing", "Listing interest", "Callback scheduled"],
    mapClass: "parcel-f",
    timeline: [
      { date: "Aug 03", title: "Callback scheduled", detail: "Reconnect after Maria returns from vacation.", type: "task" },
      { date: "Jul 08", title: "Listing interest confirmed", detail: "Still open to listing with a new approach.", type: "call" },
    ],
  },
  {
    id: "prop-007",
    latitude: 40.657,
    longitude: -73.73,
    address: "144-30 243rd Street",
    neighborhood: "Rosedale, Queens",
    ownerName: "Grace Lee",
    status: "review",
    statusLabel: "Needs review",
    score: 64,
    equity: "$719K",
    ownershipYears: 29,
    lastContact: "July 1, 2026",
    followUpDate: null,
    nextAction: "Review ownership documents before any outreach.",
    summary: "Grace and her sister inherited the property but disagree about selling. The ownership documents need review first.",
    signals: ["Inherited", "Conflicting intent", "Manual review"],
    mapClass: "parcel-g",
    timeline: [
      { date: "Jul 01", title: "Conflicting intent recorded", detail: "Grace wants to sell; her sister prefers to keep the property.", type: "call" },
      { date: "Jun 23", title: "Inheritance signal added", detail: "Two family members share decision-making authority.", type: "signal" },
    ],
  },
  {
    id: "prop-008",
    latitude: 40.7,
    longitude: -73.792,
    address: "61 Guy R Brewer Boulevard",
    neighborhood: "Jamaica, Queens",
    ownerName: "Robert King",
    status: "review",
    statusLabel: "Research first",
    score: 58,
    equity: "$497K",
    ownershipYears: 20,
    lastContact: "June 11, 2026",
    followUpDate: null,
    nextAction: "Verify ownership and occupancy before attempting contact.",
    summary: "The house appears vacant and mail was returned. A neighbor believes the owner moved out of state, but no owner conversation is recorded.",
    signals: ["Possible vacancy", "Returned mail", "Out-of-state owner", "Unverified"],
    mapClass: "parcel-h",
    timeline: [
      { date: "Jul 09", title: "Returned mail logged", detail: "Latest mailing could not be delivered.", type: "signal" },
      { date: "Jun 11", title: "Neighbor context added", detail: "Owner may have moved out of state; verify before outreach.", type: "note" },
    ],
  },
];

export const sampleTasks: TaskRecord[] = [
  { id: "task-1", title: "Call Elena about probate follow-up", address: "88 Linden Avenue", due: "Today", time: "9:30 AM", priority: "high", completed: false },
  { id: "task-2", title: "Call Chloe about offer interest", address: "41-09 Bell Boulevard", due: "Today", time: "10:15 AM", priority: "high", completed: false },
  { id: "task-3", title: "Prepare violation options for David", address: "45 Farmers Boulevard", due: "Today", time: "1:00 PM", priority: "medium", completed: false },
  { id: "task-4", title: "Review shared ownership documents", address: "144-30 243rd Street", due: "Tomorrow", time: "11:00 AM", priority: "medium", completed: false },
  { id: "task-5", title: "Verify absentee-owner mailing address", address: "61 Guy R Brewer Boulevard", due: "Jul 23", time: "2:30 PM", priority: "low", completed: false },
];

export const sampleNeighborhoodStats = {
  name: "Rosedale",
  inherited: 8,
  liens: 3,
  violations: 14,
  expired: 2,
  absentee: 5,
  averageEquity: "$710K",
  opportunity: "$18.4M",
};
