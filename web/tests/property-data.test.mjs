import assert from "node:assert/strict";
import test from "node:test";
import { sampleProperties } from "../lib/property-model.ts";
import { contextFromRecord, WorkspacePropertyDataProvider } from "../lib/data/workspace-provider.ts";
import { parseBbl } from "../lib/data/nyc-provider.ts";
import { createPropertyDataProvider } from "../lib/data/provider.ts";
import { analyzePropertyContext } from "../lib/agents/property-intelligence.ts";
import { PUBLIC_RECORD_GAPS } from "../lib/agents/property-context.ts";

const probate = sampleProperties[0]; // sample fixture: inherited/probate property

test("workspace provider normalizes a property record into a PropertyContext", async () => {
  const provider = new WorkspacePropertyDataProvider([probate]);
  const context = await provider.getByAddress(probate.address);
  assert.equal(context.provenance, "workspace");
  assert.equal(context.propertyId, probate.id);
  assert.ok(context.publicSignals.length > 0);
  assert.ok(context.crmTimeline.length > 0);
  // Public records structurally cannot supply these; they must be flagged missing.
  for (const gap of PUBLIC_RECORD_GAPS) assert.ok(context.missingInformation.includes(gap));
});

test("the agent analyzes context with evidence and never invents phone/email/consent", () => {
  const context = contextFromRecord(probate);
  const { report, run } = analyzePropertyContext(context);
  assert.equal(report.propertyId, probate.id);
  assert.ok(report.signals.length > 0);
  // Every signal must cite evidence and a source.
  for (const signal of report.signals) {
    assert.ok(signal.evidence.length > 0);
    assert.ok(signal.source.length > 0);
  }
  // The agent must not fabricate contact data as a signal.
  const text = JSON.stringify(report.signals).toLowerCase();
  assert.ok(!text.includes("phone"));
  assert.ok(!text.includes("email"));
  assert.ok(report.missingInformation.includes("phone_number"));
  assert.equal(run.provider, "local_fallback");
});

test("the agent flags an overdue follow-up from CRM timeline as high priority", () => {
  const context = contextFromRecord({
    ...probate,
    signals: [],
    timeline: [{ date: "2026-06-01", title: "Call note", detail: "Owner asked me to call back after July.", type: "call" }],
  });
  const { report } = analyzePropertyContext(context);
  assert.ok(report.signals.some((signal) => signal.type === "follow_up_commitment"));
  assert.equal(report.recommendedPriority, "high");
});

test("agent maps ACRIS deeds/mortgages and DOB permits to typed evidence", () => {
  const context = {
    propertyId: "x",
    address: "1 Test Street",
    bbl: null,
    bin: null,
    coordinates: null,
    facts: {},
    publicSignals: [
      { type: "recorded_document", source: "NYC ACRIS", description: "Mortgage (MTGE) recorded 2020-01-01 — $500,000" },
      { type: "recorded_document", source: "NYC ACRIS", description: "Satisfaction of mortgage (SAT) recorded 2024-01-01" },
      { type: "recorded_document", source: "NYC ACRIS", description: "Deed (DEED) recorded 2005-01-01" },
      { type: "permit", source: "NYC DOB", description: "DOB EW permit (ISSUED) — OT" },
    ],
    crmTimeline: [],
    sources: [],
    missingInformation: [],
    provenance: "nyc_open_data",
  };
  const types = analyzePropertyContext(context).report.signals.map((signal) => signal.type);
  // "Satisfaction of mortgage" must not be misread as a plain mortgage.
  assert.ok(types.includes("mortgage_satisfied"));
  assert.ok(types.includes("recorded_mortgage"));
  assert.ok(types.includes("ownership_transfer"));
  assert.ok(types.includes("permit_or_repair_issue"));
});

test("BBL parsing splits borough (1) + block (5) + lot (4)", () => {
  // 120 Broadway = Manhattan block 47, condo billing lot 7501.
  assert.deepEqual(parseBbl("1000477501"), { borough: "1", block: 47, lot: 7501 });
  // Brooklyn block 1234, lot 56.
  assert.deepEqual(parseBbl("3012340056"), { borough: "3", block: 1234, lot: 56 });
  assert.equal(parseBbl("bad"), null);
});

test("the provider factory swaps the data source without changing the agent", () => {
  assert.equal(createPropertyDataProvider("workspace").name, "workspace");
  assert.equal(createPropertyDataProvider("nyc").name, "nyc");
  assert.equal(createPropertyDataProvider(undefined).name, "workspace");
});
