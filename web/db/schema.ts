import { sql } from "drizzle-orm";
import { integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Identity & multi-tenancy. Every user belongs to one or more workspaces, and
// all property data is scoped to a workspace_id.
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull().default("google"),
  providerSub: text("provider_sub").notNull(),
  email: text("email").notNull(),
  name: text("name").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ownerUserId: text("owner_user_id").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const workspaceMembers = sqliteTable(
  "workspace_members",
  {
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    role: text("role").notNull().default("owner"), // owner | member
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({ pk: primaryKey({ columns: [table.workspaceId, table.userId] }) }),
);

// Property-Centered Data Layer.
// The property (address) is the stable workspace; people are relationships to it.
// Ownership can change and one person can relate to multiple properties, so a
// property and its owner are never collapsed into a single record.

export const properties = sqliteTable("properties", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().default(""),
  address: text("address").notNull(),
  neighborhood: text("neighborhood").notNull().default(""),
  ownerName: text("owner_name").notNull().default("Owner not provided"),
  status: text("status").notNull().default("review"),
  statusLabel: text("status_label").notNull().default("Needs review"),
  score: integer("score").notNull().default(0),
  equity: text("equity").notNull().default(""),
  ownershipYears: integer("ownership_years").notNull().default(0),
  lastContact: text("last_contact").notNull().default(""),
  followUpDate: text("follow_up_date"),
  nextAction: text("next_action").notNull().default(""),
  summary: text("summary").notNull().default(""),
  mapClass: text("map_class").notNull().default("parcel-a"),
  source: text("source").notNull().default("import"), // demo | import
  latitude: real("latitude"),
  longitude: real("longitude"),
  bbl: text("bbl"),
  bin: text("bin"),
  assessedValue: integer("assessed_value"),
  yearBuilt: integer("year_built"),
  ownerMailingAddress: text("owner_mailing_address"),
  enriched: integer("enriched", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const people = sqliteTable("people", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().default(""),
  name: text("name").notNull(),
  role: text("role").notNull().default("owner"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const propertyPeople = sqliteTable(
  "property_people",
  {
    workspaceId: text("workspace_id").notNull().default(""),
    propertyId: text("property_id").notNull(),
    personId: text("person_id").notNull(),
    relationship: text("relationship").notNull().default("owner"),
  },
  (table) => ({ pk: primaryKey({ columns: [table.propertyId, table.personId] }) }),
);

export const signals = sqliteTable("signals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull().default(""),
  propertyId: text("property_id").notNull(),
  type: text("type").notNull(),
  value: text("value").notNull().default(""),
  source: text("source").notNull().default("lead_note"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const timelineEvents = sqliteTable("timeline_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull().default(""),
  propertyId: text("property_id").notNull(),
  type: text("type").notNull().default("note"), // call | note | signal | task
  title: text("title").notNull(),
  detail: text("detail").notNull().default(""),
  eventDate: text("event_date").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().default(""),
  propertyId: text("property_id"),
  title: text("title").notNull(),
  address: text("address").notNull().default(""),
  due: text("due").notNull().default("Today"),
  time: text("time").notNull().default(""),
  priority: text("priority").notNull().default("medium"),
  completed: integer("completed", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Deterministic contact permissions. This table, not the model, decides whether
// outreach on a channel is allowed.
export const contactPermissions = sqliteTable("contact_permissions", {
  propertyId: text("property_id").primaryKey(),
  workspaceId: text("workspace_id").notNull().default(""),
  doNotContact: integer("do_not_contact", { mode: "boolean" }).notNull().default(false),
  phoneAllowed: integer("phone_allowed", { mode: "boolean" }).notNull().default(true),
  emailAllowed: integer("email_allowed", { mode: "boolean" }).notNull().default(true),
  mailAllowed: integer("mail_allowed", { mode: "boolean" }).notNull().default(true),
  // Cold SMS is opt-in. A person must explicitly enable it for this property.
  textAllowed: integer("text_allowed", { mode: "boolean" }).notNull().default(false),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Observability: one row per model/agent call, whether Claude or the local fallback.
export const modelRuns = sqliteTable("model_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull().default(""),
  agent: text("agent").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  latencyMs: integer("latency_ms").notNull().default(0),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  costUsd: real("cost_usd").notNull().default(0),
  fallbackCount: integer("fallback_count").notNull().default(0),
  summary: text("summary").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Human-approval gate. Drafted outreach is stored here as "pending" and is never
// sent by the system; a person must approve or reject it.
export const approvals = sqliteTable("approvals", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().default(""),
  propertyId: text("property_id"),
  kind: text("kind").notNull().default("outreach"),
  channel: text("channel").notNull().default("call"),
  draft: text("draft").notNull().default(""),
  status: text("status").notNull().default("pending"), // pending | approved | rejected
  complianceWarnings: text("compliance_warnings").notNull().default("[]"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  decidedAt: text("decided_at"),
  // Delivery tracking (populated only after a human approves and it actually sends).
  recipient: text("recipient"),
  deliveryStatus: text("delivery_status"),
  deliveredAt: text("delivered_at"),
  providerMessageId: text("provider_message_id"),
  deliveryError: text("delivery_error"),
});

// Owner contact details. Never sourced from public records (they carry none) —
// entered manually or returned by a paid contact-data vendor. Governed by the
// same contact_permissions gate as everything else.
export const contacts = sqliteTable("contacts", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().default(""),
  propertyId: text("property_id").notNull(),
  type: text("type").notNull().default("phone"), // phone | email
  value: text("value").notNull(),
  label: text("label").notNull().default(""),
  source: text("source").notNull().default("manual"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Workspace-wide do-not-contact ("suppression") list. A phone or email here is
// blocked on every property and channel — the internal DNC scrub the send-time
// gate consults. Stored normalized (E.164 / lowercased email) so lookups are exact.
export const suppressions = sqliteTable("suppressions", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().default(""),
  kind: text("kind").notNull().default("phone"), // phone | email
  value: text("value").notNull(),
  reason: text("reason").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Recorded property documents (deeds, mortgages, permits) and user-attached
// references. Doubles as the sales-history source.
export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().default(""),
  propertyId: text("property_id").notNull(),
  name: text("name").notNull(),
  docType: text("doc_type").notNull().default("document"),
  source: text("source").notNull().default("user"), // user | nyc_acris | nyc_dob
  reference: text("reference").notNull().default(""),
  recordedDate: text("recorded_date"),
  amount: integer("amount"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Offers tracked against a property.
export const offers = sqliteTable("offers", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().default(""),
  propertyId: text("property_id").notNull(),
  party: text("party").notNull().default(""),
  amount: integer("amount").notNull().default(0),
  status: text("status").notNull().default("draft"), // draft | presented | accepted | rejected | withdrawn
  notes: text("notes").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Saved neighborhood/search views for prospecting.
export const savedNeighborhoods = sqliteTable("saved_neighborhoods", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().default(""),
  name: text("name").notNull(),
  search: text("search").notNull().default(""),
  statusFilter: text("status_filter").notNull().default("all"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// The workspace's licensed-listing board choice. Credentials are deliberately
// never stored here: REBNY/TRREB RESO tokens remain server-side secrets.
export const listingConnections = sqliteTable("listing_connections", {
  workspaceId: text("workspace_id").primaryKey(),
  board: text("board").notNull(), // rebny_rls | trreb
  memberConfirmed: integer("member_confirmed", { mode: "boolean" }).notNull().default(false),
  agreementConfirmed: integer("agreement_confirmed", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Append-only audit trail for every consequential write.
export const auditLog = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull().default(""),
  actor: text("actor").notNull().default("agent"),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull().default(""),
  entityId: text("entity_id").notNull().default(""),
  detail: text("detail").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
