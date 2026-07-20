"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import type { BriefingResult } from "../lib/briefing";

function formatDate(value: string | null) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function providerName(briefing: BriefingResult) {
  if (briefing.metrics.provider === "local_fallback") return "Local extraction fallback";
  if (briefing.metrics.model.includes("haiku-4-5")) return "Claude Haiku 4.5";
  return briefing.metrics.model;
}

function costLabel(value: number) {
  if (value === 0) return "$0.0000";
  return `$${value.toFixed(4)}`;
}

export default function Home() {
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState("");
  const [briefing, setBriefing] = useState<BriefingResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [audioState, setAudioState] = useState<"idle" | "playing" | "paused">("idle");
  const [speechSupported, setSpeechSupported] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

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

  const audioScript = useMemo(() => {
    if (!briefing) return "";
    const intro = `Good morning. Property OS reviewed ${briefing.importedCount} property records. Here are today's ${briefing.priorities.length} priorities.`;
    const properties = briefing.priorities.map((priority) =>
      `Priority ${priority.rank}. ${priority.address}, owner ${priority.ownerName}. ${priority.headline}. ${priority.recommendedAction}`,
    );
    const close = briefing.manualReviewCount > 0
      ? `${briefing.manualReviewCount} records need manual review. No outreach has been sent.`
      : "No outreach has been sent.";
    return [intro, ...properties, close].join(" ");
  }, [briefing]);

  useEffect(() => {
    const supportCheck = window.setTimeout(() => setSpeechSupported("speechSynthesis" in window), 0);
    return () => {
      window.clearTimeout(supportCheck);
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    stopAudio();
    setError("");
    setBriefing(null);
    setFileName(file.name);
    setCsvText(await file.text());
  }

  async function useDemoLeads() {
    stopAudio();
    setError("");
    setBriefing(null);
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
    stopAudio();
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

  function playAudio() {
    if (!audioScript || !speechSupported) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(audioScript);
    utterance.rate = 0.96;
    utterance.pitch = 1;
    utterance.onend = () => setAudioState("idle");
    utterance.onerror = () => setAudioState("idle");
    utteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
    setAudioState("playing");
  }

  function pauseAudio() {
    if (!speechSupported || audioState !== "playing") return;
    window.speechSynthesis.pause();
    setAudioState("paused");
  }

  function resumeAudio() {
    if (!speechSupported || audioState !== "paused") return;
    window.speechSynthesis.resume();
    setAudioState("playing");
  }

  function stopAudio() {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    utteranceRef.current = null;
    setAudioState("idle");
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
            Import property leads. Property OS extracts messy notes, protects do-not-contact
            records, and returns the three properties that deserve attention now.
          </p>

          <div className="promise-row" aria-label="Product promises">
            <span>Evidence shown</span>
            <span>Do-not-contact protected</span>
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

          <div className="demo-actions">
            <button className="text-button" type="button" onClick={useDemoLeads}>
              Use 20 messy demo leads
            </button>
            <a className="text-link" href="/messy-leads.csv" download>Download sample CSV</a>
          </div>

          {error && <p className="error-message" role="alert">{error}</p>}

          <button className="primary-button" type="button" onClick={generate} disabled={!csvText || loading}>
            {loading ? "Extracting and ranking..." : "Generate morning briefing"}
            <span aria-hidden="true">-&gt;</span>
          </button>

          <p className="privacy-note">No message or call is sent. The agent reviews every recommendation.</p>
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
              {briefing.rejectedRows.length > 0 && <span> / {briefing.rejectedRows.length} skipped</span>}
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
            <div className="result-toolbar">
              <div>
                <p className="generated-time">Generated {generatedLabel}</p>
                <span className={`provider-badge ${briefing.metrics.provider}`} data-testid="provider-badge">
                  {providerName(briefing)}
                </span>
              </div>
              <div className="audio-controls" aria-label="Audio briefing controls">
                <span>Audio briefing</span>
                {audioState === "idle" && <button type="button" onClick={playAudio} disabled={!speechSupported}>Play</button>}
                {audioState === "playing" && <button type="button" onClick={pauseAudio}>Pause</button>}
                {audioState === "paused" && <button type="button" onClick={resumeAudio}>Resume</button>}
                <button type="button" onClick={stopAudio} disabled={audioState === "idle"}>Stop</button>
              </div>
            </div>

            {briefing.metrics.warning && <p className="run-warning" role="status">{briefing.metrics.warning}</p>}

            <div className="metrics-grid" data-testid="run-metrics">
              <div><span>Latency</span><strong>{briefing.metrics.latencyMs.toLocaleString()} ms</strong></div>
              <div><span>Tokens</span><strong>{(briefing.metrics.inputTokens + briefing.metrics.outputTokens).toLocaleString()}</strong></div>
              <div><span>Est. API cost</span><strong>{costLabel(briefing.metrics.estimatedCostUsd)}</strong></div>
              <div><span>Manual review</span><strong>{briefing.manualReviewCount}</strong></div>
              <div><span>DNC excluded</span><strong>{briefing.doNotContactCount}</strong></div>
              <div><span>Opus fallbacks</span><strong>{briefing.metrics.fallbackCount}</strong></div>
            </div>

            <div className="priority-grid" data-testid="priority-grid">
              {briefing.priorities.map((priority) => (
                <article className="priority-card" key={priority.address} data-rank={priority.rank}>
                  <div className="card-topline">
                    <span className="rank">0{priority.rank}</span>
                    <span className={`confidence-pill ${priority.confidence}`}>{priority.confidence} confidence</span>
                  </div>
                  <h3>{priority.address}</h3>
                  <p className="owner-name">{priority.ownerName}</p>
                  <p className="headline">{priority.headline}</p>

                  <dl className="date-grid">
                    <div><dt>Last contact</dt><dd>{formatDate(priority.lastContact)}</dd></div>
                    <div><dt>Follow-up</dt><dd>{formatDate(priority.followUpDate)}</dd></div>
                  </dl>

                  <div className="card-section">
                    <h4>Why it surfaced</h4>
                    <ul>{priority.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
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
        <span>Property OS / Property-centered intelligence</span>
        <span>Recommendations require agent review before action.</span>
      </footer>
    </main>
  );
}
