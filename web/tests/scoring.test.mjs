import assert from "node:assert/strict";
import test from "node:test";
import { sampleProperties } from "../lib/property-model.ts";
import { explainScore, SCORE_BASE, SCORING_VERSION } from "../lib/scoring.ts";

const now = new Date("2026-07-21T12:00:00.000Z");

test("scoring is transparent: every property gets a breakdown and a version", () => {
  const result = explainScore(sampleProperties[0], now);
  assert.equal(result.version, SCORING_VERSION);
  assert.equal(result.base, SCORE_BASE);
  assert.ok(Array.isArray(result.breakdown));
  assert.ok(result.score >= 0 && result.score <= 100);
});

test("an overdue inherited property scores higher than a review-only property", () => {
  const strong = explainScore(
    { ...sampleProperties[0], status: "inherited", statusLabel: "Probate", signals: ["Probate", "31 years owned"], followUpDate: "2026-07-10", ownershipYears: 31, summary: "estate in probate" },
    now,
  );
  const weak = explainScore(
    { ...sampleProperties[0], status: "review", statusLabel: "Needs review", signals: [], followUpDate: null, ownershipYears: 2, summary: "verify details" },
    now,
  );
  assert.ok(strong.score > weak.score);
  assert.ok(strong.breakdown.some((factor) => /overdue/i.test(factor.detail)));
  assert.ok(strong.breakdown.some((factor) => /estate/i.test(factor.detail)));
});

test("scores are clamped to 0..100", () => {
  const maxed = explainScore(
    { ...sampleProperties[0], signals: ["Probate", "Violation", "Tax lien", "Vacant", "Absentee", "Expired listing"], followUpDate: "2026-06-01", ownershipYears: 40, assessedValue: 900000, summary: "estate probate violation lien vacant absentee offer" },
    now,
  );
  assert.ok(maxed.score <= 100);
});
