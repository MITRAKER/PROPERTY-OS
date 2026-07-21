import assert from "node:assert/strict";
import test from "node:test";
import { prepareOutreach } from "../lib/outreach.ts";

const baseRequest = {
  propertyId: "property-001",
  channel: "email",
  propertyContext: { address: "123 Main Street", ownerName: "Mrs. Smith" },
  relationshipContext: { lastConversation: "Asked us to reconnect after June." },
  permissions: { doNotContact: false, emailAllowed: true },
};

test("drafts an allowed email using only the evidence provided", () => {
  const result = prepareOutreach(baseRequest);

  assert.equal(result.allowed, true);
  assert.equal(result.approvalRequired, true);
  assert.equal(result.subject, "Following up about 123 Main Street");
  assert.match(result.message, /Mrs\. Smith/);
  assert.match(result.message, /Asked us to reconnect after June\./);
  assert.deepEqual(result.complianceWarnings, []);
  assert.equal(result.evidenceUsed.length, 1);
  assert.match(result.evidenceUsed[0], /Asked us to reconnect after June\./);
});

test("blocks do-not-contact records and returns no message", () => {
  const result = prepareOutreach({
    ...baseRequest,
    channel: "phone",
    permissions: { doNotContact: true },
  });

  assert.deepEqual(result, {
    propertyId: "property-001",
    channel: "phone",
    allowed: false,
    approvalRequired: false,
    subject: null,
    message: null,
    complianceWarnings: ["The record is marked do not contact."],
    evidenceUsed: [],
  });
});

test("blocks a channel with no documented permission, even without do-not-contact", () => {
  const result = prepareOutreach({
    ...baseRequest,
    channel: "text",
    permissions: { doNotContact: false },
  });

  assert.equal(result.allowed, false);
  assert.equal(result.message, null);
  assert.match(result.complianceWarnings[0], /No documented permission for text outreach\./);
});

test("blocks when consent is explicitly withheld even if the channel is allowed", () => {
  const result = prepareOutreach({
    ...baseRequest,
    permissions: { doNotContact: false, emailAllowed: true, consentOnFile: false },
  });

  assert.equal(result.allowed, false);
  assert.match(result.complianceWarnings[0], /No documented consent on file for email outreach\./);
});

test("letters default to allowed without an explicit permission flag", () => {
  const result = prepareOutreach({
    ...baseRequest,
    channel: "letter",
    permissions: { doNotContact: false },
  });

  assert.equal(result.allowed, true);
  assert.match(result.message, /Dear Mrs\. Smith/);
});

test("flags cold outreach when there is no relationship history on file", () => {
  const result = prepareOutreach({
    ...baseRequest,
    relationshipContext: {},
  });

  assert.equal(result.allowed, true);
  assert.deepEqual(result.complianceWarnings, ["No prior relationship history on file; treat as first-touch outreach."]);
  assert.deepEqual(result.evidenceUsed, []);
});

test("never invents property facts beyond what was provided", () => {
  const result = prepareOutreach({
    ...baseRequest,
    propertyContext: {
      address: "45 Farmers Boulevard",
      ownerName: "David Chen",
      facts: ["The property has an open HPD violation from 2026-05-01."],
    },
  });

  assert.match(result.message, /open HPD violation/);
  assert.ok(result.evidenceUsed.some((item) => item.includes("open HPD violation")));
});
