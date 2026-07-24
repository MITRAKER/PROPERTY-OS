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
  const now = new Date("2026-07-22T14:00:00.000Z"); // 10am ET, inside quiet hours
  const result = prepareOutreach(
    {
      ...baseRequest,
      channel: "phone",
      permissions: { doNotContact: true },
    },
    now,
  );

  assert.deepEqual(result, {
    propertyId: "property-001",
    channel: "phone",
    allowed: false,
    approvalRequired: false,
    subject: null,
    message: null,
    complianceWarnings: ["The record is marked do not contact."],
    evidenceUsed: [],
    complianceReceipt: {
      checkedAt: now.toISOString(),
      propertyId: "property-001",
      channel: "phone",
      checks: [
        { name: "do_not_contact", passed: false, detail: "The record is marked do not contact." },
        { name: "channel_permission", passed: false, detail: "No documented permission for phone outreach." },
        { name: "consent", passed: true, detail: "No documented consent withdrawal on file." },
        { name: "quiet_hours", passed: true, detail: "Within permitted contact hours (8:00–21:00 America/New_York)." },
        { name: "national_dnc_registry", passed: false, detail: "This contact has not been confirmed scrubbed against the National Do Not Call Registry." },
        { name: "protected_attribute_usage", passed: true, detail: "No protected attributes were used as a signal." },
        { name: "existing_relationship", passed: true, detail: "A prior relationship is on record with this owner." },
      ],
    },
    suggestedChannel: null,
  });
});

test("compliance receipt shows every check's real outcome, not just the first failure", () => {
  const outsideHours = new Date("2026-07-22T03:00:00Z"); // 11pm ET
  const result = prepareOutreach(
    { ...baseRequest, channel: "phone", permissions: { doNotContact: true } },
    outsideHours,
  );

  // Blocked for do-not-contact (the first check), but the receipt still shows
  // that channel permission and quiet hours would ALSO have failed — the
  // whole point of an audit trail is not hiding the rest of the picture.
  const byName = Object.fromEntries(result.complianceReceipt.checks.map((check) => [check.name, check]));
  assert.equal(byName.do_not_contact.passed, false);
  assert.equal(byName.channel_permission.passed, false);
  assert.equal(byName.quiet_hours.passed, false);
  assert.equal(result.complianceReceipt.checkedAt, outsideHours.toISOString());
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
    { ...baseRequest, channel: "phone", permissions: { doNotContact: false, phoneAllowed: true, nationalDncChecked: true } },
    outsideHours,
  );
  assert.equal(blocked.allowed, false);
  assert.match(blocked.complianceWarnings[0], /Outside permitted contact hours/);

  const allowed = prepareOutreach(
    { ...baseRequest, channel: "phone", permissions: { doNotContact: false, phoneAllowed: true, nationalDncChecked: true } },
    insideHours,
  );
  assert.equal(allowed.allowed, true);

  const emailAtNight = prepareOutreach(baseRequest, outsideHours);
  assert.equal(emailAtNight.allowed, true);
});

test("a jurisdiction override changes the quiet-hours window used for the check", () => {
  const at7am = new Date("2026-07-22T11:00:00Z"); // 7am ET — blocked under the federal 8am-9pm default

  const blockedByDefault = prepareOutreach(
    { ...baseRequest, channel: "phone", permissions: { doNotContact: false, phoneAllowed: true, nationalDncChecked: true } },
    at7am,
  );
  assert.equal(blockedByDefault.allowed, false);

  const allowedWithOverride = prepareOutreach(
    {
      ...baseRequest,
      channel: "phone",
      permissions: { doNotContact: false, phoneAllowed: true, nationalDncChecked: true },
      jurisdiction: { quietHoursStart: 7, quietHoursEnd: 21, timeZone: "America/New_York" },
    },
    at7am,
  );
  assert.equal(allowedWithOverride.allowed, true);
});

test("blocks phone/text until the contact is confirmed scrubbed against the National DNC Registry", () => {
  const insideHours = new Date("2026-07-22T14:00:00Z");
  const result = prepareOutreach(
    { ...baseRequest, channel: "phone", permissions: { doNotContact: false, phoneAllowed: true } },
    insideHours,
  );

  assert.equal(result.allowed, false);
  assert.match(result.complianceWarnings[0], /National Do Not Call Registry/);

  const checked = prepareOutreach(
    { ...baseRequest, channel: "phone", permissions: { doNotContact: false, phoneAllowed: true, nationalDncChecked: true } },
    insideHours,
  );
  assert.equal(checked.allowed, true);

  // Email/letter never require the National DNC scrub.
  const emailResult = prepareOutreach(baseRequest, insideHours);
  assert.equal(emailResult.allowed, true);
});

test("suggests an allowed channel when the requested one is blocked for a channel-specific reason", () => {
  const outsideHours = new Date("2026-07-22T03:00:00Z"); // 11pm ET
  const result = prepareOutreach(
    { ...baseRequest, channel: "phone", permissions: { doNotContact: false, phoneAllowed: true, nationalDncChecked: true, emailAllowed: true } },
    outsideHours,
  );

  assert.equal(result.allowed, false);
  assert.equal(result.suggestedChannel, "email");
});

test("never suggests a fallback channel when the whole record is blocked", () => {
  const result = prepareOutreach({
    ...baseRequest,
    channel: "phone",
    permissions: { doNotContact: true, emailAllowed: true },
  });

  assert.equal(result.allowed, false);
  assert.equal(result.suggestedChannel, null);
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
