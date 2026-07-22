import assert from "node:assert/strict";
import test from "node:test";
import { compareAddresses, normalizeAddress } from "../lib/data/owner-mailing.ts";

test("address normalisation canonicalises punctuation, case and street words", () => {
  assert.equal(normalizeAddress("2361 Broadway."), "2361 BROADWAY");
  assert.equal(normalizeAddress("99 Park Avenue"), "99 PARK AVE");
  assert.equal(normalizeAddress("140-06 241 Street"), "140-06 241 ST");
  assert.equal(normalizeAddress("123  Main   St"), "123 MAIN ST");
});

test("ordinals are stripped before street words are abbreviated", () => {
  // "1ST STREET" must not collapse ambiguously — ordinal first, then STREET -> ST.
  assert.equal(normalizeAddress("1ST STREET"), "1 ST");
  assert.equal(normalizeAddress("West 42nd Street"), "W 42 ST");
});

test("owner mailing at the property means NOT absentee", () => {
  const verdict = compareAddresses("2361 BROADWAY", { mailingAddress: "2361 Broadway", city: "New York", state: "NY" });
  assert.equal(verdict.absentee, false);
  assert.match(verdict.reason, /owner-occupied/i);
});

test("a different mailing address flags an absentee owner", () => {
  const verdict = compareAddresses("2361 BROADWAY", { mailingAddress: "99 PARK AVENUE", city: "New York", state: "NY" });
  assert.equal(verdict.absentee, true);
  assert.equal(verdict.outOfState, false);
  assert.match(verdict.reason, /99 PARK AVENUE/);
});

test("an out-of-state owner is called out specifically", () => {
  const verdict = compareAddresses("139-23 243 STREET", { mailingAddress: "500 Ocean Dr", city: "Miami", state: "FL" });
  assert.equal(verdict.absentee, true);
  assert.equal(verdict.outOfState, true);
  assert.match(verdict.reason, /out-of-state/i);
});

test("a missing mailing address never falsely claims absentee", () => {
  const verdict = compareAddresses("1 Test St", { mailingAddress: "" });
  assert.equal(verdict.absentee, false);
  assert.match(verdict.reason, /not on record/i);
});
