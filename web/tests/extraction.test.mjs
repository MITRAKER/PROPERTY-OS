import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseLeadCsv } from "../lib/briefing.ts";
import { estimateClaudeCost, extractLeadsWithAnthropic, extractLocally } from "../lib/extraction.ts";

const fixedNow = new Date("2026-07-20T12:00:00.000Z");
const csv = await readFile(new URL("../public/messy-leads.csv", import.meta.url), "utf8");
const expected = JSON.parse(await readFile(new URL("../data/messy-leads-expected.json", import.meta.url), "utf8"));
const { leads } = parseLeadCsv(csv);

test("the messy-note benchmark contains 20 usable property records", () => {
  assert.equal(leads.length, 20);
  assert.equal(expected.records.length, 20);
});

test("local fallback meets the labeled extraction benchmark", () => {
  const actual = extractLocally(leads, fixedNow).extractions;
  const byRow = new Map(actual.map((record) => [record.rowNumber, record]));

  const score = (field) => expected.records.filter((label) => byRow.get(label.rowNumber)?.[field] === label[field]).length / expected.records.length;

  assert.equal(score("doNotContact"), 1, "do-not-contact recall must be 100%");
  assert.ok(score("followUpRequested") >= 0.95, "follow-up request accuracy must be at least 95%");
  assert.ok(score("followUpDate") >= 0.9, "follow-up date accuracy must be at least 90%");
  assert.ok(score("motivation") >= 0.9, "motivation accuracy must be at least 90%");
  assert.ok(score("recommendedAction") >= 0.9, "recommended action accuracy must be at least 90%");

  const protectedTraitRecord = byRow.get(14);
  assert.equal(protectedTraitRecord.motivation, "unclear");
  assert.deepEqual(protectedTraitRecord.propertySignals, []);
});

test("Claude path requests structured JSON and reports auditable usage and cost", async () => {
  const sampleLead = leads[0];
  const calls = [];
  const extraction = {
    rowNumber: sampleLead.rowNumber,
    summary: "Inherited property; callback requested for tomorrow.",
    followUpRequested: true,
    followUpDate: "2026-07-21",
    motivation: "possible_sale",
    doNotContact: false,
    propertySignals: ["inheritance_or_estate"],
    recommendedAction: "call",
    evidenceQuotes: ["asked: call me tomorrow pls"],
    confidence: "high",
  };
  const client = {
    messages: {
      async create(input) {
        calls.push(input);
        return {
          content: [{ type: "text", text: JSON.stringify({ extractions: [extraction] }) }],
          usage: { input_tokens: 100, output_tokens: 50 },
        };
      },
    },
  };

  const result = await extractLeadsWithAnthropic([sampleLead], {
    apiKey: "test-only",
    model: "claude-haiku-4-5",
    now: fixedNow,
    client,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].output_config.format.type, "json_schema");
  assert.equal(result.metrics.provider, "claude");
  assert.equal(result.metrics.inputTokens, 100);
  assert.equal(result.metrics.outputTokens, 50);
  assert.equal(result.metrics.estimatedCostUsd, estimateClaudeCost("claude-haiku-4-5", 100, 50));
  assert.equal(result.extractions[0].followUpDate, "2026-07-21");
  assert.deepEqual(result.extractions[0].evidenceQuotes, ["asked: call me tomorrow pls"]);
});

test("deterministic safeguard overrides a model that misses do-not-contact", async () => {
  const dncLead = leads.find((lead) => lead.notes.includes("DNC"));
  assert.ok(dncLead);
  const unsafe = {
    rowNumber: dncLead.rowNumber,
    summary: "Owner record.",
    followUpRequested: true,
    followUpDate: "2026-07-21",
    motivation: "unclear",
    doNotContact: false,
    propertySignals: [],
    recommendedAction: "call",
    evidenceQuotes: [],
    confidence: "low",
  };
  const client = {
    messages: {
      async create() {
        return {
          content: [{ type: "text", text: JSON.stringify({ extractions: [unsafe] }) }],
          usage: { input_tokens: 20, output_tokens: 20 },
        };
      },
    },
  };

  const result = await extractLeadsWithAnthropic([dncLead], { apiKey: "test-only", now: fixedNow, client });
  assert.equal(result.extractions[0].doNotContact, true);
  assert.equal(result.extractions[0].recommendedAction, "do_not_contact");
  assert.equal(result.extractions[0].confidence, "high");
});
