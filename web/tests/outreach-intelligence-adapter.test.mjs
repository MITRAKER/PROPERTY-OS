import assert from "node:assert/strict";
import test from "node:test";
import { prepareOutreach } from "../lib/outreach.ts";
import {
  buildOutreachRequest,
  permissionsFromFollowUp,
  propertyContextFromIntelligence,
  relationshipContextFromFollowUp,
} from "../lib/outreach-intelligence-adapter.ts";

test("maps Property Intelligence signals into flat evidence facts", () => {
  const propertyContext = propertyContextFromIntelligence({
    address: "45 Farmers Boulevard",
    ownerName: "David Chen",
    signals: [
      { type: "new_violation", evidence: "Class C violation added 12 days ago", source: "NYC HPD" },
      { type: "ownership_length", evidence: "27 years of ownership", source: "property_record" },
    ],
  });

  assert.equal(propertyContext.address, "45 Farmers Boulevard");
  assert.deepEqual(propertyContext.facts, [
    "Class C violation added 12 days ago",
    "27 years of ownership",
  ]);
});

test("maps Follow-Up evidenceQuotes and sentiment into relationship context", () => {
  const relationshipContext = relationshipContextFromFollowUp({
    summary: "Owner wants to reconnect after her daughter's graduation.",
    sentiment: "open_but_not_ready",
    evidenceQuotes: ["Call me after June", "daughter is graduating"],
  });

  assert.equal(relationshipContext.lastConversation, "Call me after June");
  assert.deepEqual(relationshipContext.notes, ["Call me after June", "daughter is graduating"]);
  assert.equal(relationshipContext.relationshipStatus, "open_but_not_ready");
});

test("falls back to the summary when Follow-Up has no evidence quotes", () => {
  const relationshipContext = relationshipContextFromFollowUp({
    summary: "No prior conversation on file.",
  });

  assert.equal(relationshipContext.lastConversation, "No prior conversation on file.");
  assert.equal(relationshipContext.notes, undefined);
});

test("Follow-Up do-not-contact can only turn permissions on, never override it off", () => {
  const turnedOn = permissionsFromFollowUp({ doNotContact: true }, { doNotContact: false, emailAllowed: true });
  assert.equal(turnedOn.doNotContact, true);

  const staysOn = permissionsFromFollowUp({ doNotContact: false }, { doNotContact: true, emailAllowed: true });
  assert.equal(staysOn.doNotContact, true);
});

test("end to end: Follow-Up do-not-contact blocks outreach even when the CRM permission flag allows it", () => {
  const request = buildOutreachRequest({
    propertyId: "property-001",
    channel: "email",
    propertyIntelligence: {
      address: "123 Main Street",
      ownerName: "Mrs. Smith",
      signals: [{ evidence: "Owner requested a follow-up after June." }],
    },
    followUp: { summary: "Asked us to reconnect after June.", doNotContact: true },
    permissions: { doNotContact: false, emailAllowed: true },
  });

  const result = prepareOutreach(request);
  assert.equal(result.allowed, false);
  assert.equal(result.message, null);
});

test("end to end: builds a compliant, evidence-backed draft from intelligence and follow-up output", () => {
  const request = buildOutreachRequest({
    propertyId: "property-001",
    channel: "email",
    propertyIntelligence: {
      address: "123 Main Street",
      ownerName: "Mrs. Smith",
      signals: [{ evidence: "Owner requested a follow-up after June." }],
    },
    followUp: { summary: "Asked us to reconnect after June.", evidenceQuotes: ["Asked us to reconnect after June."] },
    permissions: { doNotContact: false, emailAllowed: true },
  });

  const result = prepareOutreach(request);
  assert.equal(result.allowed, true);
  assert.match(result.message, /Asked us to reconnect after June\./);
  assert.ok(result.evidenceUsed.some((item) => item.includes("Owner requested a follow-up after June.")));
});
