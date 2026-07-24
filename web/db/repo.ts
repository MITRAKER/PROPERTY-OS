import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "./index";
import {
  approvals,
  auditLog,
  contactPermissions,
  documents,
  modelRuns,
  offers,
  people,
  properties,
  propertyPeople,
  contacts,
  suppressions,
  savedNeighborhoods,
  listingConnections,
  signals,
  tasks,
  timelineEvents,
  users,
  workspaceMembers,
  workspaces,
} from "./schema";
import type { PropertyRecord, PropertyTimelineEvent } from "../lib/property-model";
import type { ImportedPropertyRecord } from "../lib/briefing";
import type { ModelRunLog } from "../lib/agents/types";
import type { PropertyContext } from "../lib/agents/property-context";
import { currentWorkspaceId } from "../lib/auth/context";
import { normalizeContact } from "../lib/contacts/contact-model";

type Db = Awaited<ReturnType<typeof getDb>>;

// Deterministic dev tenant, so existing local data is inherited by the dev
// fallback user and never re-seeded.
export const DEV_USER_ID = "user-dev-local";
export const DEV_WORKSPACE_ID = "ws-dev-local";

function ws(): string {
  return currentWorkspaceId();
}

// Property/task ids are namespaced by workspace so two tenants that both seed the
// demo (or import the same CSV) never collide on a primary key.
function scopedId(base: string): string {
  return `${ws()}::${base}`;
}

const DDL = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL DEFAULT 'google',
    provider_sub TEXT NOT NULL,
    email TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    owner_user_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS workspace_members (
    workspace_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'owner',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (workspace_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS properties (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL,
    neighborhood TEXT NOT NULL DEFAULT '',
    owner_name TEXT NOT NULL DEFAULT 'Owner not provided',
    status TEXT NOT NULL DEFAULT 'review',
    status_label TEXT NOT NULL DEFAULT 'Needs review',
    score INTEGER NOT NULL DEFAULT 0,
    equity TEXT NOT NULL DEFAULT '',
    ownership_years INTEGER NOT NULL DEFAULT 0,
    last_contact TEXT NOT NULL DEFAULT '',
    follow_up_date TEXT,
    next_action TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    map_class TEXT NOT NULL DEFAULT 'parcel-a',
    source TEXT NOT NULL DEFAULT 'import',
    latitude REAL,
    longitude REAL,
    bbl TEXT,
    bin TEXT,
    assessed_value INTEGER,
    year_built INTEGER,
    enriched INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS people (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'owner',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS property_people (
    workspace_id TEXT NOT NULL DEFAULT '',
    property_id TEXT NOT NULL,
    person_id TEXT NOT NULL,
    relationship TEXT NOT NULL DEFAULT 'owner',
    PRIMARY KEY (property_id, person_id)
  )`,
  `CREATE TABLE IF NOT EXISTS signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id TEXT NOT NULL DEFAULT '',
    property_id TEXT NOT NULL,
    type TEXT NOT NULL,
    value TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'lead_note',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS timeline_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id TEXT NOT NULL DEFAULT '',
    property_id TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'note',
    title TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    event_date TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL DEFAULT '',
    property_id TEXT,
    title TEXT NOT NULL,
    address TEXT NOT NULL DEFAULT '',
    due TEXT NOT NULL DEFAULT 'Today',
    time TEXT NOT NULL DEFAULT '',
    priority TEXT NOT NULL DEFAULT 'medium',
    completed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS contact_permissions (
    property_id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL DEFAULT '',
    do_not_contact INTEGER NOT NULL DEFAULT 0,
    phone_allowed INTEGER NOT NULL DEFAULT 1,
    email_allowed INTEGER NOT NULL DEFAULT 1,
    mail_allowed INTEGER NOT NULL DEFAULT 1,
    text_allowed INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS model_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id TEXT NOT NULL DEFAULT '',
    agent TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    latency_ms INTEGER NOT NULL DEFAULT 0,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    fallback_count INTEGER NOT NULL DEFAULT 0,
    summary TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS approvals (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL DEFAULT '',
    property_id TEXT,
    kind TEXT NOT NULL DEFAULT 'outreach',
    channel TEXT NOT NULL DEFAULT 'call',
    draft TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    compliance_warnings TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    decided_at TEXT,
    recipient TEXT,
    delivery_status TEXT,
    delivered_at TEXT,
    provider_message_id TEXT,
    delivery_error TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id TEXT NOT NULL DEFAULT '',
    actor TEXT NOT NULL DEFAULT 'agent',
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL DEFAULT '',
    entity_id TEXT NOT NULL DEFAULT '',
    detail TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL DEFAULT '',
    property_id TEXT NOT NULL,
    name TEXT NOT NULL,
    doc_type TEXT NOT NULL DEFAULT 'document',
    source TEXT NOT NULL DEFAULT 'user',
    reference TEXT NOT NULL DEFAULT '',
    recorded_date TEXT,
    amount INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS offers (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL DEFAULT '',
    property_id TEXT NOT NULL,
    party TEXT NOT NULL DEFAULT '',
    amount INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL DEFAULT '',
    property_id TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'phone',
    value TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS saved_neighborhoods (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    search TEXT NOT NULL DEFAULT '',
    status_filter TEXT NOT NULL DEFAULT 'all',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS suppressions (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'phone',
    value TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS listing_connections (
    workspace_id TEXT PRIMARY KEY,
    board TEXT NOT NULL,
    member_confirmed INTEGER NOT NULL DEFAULT 0,
    agreement_confirmed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
];

// Idempotent post-release migrations for existing local databases.
const COLUMN_MIGRATIONS = [
  "ALTER TABLE properties ADD COLUMN latitude REAL",
  "ALTER TABLE properties ADD COLUMN longitude REAL",
  "ALTER TABLE properties ADD COLUMN bbl TEXT",
  "ALTER TABLE properties ADD COLUMN bin TEXT",
  "ALTER TABLE properties ADD COLUMN assessed_value INTEGER",
  "ALTER TABLE properties ADD COLUMN year_built INTEGER",
  "ALTER TABLE properties ADD COLUMN enriched INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE properties ADD COLUMN workspace_id TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE people ADD COLUMN workspace_id TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE property_people ADD COLUMN workspace_id TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE signals ADD COLUMN workspace_id TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE timeline_events ADD COLUMN workspace_id TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE tasks ADD COLUMN workspace_id TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE contact_permissions ADD COLUMN workspace_id TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE model_runs ADD COLUMN workspace_id TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE approvals ADD COLUMN workspace_id TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE audit_log ADD COLUMN workspace_id TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE documents ADD COLUMN workspace_id TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE offers ADD COLUMN workspace_id TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE saved_neighborhoods ADD COLUMN workspace_id TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE approvals ADD COLUMN recipient TEXT",
  "ALTER TABLE approvals ADD COLUMN delivery_status TEXT",
  "ALTER TABLE approvals ADD COLUMN delivered_at TEXT",
  "ALTER TABLE approvals ADD COLUMN provider_message_id TEXT",
  "ALTER TABLE approvals ADD COLUMN delivery_error TEXT",
  "ALTER TABLE properties ADD COLUMN owner_mailing_address TEXT",
];

// Assign all pre-multitenancy rows to the dev workspace so existing local data is
// preserved for the dev fallback user. Idempotent (only touches empty ids).
const BACKFILL_TABLES = [
  "properties", "people", "property_people", "signals", "timeline_events", "tasks",
  "contact_permissions", "model_runs", "approvals", "audit_log", "documents", "offers", "saved_neighborhoods",
  "contacts",
];

let globalReady: Promise<Db> | null = null;

async function runGlobalSetup(db: Db) {
  for (const statement of DDL) {
    await db.run(sql.raw(statement));
  }
  for (const statement of COLUMN_MIGRATIONS) {
    try {
      await db.run(sql.raw(statement));
    } catch (error) {
      const detail =
        error instanceof Error
          ? `${error.message} ${error.cause instanceof Error ? error.cause.message : String(error.cause ?? "")}`
          : String(error);
      if (!/duplicate column/i.test(detail)) throw error;
    }
  }
  for (const table of BACKFILL_TABLES) {
    await db.run(sql.raw(`UPDATE ${table} SET workspace_id = '${DEV_WORKSPACE_ID}' WHERE workspace_id = '' OR workspace_id IS NULL`));
  }
}

// Global schema setup (no workspace context needed).
async function readyGlobal(): Promise<Db> {
  if (!globalReady) {
    globalReady = (async () => {
      const db = await getDb();
      await runGlobalSetup(db);
      return db;
    })().catch((error) => {
      globalReady = null;
      throw error;
    });
  }
  return globalReady;
}

// Workspace-scoped readiness. A workspace starts empty; real data only enters via
// CSV import or NYC enrichment. There is no demo/sample seeding.
async function ready(): Promise<Db> {
  ws(); // assert we are inside an authenticated request
  return readyGlobal();
}

function newId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

// --- Identity & workspace provisioning (no workspace context required) ---
export async function ensureUserAndWorkspace(profile: { sub: string; email: string; name: string }) {
  const db = await readyGlobal();
  const isDev = profile.sub === "dev-local";

  let [user] = await db.select().from(users).where(eq(users.providerSub, profile.sub)).limit(1);
  if (!user) {
    const id = isDev ? DEV_USER_ID : newId("user");
    await db.insert(users).values({ id, provider: isDev ? "dev" : "google", providerSub: profile.sub, email: profile.email, name: profile.name }).onConflictDoNothing();
    [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  }

  let [membership] = await db.select().from(workspaceMembers).where(eq(workspaceMembers.userId, user.id)).limit(1);
  if (!membership) {
    const workspaceId = isDev ? DEV_WORKSPACE_ID : newId("ws");
    await db.insert(workspaces).values({ id: workspaceId, name: isDev ? "Local workspace" : `${profile.name || "My"} workspace`, ownerUserId: user.id }).onConflictDoNothing();
    await db.insert(workspaceMembers).values({ workspaceId, userId: user.id, role: "owner" }).onConflictDoNothing();
    [membership] = await db.select().from(workspaceMembers).where(eq(workspaceMembers.userId, user.id)).limit(1);
  }

  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, membership.workspaceId)).limit(1);
  return { user, workspace };
}

export async function getWorkspaceSummary() {
  const db = await ready();
  const workspaceId = ws();
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  const members = await db.select().from(workspaceMembers).where(eq(workspaceMembers.workspaceId, workspaceId));
  return workspace ? { id: workspace.id, name: workspace.name, memberCount: members.length } : null;
}

async function insertPropertyRecord(
  db: Db,
  property: PropertyRecord,
  source: "import" | "prospect",
  doNotContactOverride?: boolean,
): Promise<string> {
  const id = scopedId(property.id);
  const workspaceId = ws();
  await db
    .insert(properties)
    .values({
      id,
      workspaceId,
      address: property.address,
      neighborhood: property.neighborhood,
      ownerName: property.ownerName,
      status: property.status,
      statusLabel: property.statusLabel,
      score: property.score,
      equity: property.equity,
      ownershipYears: property.ownershipYears,
      lastContact: property.lastContact,
      followUpDate: property.followUpDate,
      nextAction: property.nextAction,
      summary: property.summary,
      mapClass: property.mapClass,
      source,
      latitude: property.latitude ?? null,
      longitude: property.longitude ?? null,
      bbl: property.bbl ?? null,
      bin: property.bin ?? null,
      assessedValue: property.assessedValue ?? null,
      yearBuilt: property.yearBuilt ?? null,
    })
    .onConflictDoNothing();

  const personId = newId("person");
  await db.insert(people).values({ id: personId, workspaceId, name: property.ownerName, role: "owner" });
  await db.insert(propertyPeople).values({ workspaceId, propertyId: id, personId, relationship: "owner" }).onConflictDoNothing();

  for (const signal of property.signals) {
    await db.insert(signals).values({ workspaceId, propertyId: id, type: "label", value: signal, source });
  }
  for (const event of property.timeline) {
    await db.insert(timelineEvents).values({ workspaceId, propertyId: id, type: event.type, title: event.title, detail: event.detail, eventDate: event.date });
  }
  const doNotContact = doNotContactOverride ?? (property.status === "review" && /do not|dnc/i.test(property.summary));
  await db
    .insert(contactPermissions)
    .values({ propertyId: id, workspaceId, doNotContact, textAllowed: false })
    .onConflictDoNothing();
  return id;
}

async function appendAudit(
  db: Db,
  entry: { actor: string; action: string; entityType: string; entityId: string; detail: string },
) {
  await db.insert(auditLog).values({ ...entry, workspaceId: ws() });
}

async function rowToPropertyRecord(db: Db, row: typeof properties.$inferSelect): Promise<PropertyRecord> {
  const workspaceId = ws();
  const signalRows = await db.select().from(signals).where(and(eq(signals.workspaceId, workspaceId), eq(signals.propertyId, row.id)));
  const eventRows = await db
    .select()
    .from(timelineEvents)
    .where(and(eq(timelineEvents.workspaceId, workspaceId), eq(timelineEvents.propertyId, row.id)))
    .orderBy(desc(timelineEvents.createdAt), desc(timelineEvents.id));

  const timeline: PropertyTimelineEvent[] = eventRows.map((event) => ({
    date: event.eventDate || "Recent",
    title: event.title,
    detail: event.detail,
    type: (event.type as PropertyTimelineEvent["type"]) ?? "note",
  }));

  return buildPropertyRecord(row, signalRows.map((signal) => signal.value), timeline);
}

// Pure mapper, so a single property and a whole list can share one shape.
function buildPropertyRecord(
  row: typeof properties.$inferSelect,
  signalValues: string[],
  timeline: PropertyTimelineEvent[],
): PropertyRecord {
  return {
    id: row.id,
    address: row.address,
    neighborhood: row.neighborhood,
    ownerName: row.ownerName,
    status: row.status as PropertyRecord["status"],
    statusLabel: row.statusLabel,
    score: row.score,
    equity: row.equity,
    ownershipYears: row.ownershipYears,
    lastContact: row.lastContact,
    followUpDate: row.followUpDate,
    nextAction: row.nextAction,
    summary: row.summary,
    signals: signalValues,
    timeline,
    mapClass: row.mapClass,
    latitude: row.latitude,
    longitude: row.longitude,
    bbl: row.bbl,
    bin: row.bin,
    assessedValue: row.assessedValue,
    yearBuilt: row.yearBuilt,
    ownerMailingAddress: row.ownerMailingAddress,
    enriched: row.enriched,
  };
}

// Loads the whole list in three queries. Fetching signals and timeline per
// property is an N+1 that made a real import (thousands of rows) unusable.
export async function listProperties(): Promise<PropertyRecord[]> {
  const db = await ready();
  const workspaceId = ws();
  const rows = await db
    .select()
    .from(properties)
    .where(eq(properties.workspaceId, workspaceId))
    .orderBy(desc(properties.score));
  if (rows.length === 0) return [];

  const [signalRows, eventRows] = await Promise.all([
    db.select().from(signals).where(eq(signals.workspaceId, workspaceId)),
    db
      .select()
      .from(timelineEvents)
      .where(eq(timelineEvents.workspaceId, workspaceId))
      .orderBy(desc(timelineEvents.createdAt), desc(timelineEvents.id)),
  ]);

  const signalsByProperty = new Map<string, string[]>();
  for (const signal of signalRows) {
    const list = signalsByProperty.get(signal.propertyId);
    if (list) list.push(signal.value);
    else signalsByProperty.set(signal.propertyId, [signal.value]);
  }

  const timelineByProperty = new Map<string, PropertyTimelineEvent[]>();
  for (const event of eventRows) {
    const entry: PropertyTimelineEvent = {
      date: event.eventDate || "Recent",
      title: event.title,
      detail: event.detail,
      type: (event.type as PropertyTimelineEvent["type"]) ?? "note",
    };
    const list = timelineByProperty.get(event.propertyId);
    if (list) list.push(entry);
    else timelineByProperty.set(event.propertyId, [entry]);
  }

  return rows.map((row) =>
    buildPropertyRecord(row, signalsByProperty.get(row.id) ?? [], timelineByProperty.get(row.id) ?? []),
  );
}

export async function getProperty(id: string): Promise<PropertyRecord | null> {
  const db = await ready();
  const [row] = await db.select().from(properties).where(and(eq(properties.workspaceId, ws()), eq(properties.id, id))).limit(1);
  return row ? rowToPropertyRecord(db, row) : null;
}

export async function getPropertyByAddress(address: string): Promise<PropertyRecord | null> {
  const db = await ready();
  const [row] = await db.select().from(properties).where(and(eq(properties.workspaceId, ws()), eq(properties.address, address))).limit(1);
  return row ? rowToPropertyRecord(db, row) : null;
}

export async function listTasks() {
  const db = await ready();
  return db.select().from(tasks).where(eq(tasks.workspaceId, ws())).orderBy(desc(tasks.createdAt));
}

export async function toggleTask(id: string) {
  const db = await ready();
  const [task] = await db.select().from(tasks).where(and(eq(tasks.workspaceId, ws()), eq(tasks.id, id))).limit(1);
  if (!task) return null;
  const completed = !task.completed;
  await db.update(tasks).set({ completed, updatedAt: sql`CURRENT_TIMESTAMP` }).where(and(eq(tasks.workspaceId, ws()), eq(tasks.id, id)));
  await appendAudit(db, { actor: "agent", action: completed ? "complete_task" : "reopen_task", entityType: "task", entityId: id, detail: task.title });
  return { ...task, completed };
}

export async function addNote(propertyId: string, body: string) {
  const db = await ready();
  const [property] = await db.select().from(properties).where(and(eq(properties.workspaceId, ws()), eq(properties.id, propertyId))).limit(1);
  if (!property) return null;
  await db.insert(timelineEvents).values({ workspaceId: ws(), propertyId, type: "note", title: "Note added", detail: body, eventDate: "Now" });
  await appendAudit(db, { actor: "agent", action: "add_note", entityType: "property", entityId: propertyId, detail: body.slice(0, 200) });
  return getProperty(propertyId);
}

export async function markCalled(propertyId: string) {
  const db = await ready();
  const [property] = await db.select().from(properties).where(and(eq(properties.workspaceId, ws()), eq(properties.id, propertyId))).limit(1);
  if (!property) return null;
  await db.insert(timelineEvents).values({
    workspaceId: ws(),
    propertyId,
    type: "call",
    title: "Call logged",
    detail: `Marked called from the property workspace. No outreach was sent automatically.`,
    eventDate: "Now",
  });
  await db.update(properties).set({ lastContact: "Just now", updatedAt: sql`CURRENT_TIMESTAMP` }).where(and(eq(properties.workspaceId, ws()), eq(properties.id, propertyId)));
  await appendAudit(db, { actor: "agent", action: "mark_called", entityType: "property", entityId: propertyId, detail: property.address });
  return getProperty(propertyId);
}

export async function logModelRun(run: ModelRunLog) {
  const db = await ready();
  await db.insert(modelRuns).values({
    workspaceId: ws(),
    agent: run.agent,
    provider: run.provider,
    model: run.model,
    latencyMs: run.latencyMs,
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
    costUsd: run.estimatedCostUsd,
    fallbackCount: run.fallbackCount ?? 0,
    summary: run.summary ?? "",
  });
}

export async function listModelRuns(limit = 12) {
  const db = await ready();
  return db.select().from(modelRuns).where(eq(modelRuns.workspaceId, ws())).orderBy(desc(modelRuns.id)).limit(limit);
}

export async function listAuditLog(limit = 20) {
  const db = await ready();
  return db.select().from(auditLog).where(eq(auditLog.workspaceId, ws())).orderBy(desc(auditLog.id)).limit(limit);
}

export async function getContactPermission(propertyId: string) {
  const db = await ready();
  const [row] = await db.select().from(contactPermissions).where(and(eq(contactPermissions.workspaceId, ws()), eq(contactPermissions.propertyId, propertyId))).limit(1);
  return row ?? null;
}

export type PermissionMap = Record<
  string,
  { doNotContact: boolean; phoneAllowed: boolean; emailAllowed: boolean; mailAllowed: boolean; textAllowed: boolean }
>;

export async function getPermissionsMap(): Promise<PermissionMap> {
  const db = await ready();
  const rows = await db.select().from(contactPermissions).where(eq(contactPermissions.workspaceId, ws()));
  const map: PermissionMap = {};
  for (const row of rows) {
    map[row.propertyId] = {
      doNotContact: row.doNotContact,
      phoneAllowed: row.phoneAllowed,
      emailAllowed: row.emailAllowed,
      mailAllowed: row.mailAllowed,
      textAllowed: row.textAllowed,
    };
  }
  return map;
}

export async function createApproval(input: {
  propertyId: string | null;
  kind: string;
  channel: string;
  draft: string;
  complianceWarnings: string[];
}) {
  const db = await ready();
  const id = newId("approval");
  await db.insert(approvals).values({
    id,
    workspaceId: ws(),
    propertyId: input.propertyId,
    kind: input.kind,
    channel: input.channel,
    draft: input.draft,
    complianceWarnings: JSON.stringify(input.complianceWarnings),
    status: "pending",
  });
  await appendAudit(db, { actor: "agent", action: "draft_outreach", entityType: "approval", entityId: id, detail: `${input.channel} draft prepared and held for approval.` });
  return id;
}

export async function listApprovals(status?: string) {
  const db = await ready();
  const condition = status ? and(eq(approvals.workspaceId, ws()), eq(approvals.status, status)) : eq(approvals.workspaceId, ws());
  const rows = await db.select().from(approvals).where(condition).orderBy(desc(approvals.createdAt));
  return rows.map((row) => ({ ...row, complianceWarnings: safeParse(row.complianceWarnings) }));
}

export async function decideApproval(id: string, decision: "approved" | "rejected") {
  const db = await ready();
  const [approval] = await db.select().from(approvals).where(and(eq(approvals.workspaceId, ws()), eq(approvals.id, id))).limit(1);
  if (!approval) return null;
  await db.update(approvals).set({ status: decision, decidedAt: sql`CURRENT_TIMESTAMP` }).where(and(eq(approvals.workspaceId, ws()), eq(approvals.id, id)));
  await appendAudit(db, {
    actor: "user",
    action: decision === "approved" ? "approve_outreach" : "reject_outreach",
    entityType: "approval",
    entityId: id,
    detail: `${approval.channel} draft ${decision}. Sending still requires a person to act.`,
  });
  if (decision === "approved" && approval.propertyId) {
    await db.insert(timelineEvents).values({
      workspaceId: ws(),
      propertyId: approval.propertyId,
      type: "task",
      title: "Outreach approved",
      detail: `Approved ${approval.channel} draft. Ready for a person to send.`,
      eventDate: "Now",
    });
  }
  return { ...approval, status: decision };
}

export async function getApproval(id: string) {
  const db = await ready();
  const [row] = await db.select().from(approvals).where(and(eq(approvals.workspaceId, ws()), eq(approvals.id, id))).limit(1);
  return row ?? null;
}

// Records the outcome of an actual send attempt against an approved draft.
export async function recordApprovalDelivery(
  id: string,
  result: { recipient: string; status: string; providerMessageId?: string; error?: string; channel: string; propertyId: string | null },
) {
  const db = await ready();
  await db
    .update(approvals)
    .set({
      recipient: result.recipient,
      deliveryStatus: result.status,
      deliveredAt: result.status === "sent" ? sql`CURRENT_TIMESTAMP` : null,
      providerMessageId: result.providerMessageId ?? null,
      deliveryError: result.error ?? null,
    })
    .where(and(eq(approvals.workspaceId, ws()), eq(approvals.id, id)));

  if (result.propertyId) {
    await db.insert(timelineEvents).values({
      workspaceId: ws(),
      propertyId: result.propertyId,
      type: "call",
      title: result.status === "sent" ? `${result.channel} sent` : `${result.channel} delivery ${result.status}`,
      detail: result.status === "sent"
        ? `Approved ${result.channel} delivered to ${result.recipient}.`
        : `Delivery ${result.status}${result.error ? `: ${result.error}` : ""}.`,
      eventDate: new Date().toISOString().slice(0, 10),
    });
  }

  await appendAudit(db, {
    actor: "user",
    action: result.status === "sent" ? "send_outreach" : "outreach_delivery_failed",
    entityType: "approval",
    entityId: id,
    detail: `${result.channel} → ${result.recipient} (${result.status})`,
  });
  return getApproval(id);
}

function shortSignalLabel(publicSignal: PropertyContext["publicSignals"][number], yearBuilt?: number | null): string {
  const desc = publicSignal.description;
  switch (publicSignal.type) {
    case "building_age":
      return yearBuilt ? `Built ${yearBuilt}` : "Building age on record";
    case "violation":
      return "HPD violation";
    case "permit":
      return "DOB permit";
    case "absentee_owner":
      return /out-of-state/i.test(desc) ? "Out-of-state owner" : "Absentee owner";
    case "recorded_document":
      if (/satisfaction/i.test(desc)) return "Mortgage satisfied";
      if (/mortgage/i.test(desc)) return "Recorded mortgage";
      if (/deed/i.test(desc)) return "Recorded deed";
      if (/transfer/i.test(desc)) return "Property transfer";
      return "Recorded document";
    default:
      return desc.slice(0, 40);
  }
}

function formatUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${value}`;
}

export async function enrichProperty(propertyId: string, context: PropertyContext) {
  const db = await ready();
  const workspaceId = ws();
  const [property] = await db.select().from(properties).where(and(eq(properties.workspaceId, workspaceId), eq(properties.id, propertyId))).limit(1);
  if (!property) return null;

  const assessed = context.facts.assessedValue;
  await db
    .update(properties)
    .set({
      bbl: context.bbl ?? property.bbl,
      bin: context.bin ?? property.bin,
      latitude: context.coordinates?.latitude ?? property.latitude,
      longitude: context.coordinates?.longitude ?? property.longitude,
      assessedValue: assessed ?? property.assessedValue,
      yearBuilt: context.facts.yearBuilt ?? property.yearBuilt,
      ownerMailingAddress: context.facts.ownerMailingAddress ?? property.ownerMailingAddress,
      equity: assessed ? formatUsd(assessed) : property.equity,
      enriched: true,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(and(eq(properties.workspaceId, workspaceId), eq(properties.id, propertyId)));

  await db.delete(signals).where(and(eq(signals.workspaceId, workspaceId), eq(signals.propertyId, propertyId), eq(signals.source, "nyc")));
  const labels = new Set<string>();
  for (const publicSignal of context.publicSignals) {
    const label = shortSignalLabel(publicSignal, context.facts.yearBuilt);
    if (labels.has(label)) continue;
    labels.add(label);
    if (labels.size > 6) break;
    await db.insert(signals).values({ workspaceId, propertyId, type: "public_record", value: label, source: "nyc" });
  }

  await db.delete(documents).where(and(eq(documents.workspaceId, workspaceId), eq(documents.propertyId, propertyId), sql`source IN ('nyc_acris','nyc_dob')`));
  for (const publicSignal of context.publicSignals) {
    if (publicSignal.type !== "recorded_document" && publicSignal.type !== "permit") continue;
    const amountMatch = publicSignal.description.match(/\$([\d,]+)/);
    await db.insert(documents).values({
      id: newId("doc"),
      workspaceId,
      propertyId,
      name: publicSignal.description.slice(0, 120),
      docType: publicSignal.type === "permit" ? "permit" : "recorded_document",
      source: publicSignal.type === "permit" ? "nyc_dob" : "nyc_acris",
      reference: publicSignal.source,
      recordedDate: publicSignal.date ?? null,
      amount: amountMatch ? Number(amountMatch[1].replace(/,/g, "")) : null,
    });
  }

  await db.insert(timelineEvents).values({
    workspaceId,
    propertyId,
    type: "signal",
    title: "Enriched from NYC public records",
    detail: `Sources: ${context.sources.map((source) => source.name).join(", ")}. ${context.publicSignals.length} public signals attached.`,
    eventDate: new Date().toISOString().slice(0, 10),
  });
  await appendAudit(db, { actor: "agent", action: "enrich_property", entityType: "property", entityId: propertyId, detail: `${context.address} (BBL ${context.bbl ?? "n/a"})` });
  return getProperty(propertyId);
}

// Turn a prospected public-record parcel into a real lead in the workspace.
// De-duplicates by address so the same parcel is never claimed twice.
export async function createProspectedProperty(candidate: {
  bbl: string;
  address: string;
  ownerName: string;
  yearBuilt: number | null;
  unitsTotal: number | null;
  assessedValue: number | null;
  latitude: number | null;
  longitude: number | null;
  score: number;
  reasons: string[];
}): Promise<{ property: PropertyRecord | null; alreadyExisted: boolean }> {
  const db = await ready();
  const workspaceId = ws();

  const existing = await db
    .select({ id: properties.id })
    .from(properties)
    .where(and(eq(properties.workspaceId, workspaceId), eq(properties.address, candidate.address)))
    .limit(1);
  if (existing.length > 0) {
    return { property: await getProperty(existing[0].id), alreadyExisted: true };
  }

  const signalLabels: string[] = [];
  if (candidate.unitsTotal && candidate.unitsTotal <= 2) signalLabels.push(`${candidate.unitsTotal}-family`);
  if (candidate.yearBuilt) signalLabels.push(`Built ${candidate.yearBuilt}`);
  if (candidate.assessedValue) signalLabels.push(formatUsd(candidate.assessedValue));
  signalLabels.push("Prospected from map");

  const record: PropertyRecord = {
    id: `prospect-${candidate.bbl}`,
    address: candidate.address,
    neighborhood: "Prospected lead",
    ownerName: candidate.ownerName,
    status: "review",
    statusLabel: "New lead",
    score: candidate.score,
    equity: candidate.assessedValue ? formatUsd(candidate.assessedValue) : "Unknown",
    ownershipYears: 0,
    lastContact: "",
    followUpDate: null,
    nextAction: "Research contact information through an authorized source before any outreach.",
    summary: candidate.reasons.join(". ") || "Prospected from public records.",
    signals: signalLabels,
    timeline: [
      {
        date: new Date().toISOString().slice(0, 10),
        title: "Prospected from the map",
        detail: `Added from NYC PLUTO (BBL ${candidate.bbl}). Public records supply property facts only — no phone, email, or contact permission.`,
        type: "signal",
      },
    ],
    mapClass: "parcel-a",
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    bbl: candidate.bbl,
    assessedValue: candidate.assessedValue,
    yearBuilt: candidate.yearBuilt,
  };

  const id = await insertPropertyRecord(db, record, "prospect");
  await appendAudit(db, {
    actor: "user",
    action: "prospect_lead",
    entityType: "property",
    entityId: id,
    detail: `${candidate.address} (BBL ${candidate.bbl}) claimed from the map.`,
  });
  return { property: await getProperty(id), alreadyExisted: false };
}

// Addresses already in the workspace, used to filter prospect candidates.
export async function listPropertyAddresses(): Promise<string[]> {
  const db = await ready();
  const rows = await db.select({ address: properties.address }).from(properties).where(eq(properties.workspaceId, ws()));
  return rows.map((row) => row.address);
}

// --- Owner contacts (phone / email) ---
export async function listContacts(propertyId: string) {
  const db = await ready();
  return db
    .select()
    .from(contacts)
    .where(and(eq(contacts.workspaceId, ws()), eq(contacts.propertyId, propertyId)))
    .orderBy(desc(contacts.createdAt));
}

export async function addContact(input: {
  propertyId: string;
  type: string;
  value: string;
  label?: string;
  source?: string;
}) {
  const db = await ready();
  const workspaceId = ws();

  // Never store the same number twice for a property.
  const existing = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.propertyId, input.propertyId), eq(contacts.value, input.value)))
    .limit(1);
  if (existing.length > 0) {
    const [row] = await db
      .select()
      .from(contacts)
      .where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.id, existing[0].id)))
      .limit(1);
    return row ?? null;
  }

  const id = newId("contact");
  await db.insert(contacts).values({
    id,
    workspaceId,
    propertyId: input.propertyId,
    type: input.type,
    value: input.value,
    label: input.label ?? "",
    source: input.source ?? "manual",
  });
  await appendAudit(db, {
    actor: "user",
    action: "add_contact",
    entityType: "property",
    entityId: input.propertyId,
    // Log the kind and provenance, not the value itself.
    detail: `${input.type} added from ${input.source ?? "manual"}`,
  });
  const [row] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.id, id)))
    .limit(1);
  return row ?? null;
}

export async function deleteContact(id: string) {
  const db = await ready();
  const [row] = await db.select().from(contacts).where(and(eq(contacts.workspaceId, ws()), eq(contacts.id, id))).limit(1);
  if (!row) return null;
  await db.delete(contacts).where(and(eq(contacts.workspaceId, ws()), eq(contacts.id, id)));
  await appendAudit(db, {
    actor: "user",
    action: "delete_contact",
    entityType: "property",
    entityId: row.propertyId,
    detail: `${row.type} removed`,
  });
  return { id };
}

// --- Workspace-wide do-not-contact (suppression) list --------------------
// A value here is blocked on every property and channel. Values are normalized
// (E.164 / lowercased email) so send-time lookups are exact.

export async function listSuppressions() {
  const db = await ready();
  return db.select().from(suppressions).where(eq(suppressions.workspaceId, ws())).orderBy(desc(suppressions.createdAt));
}

export async function addSuppression(rawValue: string, reason = "") {
  const normalized = normalizeContact(rawValue);
  if (!normalized) return null; // not a valid phone or email
  const db = await ready();
  const workspaceId = ws();
  const existing = await db
    .select({ id: suppressions.id })
    .from(suppressions)
    .where(and(eq(suppressions.workspaceId, workspaceId), eq(suppressions.value, normalized.value)))
    .limit(1);
  if (existing.length > 0) return { id: existing[0].id, kind: normalized.type, value: normalized.value };
  const id = newId("dnc");
  await db.insert(suppressions).values({ id, workspaceId, kind: normalized.type, value: normalized.value, reason });
  await appendAudit(db, {
    actor: "user",
    action: "add_suppression",
    entityType: "suppression",
    entityId: id,
    detail: `${normalized.type} added to do-not-contact${reason ? ` (${reason})` : ""}`,
  });
  return { id, kind: normalized.type, value: normalized.value };
}

export async function removeSuppression(id: string) {
  const db = await ready();
  const [row] = await db.select().from(suppressions).where(and(eq(suppressions.workspaceId, ws()), eq(suppressions.id, id))).limit(1);
  if (!row) return null;
  await db.delete(suppressions).where(and(eq(suppressions.workspaceId, ws()), eq(suppressions.id, id)));
  return { id };
}

// The internal DNC scrub the send-time gate calls before any email/SMS goes out.
export async function isRecipientSuppressed(rawValue: string): Promise<boolean> {
  const normalized = normalizeContact(rawValue);
  if (!normalized) return false;
  const db = await ready();
  const rows = await db
    .select({ id: suppressions.id })
    .from(suppressions)
    .where(and(eq(suppressions.workspaceId, ws()), eq(suppressions.value, normalized.value)))
    .limit(1);
  return rows.length > 0;
}

// Properties worth paying to skip trace: scored, contactable, and missing contact
// details. Used to build the bulk export so nothing is traced twice.
export async function listSkipTraceTargets(minScore: number) {
  const db = await ready();
  const workspaceId = ws();
  const rows = await db.select().from(properties).where(eq(properties.workspaceId, workspaceId)).orderBy(desc(properties.score));
  const permissions = await db.select().from(contactPermissions).where(eq(contactPermissions.workspaceId, workspaceId));
  const blocked = new Set(permissions.filter((row) => row.doNotContact).map((row) => row.propertyId));
  const existing = await db.select({ propertyId: contacts.propertyId }).from(contacts).where(eq(contacts.workspaceId, workspaceId));
  const hasContact = new Set(existing.map((row) => row.propertyId));

  return rows
    .filter((row) => row.score >= minScore && !blocked.has(row.id) && !hasContact.has(row.id))
    .map((row) => ({
      propertyId: row.id,
      address: row.address,
      ownerName: row.ownerName,
      mailingAddress: row.ownerMailingAddress,
    }));
}

export async function findPropertyIdByAddress(address: string): Promise<string | null> {
  const db = await ready();
  const [row] = await db
    .select({ id: properties.id })
    .from(properties)
    .where(and(eq(properties.workspaceId, ws()), eq(properties.address, address)))
    .limit(1);
  return row?.id ?? null;
}

// --- Documents / sales history ---
export async function listDocuments(propertyId: string) {
  const db = await ready();
  return db.select().from(documents).where(and(eq(documents.workspaceId, ws()), eq(documents.propertyId, propertyId))).orderBy(desc(documents.recordedDate), desc(documents.createdAt));
}

export async function addDocument(input: { propertyId: string; name: string; docType?: string; reference?: string; recordedDate?: string | null; amount?: number | null }) {
  const db = await ready();
  const id = newId("doc");
  await db.insert(documents).values({
    id,
    workspaceId: ws(),
    propertyId: input.propertyId,
    name: input.name,
    docType: input.docType ?? "document",
    source: "user",
    reference: input.reference ?? "",
    recordedDate: input.recordedDate ?? null,
    amount: input.amount ?? null,
  });
  await appendAudit(db, { actor: "user", action: "add_document", entityType: "property", entityId: input.propertyId, detail: input.name });
  const [row] = await db.select().from(documents).where(and(eq(documents.workspaceId, ws()), eq(documents.id, id))).limit(1);
  return row ?? null;
}

// --- Offers ---
export async function listOffers(propertyId: string) {
  const db = await ready();
  return db.select().from(offers).where(and(eq(offers.workspaceId, ws()), eq(offers.propertyId, propertyId))).orderBy(desc(offers.createdAt));
}

export async function addOffer(input: { propertyId: string; party: string; amount: number; notes?: string; status?: string }) {
  const db = await ready();
  const id = newId("offer");
  await db.insert(offers).values({ id, workspaceId: ws(), propertyId: input.propertyId, party: input.party, amount: input.amount, status: input.status ?? "presented", notes: input.notes ?? "" });
  await appendAudit(db, { actor: "user", action: "add_offer", entityType: "property", entityId: input.propertyId, detail: `${input.party}: $${input.amount}` });
  const [row] = await db.select().from(offers).where(and(eq(offers.workspaceId, ws()), eq(offers.id, id))).limit(1);
  return row ?? null;
}

export async function updateOfferStatus(id: string, status: string) {
  const db = await ready();
  await db.update(offers).set({ status, updatedAt: sql`CURRENT_TIMESTAMP` }).where(and(eq(offers.workspaceId, ws()), eq(offers.id, id)));
  await appendAudit(db, { actor: "user", action: "update_offer", entityType: "offer", entityId: id, detail: status });
  const [row] = await db.select().from(offers).where(and(eq(offers.workspaceId, ws()), eq(offers.id, id))).limit(1);
  return row ?? null;
}

// --- People / contacts ---
export async function listPeople() {
  const db = await ready();
  const workspaceId = ws();
  const links = await db.select().from(propertyPeople).where(eq(propertyPeople.workspaceId, workspaceId));
  const propsById = new Map((await db.select().from(properties).where(eq(properties.workspaceId, workspaceId))).map((property) => [property.id, property]));
  const peopleRows = await db.select().from(people).where(eq(people.workspaceId, workspaceId)).orderBy(people.name);
  return peopleRows.map((person) => {
    const related = links
      .filter((link) => link.personId === person.id)
      .map((link) => propsById.get(link.propertyId))
      .filter((property): property is NonNullable<typeof property> => Boolean(property));
    return { id: person.id, name: person.name, role: person.role, properties: related.map((property) => ({ id: property.id, address: property.address })) };
  });
}

// --- Saved neighborhoods ---
export async function listSavedNeighborhoods() {
  const db = await ready();
  return db.select().from(savedNeighborhoods).where(eq(savedNeighborhoods.workspaceId, ws())).orderBy(desc(savedNeighborhoods.createdAt));
}

export async function addSavedNeighborhood(input: { name: string; search?: string; statusFilter?: string }) {
  const db = await ready();
  const id = newId("view");
  await db.insert(savedNeighborhoods).values({ id, workspaceId: ws(), name: input.name, search: input.search ?? "", statusFilter: input.statusFilter ?? "all" });
  await appendAudit(db, { actor: "user", action: "save_neighborhood", entityType: "saved_neighborhood", entityId: id, detail: input.name });
  const [row] = await db.select().from(savedNeighborhoods).where(and(eq(savedNeighborhoods.workspaceId, ws()), eq(savedNeighborhoods.id, id))).limit(1);
  return row ?? null;
}

export async function deleteSavedNeighborhood(id: string) {
  const db = await ready();
  await db.delete(savedNeighborhoods).where(and(eq(savedNeighborhoods.workspaceId, ws()), eq(savedNeighborhoods.id, id)));
  await appendAudit(db, { actor: "user", action: "delete_saved_neighborhood", entityType: "saved_neighborhood", entityId: id, detail: "" });
  return { id };
}

export async function setPropertyPermission(
  propertyId: string,
  patch: Partial<{ doNotContact: boolean; phoneAllowed: boolean; emailAllowed: boolean; mailAllowed: boolean; textAllowed: boolean }>,
) {
  const db = await ready();
  await db
    .insert(contactPermissions)
    .values({ propertyId, workspaceId: ws(), textAllowed: false, ...patch })
    .onConflictDoUpdate({ target: contactPermissions.propertyId, set: { ...patch, updatedAt: sql`CURRENT_TIMESTAMP` } });
  await appendAudit(db, {
    actor: "user",
    action: "update_contact_permission",
    entityType: "property",
    entityId: propertyId,
    detail: Object.entries(patch).map(([key, value]) => `${key}=${value}`).join(", "),
  });
  return getContactPermission(propertyId);
}

export async function createTask(input: {
  id?: string;
  propertyId?: string | null;
  title: string;
  address?: string;
  due?: string;
  time?: string;
  priority?: "high" | "medium" | "low";
}) {
  const db = await ready();
  const id = input.id ?? newId("task");
  await db
    .insert(tasks)
    .values({
      id,
      workspaceId: ws(),
      propertyId: input.propertyId ?? null,
      title: input.title,
      address: input.address ?? "",
      due: input.due ?? "Today",
      time: input.time ?? "",
      priority: input.priority ?? "medium",
    })
    .onConflictDoNothing();
  await appendAudit(db, { actor: "user", action: "create_task", entityType: "task", entityId: id, detail: input.title });
  const [task] = await db.select().from(tasks).where(and(eq(tasks.workspaceId, ws()), eq(tasks.id, id))).limit(1);
  return task ?? null;
}

async function setContactPermission(db: Db, propertyId: string, doNotContact: boolean) {
  await db
    .insert(contactPermissions)
    .values({ propertyId, workspaceId: ws(), doNotContact, textAllowed: false })
    .onConflictDoUpdate({ target: contactPermissions.propertyId, set: { doNotContact, updatedAt: sql`CURRENT_TIMESTAMP` } });
}

export type ListingBoard = "rebny_rls" | "trreb";

export async function getListingConnection() {
  const db = await ready();
  const workspaceId = ws();
  const [row] = await db
    .select()
    .from(listingConnections)
    .where(eq(listingConnections.workspaceId, workspaceId))
    .limit(1);
  return row ?? null;
}

export async function setListingConnection(input: {
  board: ListingBoard;
  memberConfirmed: boolean;
  agreementConfirmed: boolean;
}) {
  const db = await ready();
  const workspaceId = ws();
  await db
    .insert(listingConnections)
    .values({ workspaceId, ...input })
    .onConflictDoUpdate({
      target: listingConnections.workspaceId,
      set: { ...input, updatedAt: sql`CURRENT_TIMESTAMP` },
    });
  await appendAudit(db, {
    actor: "user",
    action: "configure_listing_connection",
    entityType: "listing_connection",
    entityId: workspaceId,
    detail: `${input.board}; member=${input.memberConfirmed}; agreement=${input.agreementConfirmed}`,
  });
  return getListingConnection();
}

export async function deleteListingConnection() {
  const db = await ready();
  const workspaceId = ws();
  await db.delete(listingConnections).where(eq(listingConnections.workspaceId, workspaceId));
  await appendAudit(db, {
    actor: "user",
    action: "disconnect_listing_board",
    entityType: "listing_connection",
    entityId: workspaceId,
    detail: "",
  });
  return { disconnected: true };
}

// Persist newly imported/analyzed leads as real property workspaces (scoped to the
// caller's workspace) and generate their follow-up tasks.
export async function upsertImportedProperties(records: ImportedPropertyRecord[]) {
  const db = await ready();
  const workspaceId = ws();
  for (const record of records) {
    const existing = await db
      .select({ id: properties.id })
      .from(properties)
      .where(and(eq(properties.workspaceId, workspaceId), eq(properties.address, record.address)))
      .limit(1);

    let storedId: string;
    if (existing.length > 0) {
      storedId = existing[0].id;
      await db
        .update(properties)
        .set({
          ownerName: record.ownerName,
          status: record.status,
          statusLabel: record.statusLabel,
          score: record.score,
          followUpDate: record.followUpDate,
          nextAction: record.nextAction,
          summary: record.summary,
          lastContact: record.lastContact || sql`last_contact`,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(and(eq(properties.workspaceId, workspaceId), eq(properties.id, storedId)));
      await db.delete(signals).where(and(eq(signals.workspaceId, workspaceId), eq(signals.propertyId, storedId), eq(signals.source, "import")));
      for (const signal of record.signals) {
        await db.insert(signals).values({ workspaceId, propertyId: storedId, type: "label", value: signal, source: "import" });
      }
      await setContactPermission(db, storedId, record.doNotContact);
      await appendAudit(db, { actor: "agent", action: "update_imported_property", entityType: "property", entityId: storedId, detail: record.address });
    } else {
      storedId = await insertPropertyRecord(db, record, "import", record.doNotContact);
      await appendAudit(db, { actor: "agent", action: "create_imported_property", entityType: "property", entityId: storedId, detail: record.address });
    }

    // Follow-up date -> a de-duplicated task (id derived from the workspace-scoped property id).
    if (record.followUpDate && !record.doNotContact) {
      await createTask({
        id: `task-followup-${storedId}`,
        propertyId: storedId,
        title: `Follow up with ${record.ownerName}`,
        address: record.address,
        due: record.followUpDate,
        priority: record.status === "urgent" ? "high" : "medium",
      });
    }
  }
}

function safeParse(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
