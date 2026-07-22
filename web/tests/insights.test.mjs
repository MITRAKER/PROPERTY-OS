import assert from "node:assert/strict";
import test from "node:test";
import { sampleProperties } from "../lib/property-model.ts";
import { computeNeighborhoodStats, formatUsd, projectCoordinates } from "../lib/insights.ts";

test("neighborhood stats are computed from real properties, not hardcoded", () => {
  const stats = computeNeighborhoodStats(sampleProperties);
  assert.equal(stats.total, sampleProperties.length);
  assert.ok(stats.inherited >= 1, "should detect at least one inherited/estate property");
  assert.ok(stats.violations >= 1, "should detect at least one violation property");
  assert.match(stats.opportunity, /^\$/, "opportunity should be a formatted dollar value");
  assert.match(stats.averageEquity, /^\$/);
});

test("neighborhood stats degrade gracefully with no value data", () => {
  const stats = computeNeighborhoodStats([
    { ...sampleProperties[0], equity: "Unknown", assessedValue: null, signals: [], summary: "" },
  ]);
  assert.equal(stats.opportunity, "—");
  assert.equal(stats.averageEquity, "—");
});

test("formatUsd renders K/M magnitudes", () => {
  assert.equal(formatUsd(166046328), "$166.0M");
  assert.equal(formatUsd(684000), "$684K");
  assert.equal(formatUsd(500), "$500");
});

test("projectCoordinates places by lat/lon with north at the top", () => {
  const north = { ...sampleProperties[0], id: "n", latitude: 40.9, longitude: -73.9 };
  const south = { ...sampleProperties[1], id: "s", latitude: 40.5, longitude: -73.9 };
  const placed = projectCoordinates([north, south], 100, 100, 10);
  assert.equal(placed.length, 2);
  const northPlaced = placed.find((item) => item.property.id === "n");
  const southPlaced = placed.find((item) => item.property.id === "s");
  assert.ok(northPlaced.y < southPlaced.y, "northern property must render higher (smaller y)");
});

test("projectCoordinates ignores properties without coordinates", () => {
  const placed = projectCoordinates([{ ...sampleProperties[0], latitude: null, longitude: null }], 100, 100);
  assert.equal(placed.length, 0);
});
