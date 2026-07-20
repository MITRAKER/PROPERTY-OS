"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import type { BriefingResult } from "../lib/briefing";
import { demoProperties, initialTasks, neighborhoodStats } from "../lib/demo-data";
import type { DemoTask, PropertyRecord, PropertyStatus } from "../lib/demo-data";

type AppView = "briefing" | "properties" | "map" | "tasks" | "workspace";

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

const navItems: Array<{ id: Exclude<AppView, "workspace">; number: string; label: string }> = [
  { id: "briefing", number: "01", label: "Briefing" },
  { id: "properties", number: "02", label: "Properties" },
  { id: "map", number: "03", label: "Map Intelligence" },
  { id: "tasks", number: "04", label: "Tasks" },
];

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

function TaskRow({ task, onToggle }: { task: DemoTask; onToggle: (id: string) => void }) {
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
    </div>
  );
}

export default function Home() {
  const [view, setView] = useState<AppView>("briefing");
  const [selectedProperty, setSelectedProperty] = useState<PropertyRecord>(demoProperties[0]);
  const [statusFilter, setStatusFilter] = useState<"all" | PropertyStatus>("all");
  const [search, setSearch] = useState("");
  const [tasks, setTasks] = useState(initialTasks);
  const [notes, setNotes] = useState<Record<string, string[]>>({});
  const [noteInput, setNoteInput] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState("");
  const [briefing, setBriefing] = useState<BriefingResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [audioState, setAudioState] = useState<"idle" | "playing" | "paused">("idle");
  const [speechSupported, setSpeechSupported] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const displayPriorities = useMemo<DisplayPriority[]>(() => {
    if (!briefing) {
      return demoProperties.slice(0, 3).map((property, index) => ({
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
      const property = demoProperties.find((item) => item.address === priority.address);
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
  }, [briefing]);

  const filteredProperties = useMemo(() => {
    const query = search.trim().toLowerCase();
    return demoProperties.filter((property) => {
      const matchesFilter = statusFilter === "all" || property.status === statusFilter;
      const matchesSearch = !query || [property.address, property.ownerName, property.neighborhood, ...property.signals]
        .some((value) => value.toLowerCase().includes(query));
      return matchesFilter && matchesSearch;
    });
  }, [search, statusFilter]);

  const audioScript = useMemo(() => {
    const intro = `Good morning Mitra. Property OS has ${displayPriorities.length} priority properties for you today.`;
    const properties = displayPriorities.map((priority) =>
      `Priority ${priority.rank}. ${priority.address}, owner ${priority.ownerName}. ${priority.headline}`,
    );
    return [intro, ...properties, "No outreach has been sent."].join(" ");
  }, [displayPriorities]);

  useEffect(() => {
    const supportCheck = window.setTimeout(() => setSpeechSupported("speechSynthesis" in window), 0);
    return () => {
      window.clearTimeout(supportCheck);
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  function navigate(nextView: Exclude<AppView, "workspace">) {
    stopAudio();
    setView(nextView);
  }

  function openProperty(property: PropertyRecord) {
    setSelectedProperty(property);
    setView("workspace");
  }

  function propertyForAddress(address: string) {
    return demoProperties.find((property) => property.address === address) ?? demoProperties[0];
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    setFileName(file.name);
    setCsvText(await file.text());
  }

  async function useDemoLeads() {
    setError("");
    try {
      const response = await fetch("/messy-leads.csv");
      if (!response.ok) throw new Error("The demo CSV could not be loaded.");
      setCsvText(await response.text());
      setFileName("messy-leads.csv");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "The demo CSV could not be loaded.");
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
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "The briefing could not be generated.");
    } finally {
      setLoading(false);
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

  function toggleTask(id: string) {
    setTasks((current) => current.map((task) => task.id === id ? { ...task, completed: !task.completed } : task));
  }

  function addNote() {
    const value = noteInput.trim();
    if (!value) return;
    setNotes((current) => ({
      ...current,
      [selectedProperty.id]: [value, ...(current[selectedProperty.id] ?? [])],
    }));
    setNoteInput("");
  }

  const completedTasks = tasks.filter((task) => task.completed).length;
  const remainingTasks = tasks.length - completedTasks;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <button className="brand" type="button" onClick={() => navigate("briefing")} aria-label="Open Property OS briefing">
          <span className="brand-mark">P</span>
          <span className="brand-copy"><strong>Property OS</strong><small>Property intelligence</small></span>
        </button>

        <nav className="main-nav" aria-label="Primary navigation">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={view === item.id || (view === "workspace" && item.id === "properties") ? "active" : ""}
              onClick={() => navigate(item.id)}
            >
              <span>{item.number}</span>{item.label}
              {item.id === "tasks" && remainingTasks > 0 && <b>{remainingTasks}</b>}
            </button>
          ))}
        </nav>

        <div className="sidebar-status">
          <span className="status-dot" />
          <div><strong>Demo workspace</strong><small>No outreach is automated</small></div>
        </div>
        <div className="user-chip"><span>MK</span><div><strong>Mitra K.</strong><small>Listing agent</small></div></div>
      </aside>

      <section className="app-stage">
        <header className="topbar">
          <div className="mobile-brand"><span className="brand-mark">P</span><strong>Property OS</strong></div>
          <div className="topbar-breadcrumb">
            <span>Workspace</span>
            <strong>{view === "workspace" ? selectedProperty.address : navItems.find((item) => item.id === view)?.label}</strong>
          </div>
          <div className="topbar-actions">
            <button className="search-trigger" type="button" onClick={() => navigate("properties")}>Search properties <kbd>⌘ K</kbd></button>
            <button className="notification-button" type="button" aria-label="Notifications">3</button>
          </div>
        </header>

        <div className="mobile-nav" aria-label="Mobile navigation">
          {navItems.map((item) => (
            <button key={item.id} type="button" className={view === item.id ? "active" : ""} onClick={() => navigate(item.id)}>
              {item.label}
            </button>
          ))}
        </div>

        {view === "briefing" && (
          <div className="view-content briefing-view">
            <section className="welcome-row">
              <div>
                <p className="overline">Monday, July 20</p>
                <h1>Good morning, Mitra.</h1>
                <p>Three properties need your attention first. Every recommendation is tied to source evidence.</p>
              </div>
              <div className="welcome-actions">
                <button className="secondary-action" type="button" onClick={() => setShowImport((value) => !value)}>{showImport ? "Close import" : "Import leads"}</button>
                <button className="primary-action" type="button" onClick={audioState === "idle" ? playAudio : stopAudio} disabled={!speechSupported}>
                  {audioState === "idle" ? "Play morning briefing" : "Stop audio"}
                </button>
              </div>
            </section>

            {showImport && (
              <section className="import-drawer" aria-labelledby="import-heading">
                <div>
                  <p className="overline">AI import</p>
                  <h2 id="import-heading">Turn messy notes into today&apos;s plan</h2>
                  <p>Upload a CSV with address and notes. Do-not-contact records are removed before ranking.</p>
                </div>
                <label className="compact-upload" htmlFor="lead-file">
                  <span>CSV</span><strong>{fileName || "Choose lead file"}</strong>
                  <input id="lead-file" data-testid="lead-file" type="file" accept=".csv,text/csv" onChange={handleFile} />
                </label>
                <div className="import-actions">
                  <button type="button" onClick={useDemoLeads}>Use demo file</button>
                  <button className="primary-action" type="button" onClick={generate} disabled={!csvText || loading}>{loading ? "Analyzing..." : "Generate briefing"}</button>
                </div>
                {error && <p className="error-message" role="alert">{error}</p>}
              </section>
            )}

            <section className="kpi-grid" aria-label="Workspace overview">
              <article><span>Priority properties</span><strong>16</strong><small><b>+4</b> since Friday</small></article>
              <article><span>Follow-ups due</span><strong>7</strong><small>3 overdue</small></article>
              <article><span>Estimated opportunity</span><strong>$124K</strong><small>Potential commission</small></article>
              <article><span>Pipeline represented</span><strong>$18.4M</strong><small>Rosedale focus area</small></article>
            </section>

            {briefing?.metrics.warning && <p className="run-warning" role="status">{briefing.metrics.warning}</p>}

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
                <div className="panel-title-row"><div><p className="overline">Neighborhood pulse</p><h2>{neighborhoodStats.name}</h2></div><button type="button" onClick={() => navigate("map")}>Open map</button></div>
                <div className="opportunity-value"><span>Estimated listing opportunity</span><strong>{neighborhoodStats.opportunity}</strong></div>
                <div className="signal-grid">
                  <div><strong>{neighborhoodStats.inherited}</strong><span>Inherited</span></div>
                  <div><strong>{neighborhoodStats.violations}</strong><span>Violations</span></div>
                  <div><strong>{neighborhoodStats.liens}</strong><span>Tax liens</span></div>
                  <div><strong>{neighborhoodStats.absentee}</strong><span>Absentee</span></div>
                </div>
                <div className="street-recommendation"><span>Recommended route</span><strong>Start on 243rd Street</strong><p>Five high-equity properties are within a six-block walk.</p></div>
              </aside>
            </div>

            <section className="panel agenda-panel">
              <div className="panel-title-row"><div><p className="overline">Your day</p><h2>Next actions</h2></div><button type="button" onClick={() => navigate("tasks")}>{remainingTasks} remaining</button></div>
              {tasks.slice(0, 3).map((task) => <TaskRow key={task.id} task={task} onToggle={toggleTask} />)}
            </section>
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

            <section className="panel property-table-panel">
              <div className="property-table-header"><span>Property</span><span>Signals</span><span>Last contact</span><span>Opportunity</span><span>Next action</span><span /></div>
              {filteredProperties.map((property) => (
                <button className="property-table-row" type="button" key={property.id} onClick={() => openProperty(property)}>
                  <div><strong>{property.address}</strong><span>{property.ownerName} · {property.neighborhood}</span></div>
                  <div className="table-signals"><span className={`status-chip ${property.status}`}>{property.statusLabel}</span><small>{property.signals[0]}</small></div>
                  <span>{property.lastContact}</span>
                  <div><strong>{property.score}/100</strong><span>{property.equity} equity</span></div>
                  <span>{property.nextAction}</span>
                  <span className="row-arrow">→</span>
                </button>
              ))}
              {filteredProperties.length === 0 && <div className="no-results">No properties match those filters.</div>}
            </section>
          </div>
        )}

        {view === "map" && (
          <div className="view-content map-view">
            <section className="page-heading">
              <div><p className="overline">Neighborhood intelligence</p><h1>Opportunity map</h1><p>Explore demo property signals across Rosedale and nearby Queens neighborhoods.</p></div>
              <span className="demo-label">Demo parcel view</span>
            </section>

            <div className="map-layout">
              <section className="parcel-map panel" aria-label="Demo property opportunity map">
                <div className="map-toolbar"><strong>Rosedale, Queens</strong><span>8 properties in workspace</span></div>
                <div className="road road-horizontal one">243rd Street</div>
                <div className="road road-horizontal two">Hook Creek Blvd</div>
                <div className="road road-vertical">149th Avenue</div>
                {demoProperties.map((property) => (
                  <button key={property.id} className={`parcel ${property.mapClass} ${property.status}`} type="button" onClick={() => openProperty(property)} aria-label={`Open ${property.address}`}>
                    <span>{property.score}</span><strong>{property.address.split(" ")[0]}</strong>
                  </button>
                ))}
                <div className="map-legend">
                  <span><i className="urgent" />Call today</span><span><i className="inherited" />Inherited</span><span><i className="violation" />Violation</span><span><i className="review" />Research</span>
                </div>
              </section>

              <aside className="panel neighborhood-panel">
                <p className="overline">This week</p><h2>{neighborhoodStats.name}</h2>
                <div className="big-opportunity"><span>Estimated listing opportunity</span><strong>{neighborhoodStats.opportunity}</strong></div>
                <dl>
                  <div><dt>Inherited properties</dt><dd>{neighborhoodStats.inherited}</dd></div>
                  <div><dt>Open violations</dt><dd>{neighborhoodStats.violations}</dd></div>
                  <div><dt>Tax liens</dt><dd>{neighborhoodStats.liens}</dd></div>
                  <div><dt>Expired listings</dt><dd>{neighborhoodStats.expired}</dd></div>
                  <div><dt>Absentee owners</dt><dd>{neighborhoodStats.absentee}</dd></div>
                  <div><dt>Average equity</dt><dd>{neighborhoodStats.averageEquity}</dd></div>
                </dl>
                <div className="route-card"><span>Best next move</span><strong>Door-knock these five blocks first</strong><p>243rd Street → 149th Avenue → Hook Creek Boulevard</p></div>
              </aside>
            </div>
          </div>
        )}

        {view === "tasks" && (
          <div className="view-content tasks-view">
            <section className="page-heading">
              <div><p className="overline">Follow-up system</p><h1>Tasks</h1><p>Keep every commitment connected to its property workspace.</p></div>
              <div className="completion-ring"><strong>{completedTasks}/{tasks.length}</strong><span>complete</span></div>
            </section>
            <section className="panel tasks-panel">
              <div className="task-group-heading"><strong>Today</strong><span>{tasks.filter((task) => task.due === "Today" && !task.completed).length} open</span></div>
              {tasks.map((task) => <TaskRow key={task.id} task={task} onToggle={toggleTask} />)}
            </section>
            <section className="task-safety-note"><strong>Human approval is required.</strong><span>Completing a task records the workflow step; Property OS never places a call or sends a message automatically.</span></section>
          </div>
        )}

        {view === "workspace" && (
          <div className="view-content workspace-view">
            <button className="back-button" type="button" onClick={() => setView("properties")}>← All properties</button>
            <section className="workspace-heading">
              <div>
                <div className="workspace-labels"><span className={`status-chip ${selectedProperty.status}`}>{selectedProperty.statusLabel}</span><span>AI score {selectedProperty.score}/100</span></div>
                <h1>{selectedProperty.address}</h1>
                <p>{selectedProperty.neighborhood} · Owner: {selectedProperty.ownerName}</p>
              </div>
              <div className="workspace-actions"><button type="button" onClick={() => navigate("map")}>View on map</button><button className="primary-action" type="button" onClick={() => setNotes((current) => ({ ...current, [selectedProperty.id]: ["Call marked complete from workspace.", ...(current[selectedProperty.id] ?? [])] }))}>Mark called</button></div>
            </section>

            <div className="workspace-grid">
              <div className="workspace-main">
                <section className="panel ai-summary-card">
                  <div className="ai-heading"><span>AI</span><div><p className="overline">Property summary</p><h2>What you need to know</h2></div><small>Evidence-backed</small></div>
                  <p>{selectedProperty.summary}</p>
                  <div className="summary-action"><span>Recommended next action</span><strong>{selectedProperty.nextAction}</strong></div>
                </section>

                <section className="panel timeline-panel">
                  <div className="panel-title-row"><div><p className="overline">Relationship memory</p><h2>Property timeline</h2></div><span>{selectedProperty.timeline.length + (notes[selectedProperty.id]?.length ?? 0)} events</span></div>
                  {(notes[selectedProperty.id] ?? []).map((note, index) => (
                    <div className="timeline-event" key={`${note}-${index}`}><span className="timeline-icon note">N</span><div><strong>Note added just now</strong><p>{note}</p></div><time>Now</time></div>
                  ))}
                  {selectedProperty.timeline.map((event) => (
                    <div className="timeline-event" key={`${event.date}-${event.title}`}><span className={`timeline-icon ${event.type}`}>{event.type.slice(0, 1).toUpperCase()}</span><div><strong>{event.title}</strong><p>{event.detail}</p></div><time>{event.date}</time></div>
                  ))}
                </section>
              </div>

              <aside className="workspace-aside">
                <section className="panel fact-card"><p className="overline">Property facts</p><dl><div><dt>Estimated equity</dt><dd>{selectedProperty.equity}</dd></div><div><dt>Ownership length</dt><dd>{selectedProperty.ownershipYears} years</dd></div><div><dt>Last contact</dt><dd>{selectedProperty.lastContact}</dd></div><div><dt>Follow-up</dt><dd>{selectedProperty.followUpDate ?? "Needs review"}</dd></div></dl></section>
                <section className="panel signal-card"><p className="overline">Active signals</p><div>{selectedProperty.signals.map((signal) => <span key={signal}>{signal}</span>)}</div></section>
                <section className="panel add-note-card"><p className="overline">Add to timeline</p><label><span className="sr-only">New property note</span><textarea value={noteInput} onChange={(event) => setNoteInput(event.target.value)} placeholder="Type a note about this property..." /></label><button className="primary-action" type="button" onClick={addNote} disabled={!noteInput.trim()}>Add note</button><small>Notes stay in this demo session.</small></section>
              </aside>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
