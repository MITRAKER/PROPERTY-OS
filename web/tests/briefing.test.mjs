import assert from "node:assert/strict";
import test from "node:test";
import { generateBriefing, parseLeadCsv } from "../lib/briefing.ts";

const csv = `address,owner_name,last_contact,follow_up_date,notes
123 Main Street,Sara Patel,2026-06-20,2026-07-10,"Asked me to call back. She inherited the property and may sell."
45 Farmers Boulevard,David Chen,2026-07-01,2026-07-15,"Open violation. Owner asked me to follow up."
88 Linden Avenue,Elena Ruiz,2026-05-01,2026-07-18,"Estate is in probate and family wants a listing proposal."
17 Hillside Road,Marcus Green,2026-07-17,,"No selling timeline yet."
,Missing Address,2026-07-01,2026-07-12,"Call back"`;

test("imports valid property records and reports invalid rows", () => {
  const result = parseLeadCsv(csv);
  assert.equal(result.leads.length, 4);
  assert.deepEqual(result.rejectedRows, [{ rowNumber: 6, reason: "Missing property address" }]);
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

test("rejects a file without the required columns", () => {
  assert.throws(
    () => generateBriefing("owner,phone\nA,555-0000", new Date("2026-07-19T12:00:00Z")),
    /must include address and notes/i,
  );
});
