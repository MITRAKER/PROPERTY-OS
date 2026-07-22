import assert from "node:assert/strict";
import test from "node:test";
import { boundingBox, looksIndividuallyOwned, scoreCandidate } from "../lib/data/prospecting.ts";

test("boundingBox brackets the point and widens longitude with latitude", () => {
  const box = boundingBox(40.665, -73.735, 250);
  assert.ok(box.minLat < 40.665 && box.maxLat > 40.665);
  assert.ok(box.minLon < -73.735 && box.maxLon > -73.735);
  // At ~40N a degree of longitude is shorter, so the lon span must exceed the lat span.
  assert.ok(box.maxLon - box.minLon > box.maxLat - box.minLat);
});

test("individual owners are distinguished from corporate entities", () => {
  assert.equal(looksIndividuallyOwned("CALVIN, DOREEN A"), true);
  assert.equal(looksIndividuallyOwned("JOSE W. RICHARDS"), true);
  assert.equal(looksIndividuallyOwned("120 BROADWAY CONDO BOARD OF MANGERS"), false);
  assert.equal(looksIndividuallyOwned("ACME HOLDINGS LLC"), false);
  assert.equal(looksIndividuallyOwned("NYC HOUSING AUTHORITY"), false);
});

test("candidate scoring is transparent and favours individually owned small homes", () => {
  const strong = scoreCandidate({ ownerName: "CALVIN, DOREEN A", yearBuilt: 1925, unitsTotal: 1, assessedValue: 60000 });
  const weak = scoreCandidate({ ownerName: "ACME HOLDINGS LLC", yearBuilt: 2015, unitsTotal: 80, assessedValue: 10000 });
  assert.ok(strong.score > weak.score);
  assert.ok(strong.reasons.some((reason) => /individually owned/i.test(reason)));
  assert.ok(strong.reasons.some((reason) => /1-family/i.test(reason)));
  assert.ok(weak.reasons.some((reason) => /company or institution/i.test(reason)));
  // Every candidate must carry at least one stated reason.
  assert.ok(strong.reasons.length > 0 && weak.reasons.length > 0);
});

test("scores stay within 0..100", () => {
  const maxed = scoreCandidate({ ownerName: "SMITH, JOHN", yearBuilt: 1900, unitsTotal: 1, assessedValue: 5_000_000 });
  assert.ok(maxed.score >= 0 && maxed.score <= 100);
});
