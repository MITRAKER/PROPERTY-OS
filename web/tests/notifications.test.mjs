import assert from "node:assert/strict";
import test from "node:test";
import { buildIcs, escapeIcsText, foldIcsLine, isIsoDate } from "../lib/calendar/ics.ts";
import { buildLetterHtml, escapeHtml, toParagraphs } from "../lib/outreach/letter.ts";

test("ICS escapes the characters RFC 5545 reserves", () => {
  assert.equal(escapeIcsText("Call Smith, Jr.; ASAP"), "Call Smith\\, Jr.\\; ASAP");
  assert.equal(escapeIcsText("line1\nline2"), "line1\\nline2");
  assert.equal(escapeIcsText("back\\slash"), "back\\\\slash");
});

test("ICS folds long content lines at 75 octets", () => {
  const folded = foldIcsLine(`SUMMARY:${"x".repeat(200)}`);
  const lines = folded.split("\r\n");
  assert.ok(lines.length > 1, "a long line must be folded");
  assert.ok(lines[0].length <= 75);
  // Continuation lines must begin with a single space.
  for (const line of lines.slice(1)) assert.ok(line.startsWith(" "));
});

test("buildIcs produces a valid all-day event with an alarm", () => {
  const ics = buildIcs([
    { uid: "task-1@property-os", title: "Follow up with Sara Patel", date: "2026-07-21", location: "123 Main Street", alarmMinutesBefore: 30 },
  ]);
  assert.match(ics, /^BEGIN:VCALENDAR/);
  assert.match(ics, /END:VCALENDAR$/);
  assert.match(ics, /BEGIN:VEVENT/);
  assert.match(ics, /DTSTART;VALUE=DATE:20260721/);
  // All-day events end on the following day.
  assert.match(ics, /DTEND;VALUE=DATE:20260722/);
  assert.match(ics, /SUMMARY:Follow up with Sara Patel/);
  assert.match(ics, /TRIGGER:-PT30M/);
  assert.match(ics, /\r\n/, "ICS must use CRLF line endings");
});

test("buildIcs skips entries without a real date", () => {
  const ics = buildIcs([{ uid: "a", title: "No date", date: "Today" }]);
  assert.doesNotMatch(ics, /BEGIN:VEVENT/);
});

test("isIsoDate only accepts YYYY-MM-DD", () => {
  assert.equal(isIsoDate("2026-07-21"), true);
  assert.equal(isIsoDate("Today"), false);
  assert.equal(isIsoDate(null), false);
});

test("letter escapes HTML so owner data cannot inject markup", () => {
  assert.equal(escapeHtml('<script>alert("x")</script>'), "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  const html = buildLetterHtml({
    ownerName: "<img src=x onerror=1>",
    propertyAddress: "1 Test St",
    body: "Hello",
    agentName: "Agent",
  });
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x/);
});

test("letter renders paragraphs, recipient and a print action", () => {
  const html = buildLetterHtml({
    ownerName: "Marlene Thomas-Francois",
    propertyAddress: "139-23 243 Street",
    body: "First paragraph.\n\nSecond paragraph.",
    agentName: "Mitra K.",
    agentEmail: "mitra@example.com",
  });
  assert.match(html, /Marlene Thomas-Francois/);
  assert.match(html, /139-23 243 Street/);
  assert.match(html, /<p>First paragraph\.<\/p>/);
  assert.match(html, /<p>Second paragraph\.<\/p>/);
  assert.match(html, /window\.print\(\)/);
  assert.match(html, /mitra@example\.com/);
  // Must state that nothing was sent electronically.
  assert.match(html, /Nothing was sent electronically/i);
});

test("toParagraphs splits on blank lines and drops empties", () => {
  assert.deepEqual(toParagraphs("a\n\nb\n\n\n c "), ["a", "b", "c"]);
  assert.deepEqual(toParagraphs("   "), []);
});
