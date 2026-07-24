import assert from "node:assert/strict";
import test from "node:test";
import { prepareOutreach, prepareOutreachWithAnthropic } from "../lib/outreach.ts";

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

test("blocks a phone call outside 8am-9pm Eastern, but never blocks email/letter for time", () => {
  const outsideHours = new Date("2026-07-22T03:00:00Z"); // 11pm ET
  const insideHours = new Date("2026-07-22T14:00:00Z"); // 10am ET

  const blocked = prepareOutreach(
    { ...baseRequest, channel: "phone", permissions: { doNotContact: false, phoneAllowed: true } },
    outsideHours,
  );
  assert.equal(blocked.allowed, false);
  assert.match(blocked.complianceWarnings[0], /Outside permitted contact hours/);

  const allowed = prepareOutreach(
    { ...baseRequest, channel: "phone", permissions: { doNotContact: false, phoneAllowed: true } },
    insideHours,
  );
  assert.equal(allowed.allowed, true);

  const emailAtNight = prepareOutreach(baseRequest, outsideHours);
  assert.equal(emailAtNight.allowed, true);
});

test("blocks outreach when the supplied evidence references a protected attribute", () => {
  const result = prepareOutreach({
    ...baseRequest,
    propertyContext: {
      address: "123 Main Street",
      ownerName: "Mrs. Smith",
      facts: ["Owner is 84 years old and recently widowed."],
    },
  });

  assert.equal(result.allowed, false);
  assert.match(result.complianceWarnings[0], /protected attribute/);
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

test("Claude path personalizes the draft and cites only supplied facts", async () => {
  const calls = [];
  const client = {
    messages: {
      async create(input) {
        calls.push(input);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                subject: "Reconnecting about 123 Main Street",
                message: "Hi Mrs. Smith, you asked me to reconnect after June, so I wanted to follow up about 123 Main Street.",
                usedFactIds: ["relationship-last-conversation"],
              }),
            },
          ],
        };
      },
    },
  };

  const result = await prepareOutreachWithAnthropic(baseRequest, { apiKey: "test-only", client });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].output_config.format.type, "json_schema");
  assert.equal(result.allowed, true);
  assert.equal(result.subject, "Reconnecting about 123 Main Street");
  assert.match(result.message, /you asked me to reconnect after June/);
  assert.deepEqual(result.evidenceUsed, ['Fact on file: "Asked us to reconnect after June."']);
});

test("Claude path never calls the model for a blocked request", async () => {
  const client = {
    messages: {
      async create() {
        throw new Error("should not be called when compliance blocks the request");
      },
    },
  };

  const result = await prepareOutreachWithAnthropic(
    { ...baseRequest, permissions: { doNotContact: true } },
    { apiKey: "test-only", client },
  );

  assert.equal(result.allowed, false);
  assert.equal(result.message, null);
});

test("Claude path discards a fact id the model invented and falls back to the deterministic draft", async () => {
  const client = {
    messages: {
      async create() {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                subject: "Following up",
                message: "Hi Mrs. Smith, following up.",
                usedFactIds: ["made-up-fact"],
              }),
            },
          ],
        };
      },
    },
  };

  const result = await prepareOutreachWithAnthropic(baseRequest, { apiKey: "test-only", client });

  assert.deepEqual(result.evidenceUsed, []);
});
