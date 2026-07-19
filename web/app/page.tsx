"use client";

import { ChangeEvent, useMemo, useState } from "react";
import type { BriefingResult } from "../lib/briefing";

const demoCsv = `address,owner_name,last_contact,follow_up_date,notes
123 Main Street,Sara Patel,2026-06-20,2026-07-10,"Asked me to call back after July 4. She inherited the house and is considering selling this summer."
45 Farmers Boulevard,David Chen,2026-06-01,2026-07-15,"Owner mentioned an open DOB violation and asked me to follow up with possible options."
88 Linden Avenue,Elena Ruiz,2026-05-12,2026-07-18,"Estate is in probate. Family wants to review a listing proposal once paperwork is organized."
17 Hillside Road,Marcus Green,2026-07-12,2026-07-28,"Met at a community event. Curious about neighborhood values but no selling timeline yet."
302 Beach 44th Street,Nadia Williams,2026-07-02,,"Absentee owner. Rental is currently occupied and they may consider an offer next year."`;

function formatDate(value: string | null) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

export default function Home() {
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState("");
  const [briefing, setBriefing] = useState<BriefingResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const generatedLabel = useMemo(() => {
    if (!briefing) return "";
    return new Intl.DateTimeFormat("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(briefing.generatedAt));
  }, [briefing]);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setError("");
    setBriefing(null);
    setFileName(file.name);
    setCsvText(await file.text());
  }

  function useDemoLeads() {
    setCsvText(demoCsv);
    setFileName("property-os-demo-leads.csv");
    setBriefing(null);
    setError("");
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
    } catch (caughtError) {
      setBriefing(null);
      setError(caughtError instanceof Error ? caughtError.message : "The briefing could not be generated.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Property OS home">
          <span className="brand-mark">P</span>
          <span>Property OS</span>
        </a>
        <span className="build-label">Morning Briefing MVP</span>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">One list. Three priorities. Clear evidence.</p>
          <h1>Turn forgotten follow-ups into today&apos;s first calls.</h1>
          <p className="hero-description">
            Import your property leads. Property OS reads the notes, checks follow-up timing,
            and returns the three records that deserve attention now.
          </p>

          <div className="promise-row" aria-label="Product promises">
            <span>Evidence shown</span>
            <span>No opaque score</span>
            <span>No automatic outreach</span>
          </div>
        </div>

        <div className="import-panel" aria-labelledby="import-title">
          <div className="panel-heading">
            <span className="step-number">01</span>
            <div>
              <p className="panel-kicker">Start the briefing</p>
              <h2 id="import-title">Import property leads</h2>
            </div>
          </div>

          <label className="upload-zone" htmlFor="lead-file">
            <span className="upload-icon">CSV</span>
            <strong>{fileName || "Choose a lead file"}</strong>
            <span>Required: address and notes</span>
            <input id="lead-file" data-testid="lead-file" type="file" accept=".csv,text/csv" onChange={handleFile} />
          </label>

          <button className="text-button" type="button" onClick={useDemoLeads}>
            Use demo leads instead
          </button>

          {error && <p className="error-message" role="alert">{error}</p>}

          <button
            className="primary-button"
            type="button"
            onClick={generate}
            disabled={!csvText || loading}
          >
            {loading ? "Analyzing records…" : "Generate morning briefing"}
            <span aria-hidden="true">→</span>
          </button>

          <p className="privacy-note">Your CSV is processed only to produce this briefing.</p>
        </div>
      </section>

      <section className="briefing-section" aria-live="polite">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Today&apos;s call plan</p>
            <h2>Your top three properties</h2>
          </div>
          {briefing && (
            <div className="import-summary">
              <strong>{briefing.importedCount}</strong> records imported
              {briefing.rejectedRows.length > 0 && <span> · {briefing.rejectedRows.length} skipped</span>}
            </div>
          )}
        </div>

        {!briefing ? (
          <div className="empty-state">
            <div className="empty-rank">01</div>
            <div className="empty-rank">02</div>
            <div className="empty-rank">03</div>
            <p>Your evidence-backed call list will appear here.</p>
          </div>
        ) : (
          <>
            <p className="generated-time">Generated {generatedLabel}</p>
            <div className="priority-grid" data-testid="priority-grid">
              {briefing.priorities.map((priority) => (
                <article className="priority-card" key={priority.address} data-rank={priority.rank}>
                  <div className="card-topline">
                    <span className="rank">0{priority.rank}</span>
                    <span className="priority-pill">Call priority</span>
                  </div>
                  <h3>{priority.address}</h3>
                  <p className="owner-name">{priority.ownerName}</p>
                  <p className="headline">{priority.headline}</p>

                  <dl className="date-grid">
                    <div>
                      <dt>Last contact</dt>
                      <dd>{formatDate(priority.lastContact)}</dd>
                    </div>
                    <div>
                      <dt>Follow-up</dt>
                      <dd>{formatDate(priority.followUpDate)}</dd>
                    </div>
                  </dl>

                  <div className="card-section">
                    <h4>Why it surfaced</h4>
                    <ul>
                      {priority.reasons.map((reason) => <li key={reason}>{reason}</li>)}
                    </ul>
                  </div>

                  <div className="evidence-block">
                    <span>Source evidence</span>
                    <p>{priority.evidence[0]}</p>
                  </div>

                  <div className="next-action">
                    <span>Recommended next action</span>
                    <p>{priority.recommendedAction}</p>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </section>

      <footer>
        <span>Property OS · Property-centered intelligence</span>
        <span>Recommendations require agent review before action.</span>
      </footer>
    </main>
  );
}
