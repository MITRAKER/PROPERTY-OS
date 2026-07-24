import assert from "node:assert/strict";
import test from "node:test";
import { generateBriefing, parseLeadCsv } from "../lib/briefing.ts";

const csv = `address,owner_name,last_contact,follow_up_date,notes
123 Main Street,Sara Patel,2026-06-20,2026-07-10,"Asked me to call back. She inherited the property and may sell."
45 Farmers Boulevard,David Chen,2026-07-01,2026-07-15,"Open violation. Owner asked me to follow up."
88 Linden Avenue,Elena Ruiz,2026-05-01,2026-07-18,"Estate is in probate and family wants a listing proposal."
17 Hillside Road,Marcus Green,2026-07-17,,"No selling timeline yet."`;

test("imports every property record with no rejections", () => {
  const result = parseLeadCsv(csv);
  assert.equal(result.leads.length, 4);
  assert.deepEqual(result.rejectedRows, []);
});

test("returns a real evidence-backed top-three briefing", () => {
  const now = new Date("2026-07-19T12:00:00.000Z");
  const result = generateBriefing(csv, now);

  assert.equal(result.importedCount, 4);
  assert.equal(result.priorities.length, 3);
  assert.deepEqual(result.priorities.map((item) => item.address), [
    "123 Main Street",
    "88 Linden Avenue",
    "45 Farmers Boulevard",
  ]);
  assert.equal(result.priorities[0].rank, 1);
  assert.match(result.priorities[0].headline, /overdue/i);
  assert.match(result.priorities[0].evidence[0], /inherited/i);
  assert.match(result.priorities[0].recommendedAction, /Call Sara Patel today/i);
});

test("recognises unfamiliar column names instead of demanding fixed ones", () => {
  const { leads } = parseLeadCsv(
    ["Property Address,Seller,Comments", '2361 Broadway,Sara Patel,"Inherited the building and may sell."'].join("\n"),
  );
  assert.equal(leads.length, 1);
  assert.equal(leads[0].address, "2361 Broadway");
  assert.equal(leads[0].ownerName, "Sara Patel");
  assert.match(leads[0].notes, /Inherited/);
});

test("imports a file that has no notes column at all", () => {
  const { leads } = parseLeadCsv("address,owner\n12 Hillside Road,Marcus Green");
  assert.equal(leads.length, 1);
  assert.equal(leads[0].notes, "", "missing notes must not reject the row");
  assert.equal(leads[0].ownerName, "Marcus Green");
});

test("imports a CSV with no header row by reading the data itself", () => {
  const { leads } = parseLeadCsv('88 Linden Avenue,Elena Ruiz,"Estate is in probate and the family wants a proposal."');
  assert.equal(leads.length, 1);
  assert.equal(leads[0].address, "88 Linden Avenue");
  assert.equal(leads[0].ownerName, "Elena Ruiz");
  assert.match(leads[0].notes, /probate/);
});

test("infers the address column when the header is unrecognisable", () => {
  const { leads } = parseLeadCsv("col_a,col_b\n45 Farmers Boulevard,David Chen");
  assert.equal(leads.length, 1);
  assert.equal(leads[0].address, "45 Farmers Boulevard");
  assert.equal(leads[0].ownerName, "David Chen");
});

test("imports any file — no column rules — and hands unknown columns to the agent", () => {
  // Even with no obvious address column, the file is accepted rather than rejected.
  const { leads } = parseLeadCsv("owner,phone,status\nSara Patel,555-0000,hot lead");
  assert.equal(leads.length, 1);
  assert.equal(leads[0].ownerName, "Sara Patel");
  // The unrecognized columns become notes context so nothing is discarded.
  assert.match(leads[0].notes, /hot lead/);
  // A row whose chosen address cell is blank still imports (never rejected).
  const { leads: blanks } = parseLeadCsv("address,notes\n,Call back next week");
  assert.equal(blanks.length, 1);
  assert.match(blanks[0].notes, /Call back/);
});
