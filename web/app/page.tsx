"use client";

import { ChangeEvent, CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BriefingResult } from "../lib/briefing";
import type { TaskRecord, PropertyRecord, PropertyStatus } from "../lib/property-model";
import { computeNeighborhoodStats, projectCoordinates } from "../lib/insights";
import { explainScore } from "../lib/scoring";
import PropertyMap from "./PropertyMap";
import { formatPhone } from "../lib/contacts/contact-model";
import { isLegacySpreadsheetFile, isSpreadsheetFile, rowsToCsv, xlsxToRows } from "../lib/xlsx";

type AppView = "briefing" | "properties" | "map" | "tasks" | "approvals" | "contacts" | "settings" | "workspace";

type PersonRecord = { id: string; name: string; role: string; properties: Array<{ id: string; address: string }> };
type OfferRecord = { id: string; propertyId: string; party: string; amount: number; status: string; notes: string; createdAt: string };
type DocumentRecord = { id: string; propertyId: string; name: string; docType: string; source: string; reference: string; recordedDate: string | null; amount: number | null };
type SavedView = { id: string; name: string; search: string; statusFilter: string };
type MeUser = { displayName: string; email: string } | null;
type AppConfig = {
  propertyDataProvider: string;
  anthropicModel: string;
  anthropicFallbackModel: string;
  opusFallbackEnabled: boolean;
  anthropicKeyConfigured: boolean;
  scoringVersion: string;
  appName: string;
  delivery?: { email: boolean; text: boolean; call: boolean; direct_mail: boolean };
  contactProvider?: { name: string; configured: boolean };
};

type OrchestratorRecommendation = {
  propertyId: string;
  address: string;
  ownerName: string;
  reason: string;
  action: string;
  priority: "high" | "medium" | "low";
};

type OrchestratorDraft = {
  propertyId: string;
  address: string;
  channel: string;
  allowed: boolean;
  message: string;
  complianceWarnings: string[];
};

type OrchestratorResponse = {
  intent: string;
  reply: string;
  recommendations: OrchestratorRecommendation[];
  drafts: OrchestratorDraft[];
  approvalIds: string[];
};

type Approval = {
  id: string;
  propertyId: string | null;
  channel: string;
  draft: string;
  status: "pending" | "approved" | "rejected";
  complianceWarnings: string[];
  createdAt: string;
  decidedAt: string | null;
  recipient?: string | null;
  deliveryStatus?: string | null;
  deliveredAt?: string | null;
  deliveryError?: string | null;
};

type ContactRecord = { id: string; propertyId: string; type: string; value: string; label: string; source: string };

type ProspectCandidate = {
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
  source: string;
};

type ProspectResult = {
  radius: number;
  found: number;
  candidates: ProspectCandidate[];
  note: string;
  point: { lat: number; lng: number };
};

type AuditEntry = {
  id: number;
  actor: string;
  action: string;
  detail: string;
  createdAt: string;
};

type PropertyPermission = {
  doNotContact: boolean;
  phoneAllowed: boolean;
  emailAllowed: boolean;
  mailAllowed: boolean;
  textAllowed: boolean;
};

type LookupSignal = { type: string; evidence: string; source: string; confidence: string };

type LookupResult = {
  provider: string;
  context: {
    address: string;
    bbl: string | null;
    bin: string | null;
    provenance: string;
    facts: Record<string, string | number | undefined>;
    sources: Array<{ name: string; retrievedAt: string }>;
  };
  report: {
    signals: LookupSignal[];
    recommendedPriority: string;
    missingInformation: string[];
  };
};

type DisplayPriority = {
  rank: number;
  address: string;
  ownerName: string;
  headline: string;
  recommendedAction: string;
  confidence: "high" | "medium" | "low";
  score: number;
  statusLabel: string;
};

const navItems: Array<{ id: Exclude<AppView, "workspace">; number: string; label: string; hint: string }> = [
  { id: "briefing", number: "01", label: "Today", hint: "Who to call" },
  { id: "properties", number: "02", label: "Properties", hint: "Your homes" },
  { id: "map", number: "03", label: "Map", hint: "Find new leads" },
  { id: "tasks", number: "04", label: "To-do", hint: "Your reminders" },
  { id: "approvals", number: "05", label: "Messages", hint: "Ready to send" },
  { id: "contacts", number: "06", label: "People", hint: "Owners" },
  { id: "settings", number: "07", label: "Settings", hint: "Setup" },
];

// Each section is a card in the horizontal deck. Photos are optional: drop files
// into web/public/cards/ and they appear; without them the card keeps its tint.
const cardArt: Record<string, { image: string; blurb: string }> = {
  briefing: { image: "/cards/today.jpg", blurb: "Who to call first, ranked by real evidence." },
  properties: { image: "/cards/properties.jpg", blurb: "Every home you track, organized by address." },
  map: { image: "/cards/map.jpg", blurb: "Click any block to find new owners nearby." },
  tasks: { image: "/cards/todo.jpg", blurb: "Your reminders and follow-ups for the week." },
  approvals: { image: "/cards/messages.jpg", blurb: "Drafted outreach waiting for your OK." },
  contacts: { image: "/cards/people.jpg", blurb: "The owners behind every address." },
  settings: { image: "/cards/settings.jpg", blurb: "Data sources, delivery, and controls." },
};

const offerStatuses = ["presented", "accepted", "rejected", "withdrawn"] as const;

const statusFilters: Array<{ value: "all" | PropertyStatus; label: string }> = [
  { value: "all", label: "All properties" },
  { value: "urgent", label: "Call today" },
  { value: "inherited", label: "Inherited" },
  { value: "violation", label: "Violations" },
  { value: "absentee", label: "Absentee" },
  { value: "review", label: "Needs review" },
];

function providerName(briefing: BriefingResult) {
  if (briefing.metrics.provider === "local_fallback") return "Local extraction fallback";
  if (briefing.metrics.model.includes("haiku-4-5")) return "Claude Haiku 4.5";
  return briefing.metrics.model;
}

function scoreTone(score: number) {
  if (score >= 90) return "urgent";
  if (score >= 75) return "warm";
  return "review";
}

function channelLabel(channel: string) {
  return channel.replace("_", " ");
}

function TaskRow({ task, onToggle }: { task: TaskRecord; onToggle: (id: string) => void }) {
  return (
    <div className={`task-row ${task.completed ? "completed" : ""}`}>
      <button
        className="task-check"
        type="button"
        aria-label={`${task.completed ? "Reopen" : "Complete"} ${task.title}`}
        aria-pressed={task.completed}
        onClick={() => onToggle(task.id)}
      >
        {task.completed ? "✓" : ""}
      </button>
      <div className="task-copy">
        <strong>{task.title}</strong>
        <span>{task.address}</span>
      </div>
      <span className={`task-priority ${task.priority}`}>{task.priority}</span>
      <div className="task-time">
        <strong>{task.due}</strong>
        <span>{task.time}</span>
      </div>
      <a
        className="calendar-link"
        href={`/api/calendar?taskId=${encodeURIComponent(task.id)}`}
        title="Add this follow-up to your calendar"
        aria-label={`Add ${task.title} to calendar`}
      >
        📅
      </a>
    </div>
  );
}

export default function Home() {
  const [view, setView] = useState<AppView>("briefing");
  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<"all" | PropertyStatus>("all");
  const [search, setSearch] = useState("");
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [todayLabel, setTodayLabel] = useState("");
  const [clock, setClock] = useState("");
  const [noteInput, setNoteInput] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState("");
  const [briefing, setBriefing] = useState<BriefingResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [audioState, setAudioState] = useState<"idle" | "playing" | "paused">("idle");
  const [speechSupported, setSpeechSupported] = useState(false);
  const [command, setCommand] = useState("");
  const [thinking, setThinking] = useState(false);
  const [orchestration, setOrchestration] = useState<OrchestratorResponse | null>(null);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [lookupAddress, setLookupAddress] = useState("");
  const [lookupResult, setLookupResult] = useState<LookupResult | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [permission, setPermission] = useState<PropertyPermission | null>(null);
  const [enriching, setEnriching] = useState(false);
  const [taskTitle, setTaskTitle] = useState("");
  const [me, setMe] = useState<MeUser>(null);
  const [workspaceName, setWorkspaceName] = useState("");
  const [needsLogin, setNeedsLogin] = useState(false);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [people, setPeople] = useState<PersonRecord[]>([]);
  const [offers, setOffers] = useState<OfferRecord[]>([]);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  const [skipTraceScore, setSkipTraceScore] = useState(70);
  const [importCsv, setImportCsv] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState("");
  const [contactInput, setContactInput] = useState("");
  const [lookingUp, setLookingUp] = useState(false);
  const [offerParty, setOfferParty] = useState("");
  const [offerAmount, setOfferAmount] = useState("");
  const [docName, setDocName] = useState("");
  const [prospect, setProspect] = useState<ProspectResult | null>(null);
  const [prospecting, setProspecting] = useState(false);
  const [claiming, setClaiming] = useState("");
  const [nextLead, setNextLead] = useState<{ property: PropertyRecord; reason: string } | null>(null);
  const [recipients, setRecipients] = useState<Record<string, string>>({});
  const [sending, setSending] = useState("");
  const [notificationsOn, setNotificationsOn] = useState(false);
  const notifiedRef = useRef<Set<string>>(new Set());
  const [notifOpen, setNotifOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [listening, setListening] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const deckFlipAt = useRef(0);

  const selectedProperty = useMemo<PropertyRecord | undefined>(
    () => properties.find((property) => property.id === selectedId) ?? properties[0],
    [properties, selectedId],
  );

  const neighborhood = useMemo(() => computeNeighborhoodStats(properties), [properties]);
  const placedProperties = useMemo(() => projectCoordinates(properties.slice(0, 20), 100, 100, 8), [properties]);

  const refreshProperties = useCallback(async () => {
    try {
      const response = await fetch("/api/properties");
      const data = (await response.json()) as { properties?: PropertyRecord[] };
      if (Array.isArray(data.properties)) setProperties(data.properties);
    } catch {
      // Leave whatever is loaded if the API is unreachable.
    }
  }, []);

  const refreshTasks = useCallback(async () => {
    try {
      const response = await fetch("/api/tasks");
      const data = (await response.json()) as { tasks?: TaskRecord[] };
      if (Array.isArray(data.tasks)) setTasks(data.tasks);
    } catch {
      // Leave whatever is loaded if the API is unreachable.
    }
  }, []);

  const refreshApprovals = useCallback(async () => {
    try {
      const response = await fetch("/api/approvals");
      const data = (await response.json()) as { approvals?: Approval[] };
      if (Array.isArray(data.approvals)) setApprovals(data.approvals);
    } catch {
      // Ignore.
    }
  }, []);

  const refreshTrace = useCallback(async () => {
    try {
      const response = await fetch("/api/trace");
      const data = (await response.json()) as { auditLog?: AuditEntry[] };
      if (Array.isArray(data.auditLog)) setAuditLog(data.auditLog);
    } catch {
      // Ignore.
    }
  }, []);

  const refreshPeople = useCallback(async () => {
    try {
      const data = (await (await fetch("/api/people")).json()) as { people?: PersonRecord[] };
      if (Array.isArray(data.people)) setPeople(data.people);
    } catch {
      // Ignore.
    }
  }, []);

  const refreshSavedViews = useCallback(async () => {
    try {
      const data = (await (await fetch("/api/saved-views")).json()) as { views?: SavedView[] };
      if (Array.isArray(data.views)) setSavedViews(data.views);
    } catch {
      // Ignore.
    }
  }, []);

  const loadIdentityAndConfig = useCallback(async () => {
    try {
      const meData = (await (await fetch("/api/me")).json()) as { user?: MeUser; workspace?: { name: string } | null; needsLogin?: boolean };
      setMe(meData.user ?? null);
      setWorkspaceName(meData.workspace?.name ?? "");
      setNeedsLogin(Boolean(meData.needsLogin));
    } catch {
      // Ignore.
    }
    try {
      const configData = (await (await fetch("/api/config")).json()) as AppConfig;
      if (configData) setConfig(configData);
    } catch {
      // Ignore.
    }
  }, []);

  async function enableNotifications() {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setError("This browser does not support desktop notifications.");
      return;
    }
    const permission = await Notification.requestPermission();
    setNotificationsOn(permission === "granted");
    if (permission !== "granted") {
      setError("Notifications were blocked. You can re-enable them in your browser's site settings.");
    }
  }

  async function logout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.href = "/";
    }
  }

  const displayPriorities = useMemo<DisplayPriority[]>(() => {
    if (!briefing) {
      return properties.slice(0, 3).map((property, index) => ({
        rank: index + 1,
        address: property.address,
        ownerName: property.ownerName,
        headline: property.nextAction,
        recommendedAction: property.nextAction,
        confidence: "high",
        score: property.score,
        statusLabel: property.statusLabel,
      }));
    }
    return briefing.priorities.map((priority) => {
      const property = properties.find((item) => item.address === priority.address);
      return {
        rank: priority.rank,
        address: priority.address,
        ownerName: priority.ownerName,
        headline: priority.headline,
        recommendedAction: priority.recommendedAction,
        confidence: priority.confidence,
        score: property?.score ?? 90 - priority.rank,
        statusLabel: property?.statusLabel ?? "Priority",
      };
    });
  }, [briefing, properties]);

  const filteredProperties = useMemo(() => {
    const query = search.trim().toLowerCase();
    return properties.filter((property) => {
      const matchesFilter = statusFilter === "all" || property.status === statusFilter;
      const matchesSearch = !query || [property.address, property.ownerName, property.neighborhood, ...property.signals]
        .some((value) => value.toLowerCase().includes(query));
      return matchesFilter && matchesSearch;
    });
  }, [properties, search, statusFilter]);

  const pendingApprovals = useMemo(() => approvals.filter((approval) => approval.status === "pending"), [approvals]);

  const scoreExplanation = useMemo(() => (selectedProperty ? explainScore(selectedProperty) : null), [selectedProperty]);

  const weekly = useMemo(() => {
    const now = new Date();
    const todayIso = now.toISOString().slice(0, 10);
    const weekAheadIso = new Date(now.getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
    const dueThisWeek = tasks.filter((task) => !task.completed && /^\d{4}-\d{2}-\d{2}$/.test(task.due) && task.due >= todayIso && task.due <= weekAheadIso).length;
    return {
      total: properties.length,
      enriched: properties.filter((property) => property.enriched).length,
      highPriority: properties.filter((property) => property.score >= 85).length,
      dueThisWeek,
    };
  }, [tasks, properties]);

  const notifications = useMemo(() => {
    const todayIso = new Date().toISOString().slice(0, 10);
    const items: Array<{ id: string; text: string; kind: string; address?: string }> = [];
    tasks
      .filter((task) => !task.completed && (task.due === "Today" || (/^\d{4}-\d{2}-\d{2}$/.test(task.due) && task.due <= todayIso)))
      .slice(0, 5)
      .forEach((task) => items.push({ id: `task-${task.id}`, text: task.title, kind: "Due", address: task.address }));
    if (pendingApprovals.length > 0) items.push({ id: "approvals", text: `${pendingApprovals.length} outreach draft(s) awaiting approval`, kind: "Approve" });
    properties
      .filter((property) => property.score >= 88 && !property.enriched)
      .slice(0, 3)
      .forEach((property) => items.push({ id: `enrich-${property.id}`, text: `${property.address} is high-priority but not enriched`, kind: "Enrich", address: property.address }));
    return items;
  }, [tasks, pendingApprovals, properties]);

  const paletteResults = useMemo(() => {
    const query = paletteQuery.trim().toLowerCase();
    if (!query) return properties.slice(0, 6);
    return properties
      .filter((property) => [property.address, property.ownerName, property.neighborhood, ...property.signals].some((value) => value.toLowerCase().includes(query)))
      .slice(0, 8);
  }, [paletteQuery, properties]);

  // Desktop notifications for anything due. Uses the browser's own Notification
  // API — no paid push service. Each item fires at most once per session.
  useEffect(() => {
    if (!notificationsOn || typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    let fired = 0;
    for (const item of notifications) {
      if (item.kind !== "Due" && item.kind !== "Approve") continue;
      if (notifiedRef.current.has(item.id) || fired >= 3) continue;
      notifiedRef.current.add(item.id);
      fired += 1;
      new Notification(`Property OS · ${item.kind === "Due" ? "Follow-up due" : "Needs approval"}`, {
        body: item.text,
        tag: item.id,
      });
    }
  }, [notifications, notificationsOn]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((value) => !value);
      }
      if (event.key === "Escape") {
        setPaletteOpen(false);
        setNotifOpen(false);
        setExpanded(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const audioScript = useMemo(() => {
    const name = me ? ` ${me.displayName.split(" ")[0]}` : "";
    const intro = displayPriorities.length > 0
      ? `Good morning${name}. Property OS has ${displayPriorities.length} priority properties for you today.`
      : `Good morning${name}. You have no properties yet. Import your leads to build a priority queue.`;
    const propertyLines = displayPriorities.map((priority) =>
      `Priority ${priority.rank}. ${priority.address}, owner ${priority.ownerName}. ${priority.headline}`,
    );
    return [intro, ...propertyLines, "No outreach has been sent."].join(" ");
  }, [displayPriorities, me]);

  useEffect(() => {
    const readClock = () => setClock(new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }));
    const supportCheck = window.setTimeout(() => {
      setSpeechSupported("speechSynthesis" in window);
      setTodayLabel(new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }));
      setNotificationsOn("Notification" in window && Notification.permission === "granted");
      readClock();
    }, 0);
    const clockTimer = window.setInterval(readClock, 30_000);
    void (async () => {
      await Promise.allSettled([
        refreshProperties(),
        refreshTasks(),
        refreshApprovals(),
        refreshTrace(),
        refreshPeople(),
        refreshSavedViews(),
        loadIdentityAndConfig(),
      ]);
    })();
    return () => {
      window.clearTimeout(supportCheck);
      window.clearInterval(clockTimer);
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, [refreshProperties, refreshTasks, refreshApprovals, refreshTrace, refreshPeople, refreshSavedViews, loadIdentityAndConfig]);

  function navigate(nextView: Exclude<AppView, "workspace">) {
    stopAudio();
    setView(nextView);
  }

  // --- Horizontal card deck -------------------------------------------------
  // A property workspace is opened from the Properties card, so it shares its slot.
  const deckIndex = Math.max(
    0,
    navItems.findIndex((item) => item.id === view || (view === "workspace" && item.id === "properties")),
  );
  const activeCard = navItems[deckIndex];

  function goToCard(offset: number) {
    const next = navItems[deckIndex + offset];
    if (next) navigate(next.id);
  }

  // The live number each card carries, so a card states something true at a glance.
  function cardMeta(id: string): string {
    if (id === "briefing") return `${displayPriorities.length} to call today`;
    if (id === "properties") return `${properties.length} tracked`;
    if (id === "map") return `${placedProperties.length} located`;
    if (id === "tasks") return `${remainingTasks} open`;
    if (id === "approvals") return `${pendingApprovals.length} waiting for you`;
    if (id === "contacts") return `${people.length} owners`;
    return workspaceName || "Your workspace";
  }

  // Scrolling moves sideways through the deck. The active card still scrolls
  // vertically first — only once it reaches an edge does the wheel flip cards.
  function onDeckWheel(event: React.WheelEvent<HTMLDivElement>) {
    const vertical = event.deltaY;
    const horizontal = event.deltaX;
    const step = Math.abs(horizontal) > Math.abs(vertical) ? horizontal : vertical;
    if (step === 0) return;

    const body = event.currentTarget.querySelector<HTMLElement>(".deck-card.is-active .deck-body");
    if (body && Math.abs(vertical) >= Math.abs(horizontal)) {
      const atTop = body.scrollTop <= 0;
      const atBottom = body.scrollTop + body.clientHeight >= body.scrollHeight - 1;
      if ((step < 0 && !atTop) || (step > 0 && !atBottom)) return;
    }

    const now = Date.now();
    if (now - deckFlipAt.current < 550) return; // one card per gesture
    deckFlipAt.current = now;
    goToCard(step > 0 ? 1 : -1);
  }

  const refreshOffersAndDocs = useCallback(async (propertyId: string) => {
    try {
      const [offerData, docData, contactData] = await Promise.all([
        (await fetch(`/api/offers?propertyId=${encodeURIComponent(propertyId)}`)).json() as Promise<{ offers?: OfferRecord[] }>,
        (await fetch(`/api/documents?propertyId=${encodeURIComponent(propertyId)}`)).json() as Promise<{ documents?: DocumentRecord[] }>,
        (await fetch(`/api/contacts?propertyId=${encodeURIComponent(propertyId)}`)).json() as Promise<{ contacts?: ContactRecord[] }>,
      ]);
      setOffers(Array.isArray(offerData.offers) ? offerData.offers : []);
      setDocuments(Array.isArray(docData.documents) ? docData.documents : []);
      setContacts(Array.isArray(contactData.contacts) ? contactData.contacts : []);
    } catch {
      setOffers([]);
      setDocuments([]);
      setContacts([]);
    }
  }, []);

  async function openProperty(property: PropertyRecord | undefined) {
    if (!property) return;
    setSelectedId(property.id);
    setView("workspace");
    setPermission(null);
    setOffers([]);
    setDocuments([]);
    setPaletteOpen(false);
    try {
      const response = await fetch(`/api/properties?id=${encodeURIComponent(property.id)}`);
      const data = (await response.json()) as { property?: PropertyRecord; permission?: PropertyPermission };
      if (data.property) setProperties((current) => current.map((item) => item.id === data.property!.id ? data.property! : item));
      if (data.permission) setPermission(data.permission);
    } catch {
      // Keep the property already in state.
    }
    await refreshOffersAndDocs(property.id);
  }

  async function addContact() {
    const value = contactInput.trim();
    if (!value || !selectedProperty) return;
    setError("");
    try {
      const response = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId: selectedProperty.id, value }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not save the contact.");
      setContactInput("");
      await Promise.all([refreshOffersAndDocs(selectedProperty.id), refreshTrace()]);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Could not save the contact.");
    }
  }

  async function removeContact(id: string) {
    if (!selectedProperty) return;
    try {
      await fetch(`/api/contacts?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      await refreshOffersAndDocs(selectedProperty.id);
    } catch {
      setError("Could not remove the contact.");
    }
  }

  async function lookupContact() {
    if (!selectedProperty) return;
    setLookingUp(true);
    setError("");
    try {
      const response = await fetch("/api/contacts/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId: selectedProperty.id }),
      });
      const data = (await response.json()) as { status?: string; detail?: string };
      if (data.status !== "found") setError(data.detail ?? "No contact details were found.");
      await refreshOffersAndDocs(selectedProperty.id);
    } catch {
      setError("The contact lookup failed.");
    } finally {
      setLookingUp(false);
    }
  }

  async function importSkipTrace() {
    setImporting(true);
    setImportResult("");
    setError("");
    try {
      const response = await fetch("/api/contacts/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csvText: importCsv }),
      });
      const data = (await response.json()) as { contactsImported?: number; matchedProperties?: number; unmatched?: string[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Import failed.");
      setImportResult(
        `Imported ${data.contactsImported ?? 0} contact(s) across ${data.matchedProperties ?? 0} propert${data.matchedProperties === 1 ? "y" : "ies"}.` +
          (data.unmatched?.length ? ` ${data.unmatched.length} row(s) did not match a property.` : ""),
      );
      setImportCsv("");
      await Promise.all([refreshProperties(), refreshTrace()]);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  }

  async function addOffer() {
    const amount = Number(offerAmount.replace(/[^0-9.]/g, ""));
    if (!offerParty.trim() || !Number.isFinite(amount) || amount <= 0) return;
    try {
      await fetch("/api/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId: selectedProperty.id, party: offerParty.trim(), amount }),
      });
      setOfferParty("");
      setOfferAmount("");
      await Promise.all([refreshOffersAndDocs(selectedProperty.id), refreshTrace()]);
    } catch {
      setError("The offer could not be saved.");
    }
  }

  async function setOfferStatus(id: string, status: string) {
    try {
      await fetch("/api/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      await refreshOffersAndDocs(selectedProperty.id);
    } catch {
      setError("The offer could not be updated.");
    }
  }

  async function addDocument() {
    const name = docName.trim();
    if (!name) return;
    setDocName("");
    try {
      await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId: selectedProperty.id, name }),
      });
      await Promise.all([refreshOffersAndDocs(selectedProperty.id), refreshTrace()]);
    } catch {
      setError("The document could not be added.");
    }
  }

  async function saveCurrentView() {
    const name = search.trim() || (statusFilter === "all" ? "All properties" : statusFilter);
    try {
      await fetch("/api/saved-views", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, search, statusFilter }),
      });
      await refreshSavedViews();
    } catch {
      setError("The view could not be saved.");
    }
  }

  function applySavedView(viewItem: SavedView) {
    setSearch(viewItem.search);
    setStatusFilter(viewItem.statusFilter as "all" | PropertyStatus);
    setView("properties");
  }

  async function deleteSavedView(id: string) {
    try {
      await fetch(`/api/saved-views?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      await refreshSavedViews();
    } catch {
      // Ignore.
    }
  }

  function startVoice() {
    const SpeechRecognition = (window as unknown as { SpeechRecognition?: new () => never; webkitSpeechRecognition?: new () => never }).SpeechRecognition
      ?? (window as unknown as { webkitSpeechRecognition?: new () => never }).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError("Voice input is not supported in this browser.");
      return;
    }
    const recognition = new SpeechRecognition() as unknown as {
      lang: string; interimResults: boolean; continuous: boolean;
      onresult: (event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
      onend: () => void; onerror: () => void; start: () => void; stop: () => void;
    };
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results).map((result) => result[0].transcript).join(" ");
      setCommand(transcript);
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }

  function stopVoice() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  async function enrichSelected() {
    setEnriching(true);
    setError("");
    try {
      const response = await fetch("/api/properties/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId: selectedProperty.id }),
      });
      const data = (await response.json()) as { property?: PropertyRecord; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Enrichment failed.");
      if (data.property) setProperties((current) => current.map((item) => item.id === data.property!.id ? data.property! : item));
      await refreshTrace();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Enrichment failed.");
    } finally {
      setEnriching(false);
    }
  }

  async function togglePermission(key: keyof PropertyPermission) {
    if (!permission) return;
    const patch = { [key]: !permission[key] } as Partial<PropertyPermission>;
    setPermission({ ...permission, ...patch });
    try {
      await fetch("/api/properties/permission", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId: selectedProperty.id, patch }),
      });
      await refreshTrace();
    } catch {
      setError("The permission change could not be saved.");
    }
  }

  async function addTask() {
    const title = taskTitle.trim();
    if (!title) return;
    setTaskTitle("");
    try {
      await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, address: view === "workspace" ? selectedProperty.address : "", propertyId: view === "workspace" ? selectedProperty.id : null }),
      });
      await Promise.all([refreshTasks(), refreshTrace()]);
    } catch {
      setError("The task could not be created.");
    }
  }

  function propertyForAddress(address: string): PropertyRecord | undefined {
    return properties.find((property) => property.address === address);
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    setFileName(file.name);
    try {
      if (isLegacySpreadsheetFile(file.name, file.type)) {
        throw new Error("Legacy .xls files are not supported. In Excel, save the file as .xlsx or CSV and upload it again.");
      } else if (isSpreadsheetFile(file.name, file.type)) {
        // Excel is a zip of XML — convert it to CSV in the browser so it flows
        // through the exact same importer a CSV does.
        const rows = await xlsxToRows(await file.arrayBuffer());
        setCsvText(rowsToCsv(rows));
      } else {
        setCsvText(await file.text());
      }
    } catch (caughtError) {
      setCsvText("");
      setError(caughtError instanceof Error ? caughtError.message : "That file could not be read.");
    }
  }

  async function generate() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/briefing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csvText }),
      });
      const result = (await response.json()) as BriefingResult & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "The briefing could not be generated.");
      setBriefing(result);
      setShowImport(false);
      setView("briefing");
      await Promise.all([refreshProperties(), refreshTrace()]);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "The briefing could not be generated.");
    } finally {
      setLoading(false);
    }
  }

  async function askOrchestrator() {
    const message = command.trim();
    if (!message) return;
    setThinking(true);
    setError("");
    try {
      const response = await fetch("/api/orchestrator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const result = (await response.json()) as OrchestratorResponse & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "The orchestrator could not respond.");
      setOrchestration(result);
      await Promise.all([refreshApprovals(), refreshTrace()]);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "The orchestrator could not respond.");
    } finally {
      setThinking(false);
    }
  }

  async function runLookup(source: "workspace" | "nyc") {
    const address = lookupAddress.trim();
    if (!address) return;
    setLookupLoading(true);
    setLookupError("");
    setLookupResult(null);
    try {
      const response = await fetch(`/api/property/lookup?address=${encodeURIComponent(address)}&source=${source}`);
      const result = (await response.json()) as LookupResult & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "The lookup failed.");
      setLookupResult(result);
      await refreshTrace();
    } catch (caughtError) {
      setLookupError(caughtError instanceof Error ? caughtError.message : "The lookup failed.");
    } finally {
      setLookupLoading(false);
    }
  }

  async function decideApproval(id: string, decision: "approved" | "rejected") {
    const recipient = decision === "approved" ? (recipients[id] ?? "").trim() : "";
    setSending(id);
    setError("");
    try {
      const response = await fetch("/api/approvals/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, decision, recipient: recipient || undefined }),
      });
      const data = (await response.json()) as { delivery?: { status: string; detail: string }; error?: string };
      if (data.delivery && data.delivery.status !== "sent" && data.delivery.status !== "ready" && data.delivery.status !== "none") {
        setError(data.delivery.detail);
      }
      await Promise.all([refreshApprovals(), refreshTrace()]);
    } catch {
      setError("The approval decision could not be recorded.");
    } finally {
      setSending("");
    }
  }

  // Click anywhere on the map to prospect that area for new leads.
  async function prospectArea(latitude: number, longitude: number) {
    setProspecting(true);
    setError("");
    try {
      const response = await fetch("/api/leads/prospect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ latitude, longitude, radius: 250 }),
      });
      const data = (await response.json()) as ProspectResult & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Prospecting failed.");
      setProspect({ ...data, point: { lat: latitude, lng: longitude } });
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Prospecting failed.");
    } finally {
      setProspecting(false);
    }
  }

  async function claimLead(candidate: ProspectCandidate) {
    setClaiming(candidate.bbl);
    try {
      const response = await fetch("/api/leads/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(candidate),
      });
      const data = (await response.json()) as { property?: PropertyRecord; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not add the lead.");
      setProspect((current) =>
        current ? { ...current, candidates: current.candidates.filter((item) => item.bbl !== candidate.bbl) } : current,
      );
      await Promise.all([refreshProperties(), refreshTrace()]);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Could not add the lead.");
    } finally {
      setClaiming("");
    }
  }

  // "I finished that lead — who's next?"
  async function loadNextLead() {
    try {
      const current = view === "workspace" && selectedProperty ? selectedProperty.id : "";
      const response = await fetch(`/api/leads/next?exclude=${encodeURIComponent(current)}`);
      const data = (await response.json()) as { property: PropertyRecord | null; reason: string };
      setNextLead(data.property ? { property: data.property, reason: data.reason } : null);
      if (data.property) {
        await openProperty(data.property);
      } else {
        setError(data.reason);
      }
    } catch {
      setError("Could not pick the next lead.");
    }
  }

  function playAudio() {
    if (!audioScript || !speechSupported) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(audioScript);
    utterance.rate = 0.96;
    utterance.onend = () => setAudioState("idle");
    utterance.onerror = () => setAudioState("idle");
    utteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
    setAudioState("playing");
  }

  function pauseAudio() {
    window.speechSynthesis.pause();
    setAudioState("paused");
  }

  function resumeAudio() {
    window.speechSynthesis.resume();
    setAudioState("playing");
  }

  function stopAudio() {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    utteranceRef.current = null;
    setAudioState("idle");
  }

  async function toggleTask(id: string) {
    setTasks((current) => current.map((task) => task.id === id ? { ...task, completed: !task.completed } : task));
    try {
      await fetch("/api/tasks/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      await refreshTrace();
    } catch {
      // Optimistic update already applied; refresh will reconcile later.
    }
  }

  async function addNote() {
    const value = noteInput.trim();
    if (!value) return;
    setNoteInput("");
    try {
      const response = await fetch("/api/properties/note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId: selectedProperty.id, body: value }),
      });
      const data = (await response.json()) as { property?: PropertyRecord };
      if (data.property) {
        setProperties((current) => current.map((property) => property.id === data.property!.id ? data.property! : property));
      }
      await refreshTrace();
    } catch {
      setError("The note could not be saved.");
    }
  }

  async function markCalled() {
    try {
      const response = await fetch("/api/properties/mark-called", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId: selectedProperty.id }),
      });
      const data = (await response.json()) as { property?: PropertyRecord };
      if (data.property) {
        setProperties((current) => current.map((property) => property.id === data.property!.id ? data.property! : property));
      }
      await refreshTrace();
    } catch {
      setError("The call could not be logged.");
    }
  }

  const completedTasks = tasks.filter((task) => task.completed).length;
  const remainingTasks = tasks.length - completedTasks;

  if (needsLogin) {
    return (
      <main className="login-screen">
        <div className="login-card">
          <span className="brand-mark">P</span>
          <h1>Property OS</h1>
          <p>Know which property needs you next. Sign in to open your workspace.</p>
          <a className="google-button" href="/api/auth/login">
            <span>G</span> Sign in with Google
          </a>
          <small>Your properties, notes, and contacts are private to your workspace.</small>
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="icon-rail" aria-label="Quick actions">
        <button type="button" onClick={() => { setPaletteOpen(true); setPaletteQuery(""); }} aria-label="Search properties" title="Search properties">⌕</button>
        <button type="button" onClick={() => setNotifOpen((value) => !value)} aria-label={`Notifications (${notifications.length})`} title="Notifications">
          ♡{notifications.length > 0 && <b>{notifications.length}</b>}
        </button>
        <button type="button" onClick={logout} aria-label="Sign out" title={me ? `Sign out ${me.displayName}` : "Sign out"}>
          {me ? me.displayName.slice(0, 2).toUpperCase() : "MK"}
        </button>
      </aside>

      <section className="app-stage">
        <header className="topbar">
          <div className="mobile-brand"><span className="brand-mark">P</span><strong>Property OS</strong></div>
          <div className="topbar-breadcrumb">
            <span>Workspace</span>
            <strong>{view === "workspace" ? selectedProperty.address : navItems.find((item) => item.id === view)?.label}</strong>
          </div>
          {clock && <span className="topbar-clock" aria-hidden="true">{clock}</span>}
          <div className="topbar-actions">
            <button className="search-trigger" type="button" onClick={() => { setPaletteOpen(true); setPaletteQuery(""); }}>Search properties <kbd>⌘ K</kbd></button>
            <div className="notif-wrap">
              <button className="notification-button" type="button" aria-label="Notifications" onClick={() => setNotifOpen((value) => !value)}>{notifications.length}</button>
              {notifOpen && (
                <div className="notif-dropdown" role="menu">
                  <div className="notif-head"><strong>Notifications</strong><button type="button" onClick={() => setNotifOpen(false)}>Close</button></div>
                  {notifications.length === 0 && <p className="muted">You&apos;re all caught up.</p>}
                  {notifications.map((item) => (
                    <button key={item.id} className="notif-item" type="button" onClick={() => { setNotifOpen(false); if (item.address) openProperty(propertyForAddress(item.address)); else navigate("approvals"); }}>
                      <span className={`notif-kind ${item.kind.toLowerCase()}`}>{item.kind}</span><span>{item.text}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="mobile-nav" aria-label="Mobile navigation">
          {navItems.map((item) => (
            <button key={item.id} type="button" className={view === item.id ? "active" : ""} onClick={() => navigate(item.id)}>
              {item.label}
            </button>
          ))}
        </div>

        {paletteOpen && (
          <div className="palette-overlay" role="dialog" aria-label="Search properties" onClick={() => setPaletteOpen(false)}>
            <div className="palette" onClick={(event) => event.stopPropagation()}>
              <input
                autoFocus
                value={paletteQuery}
                onChange={(event) => setPaletteQuery(event.target.value)}
                placeholder="Search address, owner, neighborhood, or signal…"
                aria-label="Search query"
              />
              <div className="palette-results">
                {paletteResults.length === 0 && <p className="muted">No matches.</p>}
                {paletteResults.map((property) => (
                  <button key={property.id} type="button" className="palette-item" onClick={() => openProperty(property)}>
                    <strong>{property.address}</strong>
                    <span>{property.ownerName} · {property.neighborhood}</span>
                    <em className={`score-badge ${scoreTone(property.score)}`}>{property.score}</em>
                  </button>
                ))}
              </div>
              <div className="palette-foot"><kbd>Esc</kbd> to close · <kbd>⌘K</kbd> to toggle</div>
            </div>
          </div>
        )}

        <nav className="deck-tabs" aria-label="Sections">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === activeCard?.id ? "on" : ""}
              onClick={() => navigate(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="deck" onWheel={onDeckWheel}>
          <div className="deck-stage">
            {navItems.map((item, index) => {
              const offset = index - deckIndex;
              const isCentre = offset === 0;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`card3d${isCentre ? " is-centre" : ""}`}
                  style={{ "--offset": offset, zIndex: 20 - Math.abs(offset) } as CSSProperties}
                  aria-current={isCentre ? "true" : undefined}
                  aria-label={isCentre ? `Open ${item.label}` : `Bring ${item.label} to the front`}
                  onClick={() => (isCentre ? setExpanded(true) : navigate(item.id))}
                >
                  <span className="card3d-photo" style={{ backgroundImage: `url(${cardArt[item.id]?.image ?? ""})` }}>
                    {isCentre && <span className="card3d-expand">⤢ Expand</span>}
                  </span>
                  <span className="card3d-copy">
                    <span className="card3d-title">
                      <strong>{item.label}</strong>
                      <em>{index + 1} / {navItems.length}</em>
                    </span>
                    <p>{cardArt[item.id]?.blurb}</p>
                    <span className="card3d-meta">{item.hint} · {cardMeta(item.id)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <nav className="deck-rail" aria-label="Card navigation">
          <button type="button" onClick={() => goToCard(-1)} disabled={deckIndex === 0} aria-label="Previous card">‹</button>
          <span
            className="deck-rail-thumb"
            style={{ backgroundImage: `url(${cardArt[activeCard?.id ?? "briefing"]?.image ?? ""})` }}
            aria-hidden="true"
          />
          <span className="deck-rail-now">
            <strong>{workspaceName || "Your workspace"}</strong>
            <small>{activeCard?.label}</small>
            <small>Nothing sends without your OK</small>
          </span>
          <button type="button" className="deck-heart" onClick={() => setExpanded(true)} aria-label={`Open ${activeCard?.label}`}>♡</button>
          <button type="button" onClick={() => goToCard(1)} disabled={deckIndex === navItems.length - 1} aria-label="Next card">›</button>
        </nav>

        <span className="deck-dots" aria-hidden="true">
          {navItems.map((item, index) => (
            <i key={item.id} className={index === deckIndex ? "on" : ""} />
          ))}
        </span>

        {expanded && (
          <div className="sheet-scrim" role="dialog" aria-modal="true" aria-label={activeCard?.label} onClick={() => setExpanded(false)}>
            <div className="sheet" onClick={(event) => event.stopPropagation()}>
              <header className="sheet-head">
                <div>
                  <p className="overline">{deckIndex + 1} / {navItems.length}</p>
                  <h2>{activeCard?.label}</h2>
                </div>
                <button type="button" onClick={() => setExpanded(false)} aria-label="Close">✕</button>
              </header>
              <div className="sheet-body">

        {view === "briefing" && (
          <div className="view-content briefing-view">
            <section className="welcome-row">
              <div>
                <p className="overline">{todayLabel}</p>
                <h1>Good morning{me ? `, ${me.displayName.split(" ")[0]}` : ""}.</h1>
                <p>{properties.length > 0 ? "Your priority properties are ranked below, each tied to source evidence." : "Import your leads or look up a property to get started."}</p>
              </div>
              <div className="welcome-actions">
                <button className="secondary-action" type="button" onClick={() => setShowImport((value) => !value)}>{showImport ? "Close import" : "Import leads"}</button>
                <button className="secondary-action" type="button" onClick={loadNextLead}>Next lead →</button>
                <button className="primary-action" type="button" onClick={audioState === "idle" ? playAudio : stopAudio} disabled={!speechSupported}>
                  {audioState === "idle" ? "Play morning briefing" : "Stop audio"}
                </button>
              </div>
            </section>

            <section className="orchestrator-bar" aria-labelledby="orchestrator-heading">
              <div className="orchestrator-head">
                <p className="overline">Your assistant</p>
                <h2 id="orchestrator-heading">How can I help today?</h2>
                <p>Try <em>“Who should I call today?”</em>, <em>“What’s the story with 88 Linden Avenue?”</em>, or <em>“Write an email to Sara Patel.”</em> Anything it writes waits for your OK before it’s sent.</p>
              </div>
              <div className="orchestrator-input">
                <input
                  value={command}
                  onChange={(event) => setCommand(event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Enter") askOrchestrator(); }}
                  placeholder="Ask a question, or tap the mic to talk…"
                  aria-label="Ask a question"
                />
                <button className={`mic-button ${listening ? "on" : ""}`} type="button" onClick={listening ? stopVoice : startVoice} aria-label={listening ? "Stop talking" : "Talk instead of typing"} title="Talk instead of typing">{listening ? "◉" : "🎙"}</button>
                <button className="primary-action" type="button" onClick={askOrchestrator} disabled={thinking || !command.trim()}>{thinking ? "Thinking…" : "Ask"}</button>
              </div>

              {orchestration && (
                <div className="orchestrator-reply" role="status">
                  <p className="reply-text">{orchestration.reply}</p>
                  {orchestration.recommendations.length > 0 && (
                    <ul className="reply-recs">
                      {orchestration.recommendations.map((rec) => (
                        <li key={rec.propertyId}>
                          <button type="button" onClick={() => openProperty(propertyForAddress(rec.address))}>
                            <span className={`priority-pill ${rec.priority}`}>{rec.priority}</span>
                            <strong>{rec.address}</strong>
                            <small>{rec.reason}</small>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {orchestration.drafts.map((draft) => (
                    <div className={`reply-draft ${draft.allowed ? "" : "blocked"}`} key={draft.propertyId + draft.channel}>
                      <div className="reply-draft-head">
                        <strong>{channelLabel(draft.channel)} · {draft.address}</strong>
                        <span>{draft.allowed ? "Held for approval" : "Blocked by compliance"}</span>
                      </div>
                      {draft.allowed ? <p>{draft.message}</p> : <p className="warning">{draft.complianceWarnings.join(" ")}</p>}
                      {draft.allowed && <button className="link-button" type="button" onClick={() => navigate("approvals")}>Review in approvals →</button>}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {showImport && (
              <section className="import-drawer" aria-labelledby="import-heading">
                <div>
                  <p className="overline">AI import</p>
                  <h2 id="import-heading">Turn messy notes into today&apos;s plan</h2>
                  <p>Upload any CSV of leads — Property OS works out which columns hold the addresses, owners, dates, and notes, whatever they’re called. Do-not-contact records are removed before ranking.</p>
                </div>
                <label className="compact-upload" htmlFor="lead-file">
                  <span>{/\.xlsx?$/i.test(fileName) ? "XLSX" : "CSV"}</span><strong>{fileName || "Choose a CSV or Excel file"}</strong>
                  <input id="lead-file" data-testid="lead-file" type="file" accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={handleFile} />
                </label>
                <div className="import-actions">
                  <button className="primary-action" type="button" onClick={generate} disabled={!csvText || loading}>{loading ? "Analyzing..." : "Generate briefing"}</button>
                </div>
                {error && <p className="error-message" role="alert">{error}</p>}
              </section>
            )}

            <section className="kpi-grid" aria-label="Overview">
              <article><span>Your homes</span><strong>{properties.length}</strong><small>saved in your list</small></article>
              <article><span>To-do</span><strong>{tasks.filter((task) => !task.completed).length}</strong><small>{tasks.filter((task) => task.due === "Today" && !task.completed).length} due today</small></article>
              <article><span>Messages to review</span><strong>{pendingApprovals.length}</strong><small>waiting for your OK</small></article>
              <article><span>Enriched</span><strong>{properties.filter((property) => property.enriched).length}</strong><small>with full details</small></article>
            </section>

            {briefing?.metrics.warning && <p className="run-warning" role="status">{briefing.metrics.warning}</p>}

            {briefing && briefing.rejectedRows.length > 0 && (
              <section className="rejected-rows" role="status">
                <strong>{briefing.rejectedRows.length} row(s) skipped on import.</strong>
                <ul>{briefing.rejectedRows.slice(0, 5).map((row) => <li key={row.rowNumber}>Row {row.rowNumber}: {row.reason}</li>)}</ul>
              </section>
            )}

            <section className="weekly-strip" aria-label="This week">
              <div><span>This week</span><strong>{weekly.dueThisWeek}</strong><small>follow-ups due</small></div>
              <div><span>Portfolio</span><strong>{weekly.total}</strong><small>properties tracked</small></div>
              <div><span>Enriched</span><strong>{weekly.enriched}</strong><small>with NYC records</small></div>
              <div><span>High priority</span><strong>{weekly.highPriority}</strong><small>score ≥ 85</small></div>
            </section>

            <div className="dashboard-grid">
              <section className="panel priority-panel">
                <div className="panel-title-row">
                  <div><p className="overline">Today&apos;s queue</p><h2>Who to call first</h2></div>
                  <div className="queue-controls">
                    {briefing && <span className={`provider-badge ${briefing.metrics.provider}`}>{providerName(briefing)}</span>}
                    {audioState === "playing" && <button type="button" onClick={pauseAudio}>Pause</button>}
                    {audioState === "paused" && <button type="button" onClick={resumeAudio}>Resume</button>}
                  </div>
                </div>

                <div className="priority-list" data-testid="priority-grid">
                  {displayPriorities.length === 0 && (
                    <div className="empty-state">
                      <strong>No properties yet.</strong>
                      <p>Import a lead CSV or look up an NYC address to build your priority queue.</p>
                      <button className="primary-action" type="button" onClick={() => setShowImport(true)}>Import leads</button>
                    </div>
                  )}
                  {displayPriorities.map((priority) => (
                    <button className="priority-row" type="button" key={priority.address} onClick={() => openProperty(propertyForAddress(priority.address))}>
                      <span className="priority-rank">0{priority.rank}</span>
                      <div className="priority-address"><strong>{priority.address}</strong><span>{priority.ownerName}</span></div>
                      <span className={`score-badge ${scoreTone(priority.score)}`}>{priority.score}</span>
                      <div className="priority-reason"><strong>{priority.statusLabel}</strong><span>{priority.headline}</span></div>
                      <span className={`confidence-dot ${priority.confidence}`} title={`${priority.confidence} confidence`} />
                      <span className="row-arrow" aria-hidden="true">→</span>
                    </button>
                  ))}
                </div>

                <button className="panel-link" type="button" onClick={() => navigate("properties")}>View all properties <span>→</span></button>
              </section>

              <aside className="panel opportunity-panel">
                <div className="panel-title-row"><div><p className="overline">Neighborhood pulse</p><h2>{neighborhood.name}</h2></div><button type="button" onClick={() => navigate("map")}>Open map</button></div>
                <div className="opportunity-value"><span>Estimated listing opportunity</span><strong>{neighborhood.opportunity}</strong></div>
                <div className="signal-grid">
                  <div><strong>{neighborhood.inherited}</strong><span>Inherited</span></div>
                  <div><strong>{neighborhood.violations}</strong><span>Violations</span></div>
                  <div><strong>{neighborhood.liens}</strong><span>Tax liens</span></div>
                  <div><strong>{neighborhood.absentee}</strong><span>Absentee</span></div>
                </div>
                <div className="street-recommendation"><span>Tip</span><strong>Open the map to find more</strong><p>Tap any block and Property OS finds the homeowners nearby.</p></div>
              </aside>
            </div>

            <div className="dashboard-grid">
              <section className="panel agenda-panel">
                <div className="panel-title-row"><div><p className="overline">Your day</p><h2>Reminders</h2></div><button type="button" onClick={() => navigate("tasks")}>{remainingTasks} left</button></div>
                {tasks.slice(0, 3).map((task) => <TaskRow key={task.id} task={task} onToggle={toggleTask} />)}
                {tasks.length === 0 && <p className="muted">No reminders yet. They appear when you import leads or set a follow-up.</p>}
              </section>

              <aside className="panel helper-panel">
                <div className="panel-title-row"><div><p className="overline">Need a hand?</p><h2>Three ways to get going</h2></div></div>
                <button className="helper-step" type="button" onClick={() => navigate("map")}>
                  <span>1</span><div><strong>Find new homeowners</strong><small>Open the map and tap any block.</small></div><em>→</em>
                </button>
                <button className="helper-step" type="button" onClick={() => { setShowImport(true); }}>
                  <span>2</span><div><strong>Bring in your leads</strong><small>Import a spreadsheet of contacts.</small></div><em>→</em>
                </button>
                <button className="helper-step" type="button" onClick={() => document.querySelector<HTMLInputElement>('.orchestrator-input input')?.focus()}>
                  <span>3</span><div><strong>Ask the assistant</strong><small>Type a question up top, or tap the mic.</small></div><em>→</em>
                </button>
              </aside>
            </div>

            <div className="dashboard-grid">
              <section className="panel">
                <div className="panel-title-row"><div><p className="overline">Ready to send</p><h2>Messages</h2></div><button type="button" onClick={() => navigate("approvals")}>{pendingApprovals.length} waiting</button></div>
                {pendingApprovals.length === 0 && <p className="muted">Nothing waiting. Anything the assistant drafts shows up here for your OK before it sends.</p>}
                {pendingApprovals.slice(0, 3).map((approval) => (
                  <button key={approval.id} className="mini-msg" type="button" onClick={() => navigate("approvals")}>
                    <span className="channel-chip">{channelLabel(approval.channel)}</span>
                    <span className="mini-draft">{approval.draft}</span>
                    <span className="row-arrow" aria-hidden="true">→</span>
                  </button>
                ))}
              </section>

              <aside className="panel">
                <div className="panel-title-row"><div><p className="overline">Owners</p><h2>People</h2></div><button type="button" onClick={() => navigate("contacts")}>{people.length}</button></div>
                {people.length === 0 && <p className="muted">Owners appear here as you add properties.</p>}
                {people.slice(0, 4).map((person) => (
                  <div key={person.id} className="mini-person">
                    <span className="contact-avatar">{person.name.slice(0, 2).toUpperCase()}</span>
                    <div><strong>{person.name}</strong><small>{person.role} · {person.properties.length} propert{person.properties.length === 1 ? "y" : "ies"}</small></div>
                  </div>
                ))}
              </aside>
            </div>

            <div className="dashboard-grid">
              <section className="panel">
                <div className="panel-title-row"><div><p className="overline">Your map</p><h2>Where your leads are</h2></div><button type="button" onClick={() => navigate("map")}>Open map</button></div>
                <div className="home-map">
                  <PropertyMap properties={properties} onOpenProperty={openProperty} onProspect={(latitude, longitude) => { navigate("map"); prospectArea(latitude, longitude); }} />
                </div>
              </section>

              <aside className="panel timeline-panel">
                <div className="panel-title-row"><div><p className="overline">Latest</p><h2>Recent activity</h2></div></div>
                {auditLog.length === 0 && <p className="muted">Your actions — calls, notes, messages — show up here as you go.</p>}
                {auditLog.slice(0, 5).map((entry) => (
                  <div className="timeline-event" key={entry.id}>
                    <span className={`timeline-icon ${entry.actor === "user" ? "note" : "signal"}`} aria-hidden="true">{entry.actor === "user" ? "✓" : "•"}</span>
                    <div><strong>{entry.action.replace(/_/g, " ")}</strong><p>{entry.detail}</p></div>
                    <time>{entry.createdAt.length >= 16 ? entry.createdAt.slice(11, 16) : ""}</time>
                  </div>
                ))}
              </aside>
            </div>
          </div>
        )}

        {view === "properties" && (
          <div className="view-content">
            <section className="page-heading">
              <div><p className="overline">Property-centered CRM</p><h1>Properties</h1><p>Every relationship, signal, and next action organized by address.</p></div>
              <button className="primary-action" type="button" onClick={() => { setShowImport(true); setView("briefing"); }}>Import properties</button>
            </section>

            <section className="property-tools">
              <label><span className="sr-only">Search properties</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search address, owner, neighborhood, or signal" /></label>
              <div className="filter-row">
                {statusFilters.map((filter) => <button key={filter.value} type="button" className={statusFilter === filter.value ? "active" : ""} onClick={() => setStatusFilter(filter.value)}>{filter.label}</button>)}
              </div>
            </section>

            <section className="saved-views">
              <span className="saved-views-label">Saved neighborhoods</span>
              {savedViews.length === 0 && <small className="muted">None yet — save the current filter.</small>}
              {savedViews.map((viewItem) => (
                <span className="saved-view-chip" key={viewItem.id}>
                  <button type="button" onClick={() => applySavedView(viewItem)}>{viewItem.name}</button>
                  <button type="button" className="chip-remove" aria-label={`Delete ${viewItem.name}`} onClick={() => deleteSavedView(viewItem.id)}>×</button>
                </span>
              ))}
              <button type="button" className="save-view-button" onClick={saveCurrentView}>+ Save current</button>
            </section>

            <section className="panel lookup-panel" aria-labelledby="lookup-heading">
              <div className="lookup-head">
                <div><p className="overline">Look up an address</p><h2 id="lookup-heading">Check any NYC property</h2><p>Type an address to see the owner, value, year built, violations and more — straight from official city records. No phone numbers, though; public records never include them.</p></div>
              </div>
              <div className="lookup-input">
                <input value={lookupAddress} onChange={(event) => setLookupAddress(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") runLookup("nyc"); }} placeholder="e.g. 120 Broadway" aria-label="Property address to look up" />
                <button type="button" onClick={() => runLookup("workspace")} disabled={lookupLoading || !lookupAddress.trim()}>My list</button>
                <button className="primary-action" type="button" onClick={() => runLookup("nyc")} disabled={lookupLoading || !lookupAddress.trim()}>{lookupLoading ? "Looking up…" : "Check city records"}</button>
              </div>
              {lookupError && <p className="error-message" role="alert">{lookupError}</p>}

              {lookupResult && (
                <div className="lookup-result">
                  <div className="lookup-result-head">
                    <div><strong>{lookupResult.context.address}</strong><span>{lookupResult.context.bbl ? `BBL ${lookupResult.context.bbl}` : "No BBL"}{lookupResult.context.bin ? ` · BIN ${lookupResult.context.bin}` : ""}</span></div>
                    <span className={`agent-badge ${lookupResult.context.provenance === "nyc_open_data" ? "claude" : "local_fallback"}`}>{lookupResult.context.provenance === "nyc_open_data" ? "Live NYC Open Data" : "Workspace data"}</span>
                  </div>

                  <div className="lookup-facts">
                    {Object.entries(lookupResult.context.facts).filter(([, value]) => value !== undefined && value !== "").map(([key, value]) => (
                      <div key={key}><dt>{key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())}</dt><dd>{String(value)}</dd></div>
                    ))}
                  </div>

                  <div className="lookup-signals">
                    <p className="overline">Evidence-backed signals · priority {lookupResult.report.recommendedPriority}</p>
                    {lookupResult.report.signals.length === 0 && <p className="muted">No opportunity signals in this record.</p>}
                    {lookupResult.report.signals.map((signal, index) => (
                      <div className="lookup-signal" key={`${signal.type}-${index}`}>
                        <span className={`confidence-dot ${signal.confidence}`} title={`${signal.confidence} confidence`} />
                        <div><strong>{signal.type.replace(/_/g, " ")}</strong><small>“{signal.evidence}” · {signal.source}</small></div>
                      </div>
                    ))}
                  </div>

                  <div className="lookup-meta">
                    <div><p className="overline">Sources</p><ul>{lookupResult.context.sources.map((source) => <li key={source.name}>{source.name}<time>{source.retrievedAt.slice(0, 10)}</time></li>)}</ul></div>
                    <div><p className="overline">Not from public records</p><ul>{lookupResult.report.missingInformation.map((item) => <li key={item}>{item.replace(/_/g, " ")}</li>)}</ul></div>
                  </div>
                </div>
              )}
            </section>

            <section className="panel property-table-panel">
              <div className="property-table-header"><span>Property</span><span>Signals</span><span>Last contact</span><span>Opportunity</span><span>Next action</span><span /></div>
              {filteredProperties.map((property) => (
                <button className="property-table-row" type="button" key={property.id} onClick={() => openProperty(property)}>
                  <div><strong>{property.address}</strong><span>{property.ownerName} · {property.neighborhood}</span></div>
                  <div className="table-signals"><span className={`status-chip ${property.status}`}>{property.statusLabel}</span><small>{property.signals[0]}</small></div>
                  <span>{property.lastContact || "—"}</span>
                  <div><strong>{property.score}/100</strong><span>{property.equity} equity</span></div>
                  <span>{property.nextAction}</span>
                  <span className="row-arrow">→</span>
                </button>
              ))}
              {filteredProperties.length === 0 && (
                <div className="no-results">{properties.length === 0 ? "No properties yet. Import a CSV or look up an NYC address to add real properties." : "No properties match those filters."}</div>
              )}
            </section>
          </div>
        )}

        {view === "map" && (
          <div className="view-content map-view">
            <section className="page-heading">
              <div><p className="overline">Neighborhood intelligence</p><h1>Opportunity map</h1><p><strong>Click anywhere on the map</strong> to prospect that block for new leads from live NYC property records.</p></div>
              <span className="demo-label">{placedProperties.length} of {properties.length} located</span>
            </section>

            <div className="map-layout">
              <section className="parcel-map panel" aria-label="Property opportunity map">
                <div className="map-toolbar">
                  <strong>{neighborhood.name}</strong>
                  <span>{prospecting ? "Prospecting this area…" : "Click the map to find new leads"}</span>
                </div>
                <PropertyMap properties={properties} onOpenProperty={openProperty} onProspect={prospectArea} />
                <div className="map-legend">
                  <span><i className="urgent" />Call today</span><span><i className="inherited" />Inherited</span><span><i className="violation" />Violation</span><span><i className="review" />Research</span>
                </div>
              </section>

              <aside className="map-side">
                <section className="panel prospect-panel">
                  <div className="panel-title-row"><div><p className="overline">Prospecting</p><h2>New leads in this area</h2></div>{prospect && <span>{prospect.candidates.length}</span>}</div>
                  {!prospect && <p className="muted">Click a block on the map and Property OS pulls the real parcels there, ranked as leads.</p>}
                  {prospecting && <p className="muted">Looking up NYC parcels…</p>}
                  {prospect && prospect.candidates.length === 0 && !prospecting && (
                    <p className="muted">No new parcels here — everything nearby is already in your workspace. Try another block.</p>
                  )}
                  {prospect?.candidates.map((candidate) => (
                    <div className="prospect-card" key={candidate.bbl}>
                      <div className="prospect-head">
                        <div><strong>{candidate.address}</strong><span>{candidate.ownerName}</span></div>
                        <span className={`score-badge ${scoreTone(candidate.score)}`}>{candidate.score}</span>
                      </div>
                      <ul className="prospect-reasons">
                        {candidate.reasons.map((reason) => <li key={reason}>{reason}</li>)}
                      </ul>
                      <div className="prospect-foot">
                        <small>BBL {candidate.bbl} · {candidate.source}</small>
                        <button className="primary-action" type="button" disabled={claiming === candidate.bbl} onClick={() => claimLead(candidate)}>
                          {claiming === candidate.bbl ? "Adding…" : "Add as lead"}
                        </button>
                      </div>
                    </div>
                  ))}
                  {prospect && <p className="prospect-note">{prospect.note}</p>}
                </section>

                <section className="panel neighborhood-panel">
                  <p className="overline">Computed from your workspace</p><h2>{neighborhood.name}</h2>
                  <div className="big-opportunity"><span>Estimated portfolio value</span><strong>{neighborhood.opportunity}</strong></div>
                  <dl>
                    <div><dt>Properties</dt><dd>{neighborhood.total}</dd></div>
                    <div><dt>Inherited / estate</dt><dd>{neighborhood.inherited}</dd></div>
                    <div><dt>Violations</dt><dd>{neighborhood.violations}</dd></div>
                    <div><dt>Absentee owners</dt><dd>{neighborhood.absentee}</dd></div>
                    <div><dt>Average value</dt><dd>{neighborhood.averageEquity}</dd></div>
                  </dl>
                </section>
              </aside>
            </div>
          </div>
        )}

        {view === "tasks" && (
          <div className="view-content tasks-view">
            <section className="page-heading">
              <div><p className="overline">Follow-up system</p><h1>Tasks</h1><p>Keep every commitment connected to its property workspace. Add them to your calendar and it reminds you even when Property OS is closed.</p></div>
              <div className="tasks-heading-actions">
                <a className="secondary-action" href="/api/calendar">📅 Add all to calendar</a>
                <div className="completion-ring"><strong>{completedTasks}/{tasks.length}</strong><span>complete</span></div>
              </div>
            </section>
            <section className="panel add-task-panel">
              <label className="sr-only" htmlFor="new-task">New task</label>
              <input id="new-task" value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") addTask(); }} placeholder="Add a task (e.g. Prepare CMA for 88 Linden Avenue)" />
              <button className="primary-action" type="button" onClick={addTask} disabled={!taskTitle.trim()}>Add task</button>
            </section>
            <section className="panel tasks-panel">
              <div className="task-group-heading"><strong>All tasks</strong><span>{tasks.filter((task) => !task.completed).length} open</span></div>
              {tasks.map((task) => <TaskRow key={task.id} task={task} onToggle={toggleTask} />)}
              {tasks.length === 0 && <p className="muted">No tasks yet. Add one above or import leads to generate follow-ups.</p>}
            </section>
            <section className="task-safety-note"><strong>Human approval is required.</strong><span>Completing a task records an audited workflow step; Property OS never places a call or sends a message automatically.</span></section>
          </div>
        )}

        {view === "approvals" && (
          <div className="view-content approvals-view">
            <section className="page-heading">
              <div><p className="overline">Human approval gate</p><h1>Approvals</h1><p>Every drafted message waits here. Property OS never sends anything without your decision.</p></div>
              <div className="completion-ring"><strong>{pendingApprovals.length}</strong><span>pending</span></div>
            </section>

            <section className="panel approvals-panel">
              {approvals.length === 0 && <p className="muted">Nothing to review yet. When you ask the assistant to write an email or letter, it shows up here for your OK before anything is sent.</p>}
              {approvals.map((approval) => (
                <article className={`approval-card ${approval.status}`} key={approval.id}>
                  <div className="approval-head">
                    <span className={`agent-badge outreach`}>{channelLabel(approval.channel)}</span>
                    <span className={`approval-status ${approval.status}`}>{approval.status}</span>
                  </div>
                  <p className="approval-draft">{approval.draft}</p>
                  {approval.complianceWarnings.length > 0 && (
                    <p className="warning">Compliance: {approval.complianceWarnings.join(" ")}</p>
                  )}
                  <a className="letter-link" href={`/api/outreach/letter?approvalId=${encodeURIComponent(approval.id)}`} target="_blank" rel="noreferrer">
                    ✉️ Print as letter (free — you already have the mailing address)
                  </a>
                  {approval.status === "pending" ? (
                    <div className="approval-actions">
                      {(approval.channel === "email" || approval.channel === "text") && (
                        <input
                          className="recipient-input"
                          value={recipients[approval.id] ?? ""}
                          onChange={(event) => setRecipients((current) => ({ ...current, [approval.id]: event.target.value }))}
                          placeholder={approval.channel === "email" ? "recipient@email.com (optional)" : "+1555… (optional)"}
                          aria-label="Recipient"
                        />
                      )}
                      <button className="primary-action" type="button" disabled={sending === approval.id} onClick={() => decideApproval(approval.id, "approved")}>
                        {sending === approval.id ? "Working…" : (recipients[approval.id] ?? "").trim() ? "Approve & send" : "Approve"}
                      </button>
                      <button className="secondary-action" type="button" disabled={sending === approval.id} onClick={() => decideApproval(approval.id, "rejected")}>Reject</button>
                      <small>
                        {(recipients[approval.id] ?? "").trim()
                          ? "This will actually send after the compliance gate re-checks do-not-contact."
                          : "Approve alone marks it ready. Add a recipient to send it now."}
                      </small>
                    </div>
                  ) : (
                    <div className="approval-decided-row">
                      <small className="approval-decided">Decided {approval.decidedAt ?? ""}</small>
                      {approval.deliveryStatus && (
                        <span className={`delivery-badge ${approval.deliveryStatus}`}>
                          {approval.deliveryStatus === "sent"
                            ? `Sent to ${approval.recipient}`
                            : `Delivery ${approval.deliveryStatus}${approval.deliveryError ? `: ${approval.deliveryError}` : ""}`}
                        </span>
                      )}
                    </div>
                  )}
                </article>
              ))}
            </section>

            <section className="panel audit-panel">
              <div className="panel-title-row"><div><p className="overline">Audit log</p><h2>Recent actions</h2></div><span>{auditLog.length} entries</span></div>
              {auditLog.slice(0, 8).map((entry) => (
                <div className="audit-row" key={entry.id}>
                  <span className={`audit-actor ${entry.actor}`}>{entry.actor}</span>
                  <div className="audit-copy"><strong>{entry.action.replace(/_/g, " ")}</strong><small>{entry.detail}</small></div>
                  <time>{entry.createdAt}</time>
                </div>
              ))}
            </section>
          </div>
        )}

        {view === "contacts" && (
          <div className="view-content contacts-view">
            <section className="page-heading">
              <div><p className="overline">Relationship graph</p><h1>Contacts</h1><p>Owners and contacts as first-class records. A person can relate to more than one property.</p></div>
              <span className="demo-label">{people.length} people</span>
            </section>
            <section className="panel skiptrace-panel">
              <div className="panel-title-row">
                <div><p className="overline">Bulk skip tracing</p><h2>Get phone numbers the cheap way</h2></div>
                <span>{config?.contactProvider?.configured ? config.contactProvider.name : "no vendor"}</span>
              </div>
              <p className="muted">
                Public records carry no phone numbers. Bulk CSV is the cheapest way to buy them — export only your
                high-scoring leads that have no contact details yet, run them through any vendor, then paste the results back.
              </p>
              <div className="skiptrace-actions">
                <label>
                  <span className="sr-only">Minimum score</span>
                  <select value={skipTraceScore} onChange={(event) => setSkipTraceScore(Number(event.target.value))} aria-label="Minimum score">
                    {[50, 60, 70, 80, 90].map((score) => <option key={score} value={score}>Score {score}+</option>)}
                  </select>
                </label>
                <a className="secondary-action" href={`/api/contacts/export?minScore=${skipTraceScore}`}>⬇ Export leads CSV</a>
              </div>
              <textarea
                value={importCsv}
                onChange={(event) => setImportCsv(event.target.value)}
                placeholder="Paste the CSV your vendor returned (any column named phone / mobile / email is picked up)…"
                aria-label="Skip trace results CSV"
              />
              <button className="primary-action" type="button" onClick={importSkipTrace} disabled={!importCsv.trim() || importing}>
                {importing ? "Importing…" : "Import results"}
              </button>
              {importResult && <p className="import-result">{importResult}</p>}
            </section>

            <section className="panel contacts-panel">
              <div className="contacts-header"><span>Name</span><span>Role</span><span>Related properties</span></div>
              {people.length === 0 && <p className="muted">No contacts yet. Import leads to create owner records.</p>}
              {people.map((person) => (
                <div className="contact-row" key={person.id}>
                  <div className="contact-name"><span className="contact-avatar">{person.name.slice(0, 1).toUpperCase()}</span><strong>{person.name}</strong></div>
                  <span className="contact-role">{person.role}</span>
                  <div className="contact-props">
                    {person.properties.map((property) => (
                      <button key={property.id} type="button" onClick={() => openProperty(propertyForAddress(property.address))}>{property.address}</button>
                    ))}
                    {person.properties.length === 0 && <small className="muted">—</small>}
                  </div>
                </div>
              ))}
            </section>
          </div>
        )}

        {view === "settings" && (
          <div className="view-content settings-view">
            <section className="page-heading">
              <div><p className="overline">Configuration</p><h1>Settings</h1><p>Runtime configuration and account. Secrets stay server-side and are never shown here.</p></div>
            </section>
            <div className="settings-grid">
              <section className="panel settings-card">
                <p className="overline">Account</p>
                <dl>
                  <div><dt>Signed in as</dt><dd>{me ? me.displayName : "Local session (no auth)"}</dd></div>
                  <div><dt>Email</dt><dd>{me ? me.email : "—"}</dd></div>
                </dl>
                <small>Auth activates automatically when the platform provides identity headers.</small>
              </section>
              <section className="panel settings-card">
                <p className="overline">AI &amp; data</p>
                {config ? (
                  <dl>
                    <div><dt>Property data source</dt><dd>{config.propertyDataProvider}</dd></div>
                    <div><dt>Extraction model</dt><dd>{config.anthropicModel}</dd></div>
                    <div><dt>Fallback model</dt><dd>{config.anthropicFallbackModel}</dd></div>
                    <div><dt>Opus fallback</dt><dd>{config.opusFallbackEnabled ? "on" : "off"}</dd></div>
                    <div><dt>Anthropic key</dt><dd>{config.anthropicKeyConfigured ? "configured" : "not set (local fallback)"}</dd></div>
                    <div><dt>Scoring engine</dt><dd>{config.scoringVersion}</dd></div>
                  </dl>
                ) : <p className="muted">Loading configuration…</p>}
                <small>Change these in <code>web/.env.local</code>. The live NYC lookup can be forced per request with <code>?source=nyc</code>.</small>
              </section>
              <section className="panel settings-card">
                <p className="overline">Notifications &amp; reminders</p>
                <dl>
                  <div><dt>Desktop notifications</dt><dd>{notificationsOn ? "on" : "off"}</dd></div>
                  <div><dt>Email delivery</dt><dd>{config?.delivery?.email ? "configured" : "not set"}</dd></div>
                  <div><dt>SMS delivery</dt><dd>{config?.delivery?.text ? "configured" : "not set (optional)"}</dd></div>
                </dl>
                {!notificationsOn && (
                  <button className="primary-action" type="button" onClick={enableNotifications}>Enable desktop notifications</button>
                )}
                <ul className="settings-list">
                  <li><a href="/api/calendar">Download all follow-ups</a> as a calendar file — your own calendar then reminds you, free.</li>
                  <li>Approved drafts can be printed as letters; the mailing address comes free from public records.</li>
                </ul>
              </section>
              <section className="panel settings-card">
                <p className="overline">Safety</p>
                <ul className="settings-list">
                  <li>Do-not-contact and channel permissions are enforced deterministically.</li>
                  <li>All outreach is drafted only and held for human approval.</li>
                  <li>Public records never supply phone, email, consent, or sale intent.</li>
                  <li>Every consequential write is recorded in the audit log.</li>
                </ul>
              </section>
            </div>
          </div>
        )}

        {view === "workspace" && selectedProperty && (
          <div className="view-content workspace-view">
            <button className="back-button" type="button" onClick={() => setView("properties")}>← All properties</button>
            {nextLead && nextLead.property.id === selectedProperty.id && (
              <div className="next-lead-banner" role="status">
                <strong>Next up</strong>
                <span>{nextLead.reason}</span>
                <button type="button" onClick={loadNextLead}>Skip to another →</button>
              </div>
            )}
            <section className="workspace-heading">
              <div>
                <div className="workspace-labels"><span className={`status-chip ${selectedProperty.status}`}>{selectedProperty.statusLabel}</span><span>Score {selectedProperty.score}/100</span></div>
                <h1>{selectedProperty.address}</h1>
                <p>{selectedProperty.neighborhood} · Owner: {selectedProperty.ownerName}</p>
              </div>
              <div className="workspace-actions">
                <button type="button" onClick={enrichSelected} disabled={enriching} title="Pulls owner, value, year built, violations and more from public records">{enriching ? "Getting details…" : selectedProperty.enriched ? "Refresh details" : "Get full details"}</button>
                <button type="button" onClick={() => navigate("map")}>See on map</button>
                <button className="primary-action" type="button" onClick={markCalled}>I called them</button>
              </div>
            </section>

            <div className="workspace-grid">
              <div className="workspace-main">
                <section className="panel ai-summary-card">
                  <div className="ai-heading"><span>AI</span><div><p className="overline">Property summary</p><h2>What you need to know</h2></div><small>Evidence-backed</small></div>
                  <p>{selectedProperty.summary}</p>
                  <div className="summary-action"><span>Recommended next action</span><strong>{selectedProperty.nextAction}</strong></div>
                </section>

                {scoreExplanation && (
                  <section className="panel score-panel">
                    <div className="panel-title-row"><div><p className="overline">Why this score</p><h2>Opportunity score {scoreExplanation.score}/100</h2></div><span>Scoring {scoreExplanation.version}</span></div>
                    <div className="score-breakdown">
                      <div className="score-factor base"><span>Base</span><b>+{scoreExplanation.base}</b></div>
                      {scoreExplanation.breakdown.map((factor, index) => (
                        <div className={`score-factor ${factor.points < 0 ? "negative" : ""}`} key={`${factor.detail}-${index}`}>
                          <span>{factor.detail}</span><b>{factor.points >= 0 ? "+" : ""}{factor.points}</b>
                        </div>
                      ))}
                      {scoreExplanation.breakdown.length === 0 && <p className="muted">No opportunity factors beyond the base score.</p>}
                    </div>
                  </section>
                )}

                <section className="panel contacts-detail-panel">
                  <div className="panel-title-row"><div><p className="overline">Owner contact</p><h2>How to reach them</h2></div><span>{contacts.length}</span></div>
                  {selectedProperty.ownerMailingAddress && (
                    <p className="mailing-note">📮 Mails to <strong>{selectedProperty.ownerMailingAddress}</strong> — free from public records, and enough to send a letter today.</p>
                  )}
                  {contacts.length === 0 && (
                    <p className="muted">No phone or email yet. Public records never include them — add one you already have, or export the skip-trace CSV.</p>
                  )}
                  {contacts.map((contact) => (
                    <div className="contact-detail-row" key={contact.id}>
                      <span className={`contact-type ${contact.type}`}>{contact.type}</span>
                      <div><strong>{contact.type === "phone" ? formatPhone(contact.value) : contact.value}</strong><small>from {contact.source}</small></div>
                      <button type="button" className="chip-remove" aria-label="Remove contact" onClick={() => removeContact(contact.id)}>×</button>
                    </div>
                  ))}
                  <div className="contact-form">
                    <input value={contactInput} onChange={(event) => setContactInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") addContact(); }} placeholder="Add a phone or email you already have" aria-label="New contact" />
                    <button className="primary-action" type="button" onClick={addContact} disabled={!contactInput.trim()}>Add</button>
                  </div>
                  <button className="secondary-action full-width" type="button" onClick={lookupContact} disabled={lookingUp}>
                    {lookingUp ? "Looking up…" : "Find contact info"}
                  </button>
                  <small className="contact-note">Scrub against the National DNC Registry before calling. The do-not-contact gate still applies.</small>
                </section>

                <section className="panel offers-panel">
                  <div className="panel-title-row"><div><p className="overline">Deal room</p><h2>Offers</h2></div><span>{offers.length}</span></div>
                  <div className="offer-form">
                    <input value={offerParty} onChange={(event) => setOfferParty(event.target.value)} placeholder="Buyer / party" aria-label="Offer party" />
                    <input value={offerAmount} onChange={(event) => setOfferAmount(event.target.value)} placeholder="Amount (e.g. 720000)" inputMode="numeric" aria-label="Offer amount" />
                    <button className="primary-action" type="button" onClick={addOffer} disabled={!offerParty.trim() || !offerAmount.trim()}>Log offer</button>
                  </div>
                  {offers.length === 0 && <p className="muted">No offers logged yet.</p>}
                  {offers.map((offer) => (
                    <div className="offer-row" key={offer.id}>
                      <div><strong>${offer.amount.toLocaleString("en-US")}</strong><span>{offer.party}{offer.notes ? ` · ${offer.notes}` : ""}</span></div>
                      <select value={offer.status} onChange={(event) => setOfferStatus(offer.id, event.target.value)} aria-label="Offer status">
                        {offerStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
                      </select>
                    </div>
                  ))}
                </section>

                <section className="panel documents-panel">
                  <div className="panel-title-row"><div><p className="overline">Records &amp; documents</p><h2>Sales history</h2></div><span>{documents.length}</span></div>
                  <div className="doc-form">
                    <input value={docName} onChange={(event) => setDocName(event.target.value)} placeholder="Attach a document reference (e.g. Listing agreement)" aria-label="Document name" />
                    <button className="primary-action" type="button" onClick={addDocument} disabled={!docName.trim()}>Attach</button>
                  </div>
                  {documents.length === 0 && <p className="muted">No records yet. Enrich this property to pull recorded deeds, mortgages, and permits.</p>}
                  {documents.map((document) => (
                    <div className="doc-row" key={document.id}>
                      <span className={`doc-source ${document.source}`}>{document.source === "nyc_acris" ? "ACRIS" : document.source === "nyc_dob" ? "DOB" : "User"}</span>
                      <div><strong>{document.name}</strong><span>{document.recordedDate ?? ""}{document.amount ? ` · $${document.amount.toLocaleString("en-US")}` : ""}</span></div>
                    </div>
                  ))}
                </section>

                <section className="panel timeline-panel">
                  <div className="panel-title-row"><div><p className="overline">Relationship memory</p><h2>Property timeline</h2></div><span>{selectedProperty.timeline.length} events</span></div>
                  {selectedProperty.timeline.map((event, index) => (
                    <div className="timeline-event" key={`${event.date}-${event.title}-${index}`}><span className={`timeline-icon ${event.type}`}>{event.type.slice(0, 1).toUpperCase()}</span><div><strong>{event.title}</strong><p>{event.detail}</p></div><time>{event.date}</time></div>
                  ))}
                </section>
              </div>

              <aside className="workspace-aside">
                <section className="panel fact-card">
                  <p className="overline">Property facts {selectedProperty.enriched && <span className="fact-badge">NYC verified</span>}</p>
                  <dl>
                    {selectedProperty.bbl && <div><dt>BBL</dt><dd>{selectedProperty.bbl}</dd></div>}
                    {selectedProperty.assessedValue ? <div><dt>Assessed value</dt><dd>${selectedProperty.assessedValue.toLocaleString("en-US")}</dd></div> : <div><dt>Estimated equity</dt><dd>{selectedProperty.equity}</dd></div>}
                    {selectedProperty.yearBuilt ? <div><dt>Year built</dt><dd>{selectedProperty.yearBuilt}</dd></div> : <div><dt>Ownership length</dt><dd>{selectedProperty.ownershipYears} years</dd></div>}
                    <div><dt>Last contact</dt><dd>{selectedProperty.lastContact || "—"}</dd></div>
                    <div><dt>Follow-up</dt><dd>{selectedProperty.followUpDate ?? "Needs review"}</dd></div>
                  </dl>
                  {!selectedProperty.enriched && <small>Enrich to pull real BBL, assessed value, year built, and public signals.</small>}
                </section>
                <section className="panel signal-card"><p className="overline">Active signals</p><div>{selectedProperty.signals.map((signal) => <span key={signal}>{signal}</span>)}</div></section>
                <section className="panel permission-card">
                  <p className="overline">Contact permissions</p>
                  {!permission && <small className="muted">Loading permissions…</small>}
                  {permission && (
                    <div className="permission-list">
                      <label className={`permission-toggle danger ${permission.doNotContact ? "on" : ""}`}>
                        <input type="checkbox" checked={permission.doNotContact} onChange={() => togglePermission("doNotContact")} />
                        <span>Do not contact</span>
                      </label>
                      {(["phoneAllowed", "emailAllowed", "textAllowed", "mailAllowed"] as const).map((key) => (
                        <label key={key} className={`permission-toggle ${permission[key] && !permission.doNotContact ? "on" : ""}`}>
                          <input type="checkbox" checked={permission[key]} disabled={permission.doNotContact} onChange={() => togglePermission(key)} />
                          <span>{key.replace("Allowed", "")}</span>
                        </label>
                      ))}
                    </div>
                  )}
                  <small>The Outreach agent is blocked deterministically by these settings.</small>
                </section>
                <section className="panel add-note-card"><p className="overline">Add to timeline</p><label><span className="sr-only">New property note</span><textarea value={noteInput} onChange={(event) => setNoteInput(event.target.value)} placeholder="Type a note about this property..." /></label><button className="primary-action" type="button" onClick={addNote} disabled={!noteInput.trim()}>Add note</button><small>Notes are saved to the property timeline.</small></section>
              </aside>
            </div>
          </div>
        )}

              </div>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
