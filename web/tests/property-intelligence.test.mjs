import assert from "node:assert/strict";
import test from "node:test";
import {
  PROTECTED_ATTRIBUTE_KEYS,
  scoreProperty,
  selectTopPriorities,
  signalDefinitions,
} from "../lib/property-intelligence.ts";

const now = new Date("2026-07-19T12:00:00.000Z");

function makeLead(overrides = {}) {
  return {
    address: "123 Main Street",
    ownerName: "Sara Patel",
    lastContact: "2026-06-20",
    followUpDate: "2026-07-10",
    notes: "Ask to call back. Inherited and may sell.",
    rowNumber: 2,
    ...overrides,
  };
}

function makeExtraction(overrides = {}) {
  return {
    rowNumber: 2,
    summary: "Owner inherited and may sell.",
    followUpRequested: true,
    followUpDate: "2026-07-10",
    motivation: "possible_sale",
    doNotContact: false,
    propertySignals: ["inheritance_or_estate"],
    recommendedAction: "call",
    evidenceQuotes: ["inherited", "call me tomorrow"],
    confidence: "high",
    ...overrides,
  };
}

test("scoreProperty is deterministic for the same inputs", () => {
  const lead = makeLead();
  const extraction = makeExtraction();
  const first = scoreProperty(lead, extraction, now);
  const second = scoreProperty(lead, extraction, now);
  assert.equal(first.score, second.score);
  assert.deepEqual(first.reasons, second.reasons);
  assert.deepEqual(first.evidence, second.evidence);
});

test("overdue follow-up outranks a quiet lead with no follow-up date", () => {
  const overdue = scoreProperty(makeLead(), makeExtraction(), now);
  const quiet = scoreProperty(
    makeLead({ address: "99 Quiet Lane", lastContact: "2026-07-18", followUpDate: "" }),
    makeExtraction({
      rowNumber: 3,
      followUpRequested: false,
      followUpDate: null,
      motivation: "unclear",
      propertySignals: [],
      recommendedAction: "review",
      evidenceQuotes: ["no timeline"],
    }),
    now,
  );

  assert.ok(overdue.score > quiet.score);
  assert.match(overdue.headline, /overdue/i);
});

test("selectTopPriorities never includes do-not-contact records", () => {
  const priorities = selectTopPriorities(
    [
      {
        lead: makeLead({ address: "1 DNC Road", ownerName: "Do Not Call" }),
        extraction: makeExtraction({
          doNotContact: true,
          recommendedAction: "do_not_contact",
          followUpDate: "2026-07-01",
          propertySignals: ["inheritance_or_estate"],
        }),
      },
      {
        lead: makeLead({ address: "2 Open Road", ownerName: "Open Lead", rowNumber: 3 }),
        extraction: makeExtraction({ rowNumber: 3, followUpDate: "2026-07-15" }),
      },
    ],
    now,
    3,
  );

  assert.equal(priorities.length, 1);
  assert.equal(priorities[0].address, "2 Open Road");
  assert.equal(priorities[0].rank, 1);
});

test("scoring only uses permitted signal definitions (Phase-1 note signals)", () => {
  const allowed = new Set(Object.keys(signalDefinitions));
  for (const key of allowed) {
    assert.equal(typeof signalDefinitions[key].points, "number");
    assert.ok(signalDefinitions[key].reason.length > 0);
  }

  // Unknown / public-record-only labels must not add points until Phase 3 wiring exists.
  const withUnknown = scoreProperty(
    makeLead(),
    makeExtraction({ propertySignals: ["inheritance_or_estate", "acris_deed_transfer"] }),
    now,
  );
  const withoutUnknown = scoreProperty(
    makeLead(),
    makeExtraction({ propertySignals: ["inheritance_or_estate"] }),
    now,
  );
  assert.equal(withUnknown.score, withoutUnknown.score);
});

test("protected attribute keys are documented and never part of signalDefinitions", () => {
  const signalKeys = new Set(Object.keys(signalDefinitions));
  for (const key of PROTECTED_ATTRIBUTE_KEYS) {
    assert.equal(signalKeys.has(key), false, `${key} must not be a ranking signal`);
  }
});
