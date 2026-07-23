import assert from "node:assert/strict";
import test from "node:test";
import { sampleProperties } from "../lib/property-model.ts";
import {
  DEFAULT_PERMISSION,
  checkChannelPermission,
  checkDoNotCall,
  checkProtectedAttributeUsage,
  checkQuietHours,
  checkSuppression,
  hourInTimeZone,
  runComplianceChecks,
} from "../lib/agents/compliance.ts";
import { buildCanSpamFooter } from "../lib/outreach/delivery.ts";
import { runOutreachAgent } from "../lib/agents/outreach-compliance.ts";
import { runPropertyIntelligenceAgent } from "../lib/agents/property-intelligence.ts";
import { runFollowUpAgent } from "../lib/agents/follow-up.ts";
import { classifyIntent, runOrchestrator } from "../lib/agents/orchestrator.ts";

const probate = sampleProperties[0]; // 88 Linden Avenue, inherited/probate

test("orchestrator classifies intent deterministically", () => {
  assert.equal(classifyIntent("who should I call today?"), "prioritize");
  assert.equal(classifyIntent("draft an email for Sara Patel"), "draft_outreach");
  assert.equal(classifyIntent("what happened with 88 Linden Avenue?"), "property_status");
  assert.equal(classifyIntent("build my prospecting plan for Rosedale"), "prospecting_plan");
  assert.equal(classifyIntent(""), "help");
});

test("compliance tools block do-not-contact, bad channels, and protected traits", () => {
  const dnc = { ...DEFAULT_PERMISSION, doNotContact: true };
  assert.equal(checkDoNotCall(dnc, "").passed, false);
  assert.equal(checkDoNotCall(DEFAULT_PERMISSION, "DNC remove me from your list").passed, false);

  const noEmail = { ...DEFAULT_PERMISSION, emailAllowed: false };
  assert.equal(checkChannelPermission(noEmail, "email").passed, false);
  assert.equal(checkChannelPermission(DEFAULT_PERMISSION, "call").passed, true);

  assert.equal(checkProtectedAttributeUsage("owner is 84 years old").passed, false);
  assert.equal(checkProtectedAttributeUsage("owner inherited the home").passed, true);

  const blocked = runComplianceChecks({
    permission: DEFAULT_PERMISSION,
    channel: "call",
    notes: "please do not call me",
    rationale: "long ownership",
  });
  assert.equal(blocked.allowed, false);
});

test("cold SMS is blocked by default (TCPA); text must be explicitly enabled", () => {
  // The safe default: text OFF until a person turns it on for a property.
  assert.equal(DEFAULT_PERMISSION.textAllowed, false);
  assert.equal(checkChannelPermission(DEFAULT_PERMISSION, "text").passed, false);
  assert.equal(checkChannelPermission({ ...DEFAULT_PERMISSION, textAllowed: true }, "text").passed, true);
});

test("quiet hours block calls/texts outside 8am–9pm and never touch email/mail", () => {
  const tz = "America/New_York"; // July -> EDT (UTC-4)
  assert.equal(hourInTimeZone(new Date("2026-07-22T14:00:00Z"), tz), 10);
  // 10am ET: inside the window.
  assert.equal(checkQuietHours("call", new Date("2026-07-22T14:00:00Z"), tz).passed, true);
  // 11pm ET: after 9pm -> blocked.
  assert.equal(checkQuietHours("text", new Date("2026-07-22T03:00:00Z"), tz).passed, false);
  // 6am ET: before 8am -> blocked.
  assert.equal(checkQuietHours("call", new Date("2026-07-22T10:00:00Z"), tz).passed, false);
  // Email and direct mail are never time-restricted.
  assert.equal(checkQuietHours("email", new Date("2026-07-22T03:00:00Z"), tz).passed, true);
  assert.equal(checkQuietHours("direct_mail", new Date("2026-07-22T03:00:00Z"), tz).passed, true);
});

test("suppression scrub blocks a recipient on the do-not-contact list", () => {
  assert.equal(checkSuppression(true).passed, false);
  assert.match(checkSuppression(true).detail, /do-not-contact/i);
  assert.equal(checkSuppression(false).passed, true);
});

test("every outreach email carries a CAN-SPAM footer: sender, address, opt-out", () => {
  process.env.OUTREACH_SENDER_NAME = "Tanya Realty";
  process.env.OUTREACH_MAILING_ADDRESS = "1 Main St, Queens, NY 11001";
  const footer = buildCanSpamFooter();
  assert.match(footer, /Tanya Realty/);
  assert.match(footer, /1 Main St, Queens, NY 11001/);
  assert.match(footer, /unsubscribe/i);
  delete process.env.OUTREACH_SENDER_NAME;
  delete process.env.OUTREACH_MAILING_ADDRESS;
  // Even unconfigured, the opt-out line must still be present.
  assert.match(buildCanSpamFooter(), /unsubscribe/i);
});

test("orchestrator ranks top properties without drafting or sending", async () => {
  const response = await runOrchestrator("who should I call today?", { properties: sampleProperties });
  assert.equal(response.intent, "prioritize");
  assert.equal(response.recommendations.length, 3);
  assert.equal(response.drafts.length, 0);
  assert.ok(response.trace.length >= 1, "an agent run must be traced");
});

test("orchestrator drafts outreach that is held for approval, never sent", async () => {
  const response = await runOrchestrator("draft an email for 88 Linden Avenue", { properties: sampleProperties });
  assert.equal(response.intent, "draft_outreach");
  assert.equal(response.drafts.length, 1);
  assert.equal(response.drafts[0].allowed, true);
  assert.ok(response.drafts[0].message.length > 0);
});

test("outreach agent blocks a do-not-contact property and always requires approval", async () => {
  const permissions = { [probate.id]: { ...DEFAULT_PERMISSION, doNotContact: true } };
  const response = await runOrchestrator(`draft a call script for ${probate.address}`, {
    properties: sampleProperties,
    permissions,
  });
  assert.equal(response.drafts[0].allowed, false);

  const direct = await runOutreachAgent({
    property: { id: probate.id, address: probate.address, ownerName: probate.ownerName, notes: probate.summary },
    channel: "call",
    permission: { ...DEFAULT_PERMISSION, doNotContact: true },
    rationale: "long ownership",
  });
  assert.equal(direct.result.allowed, false);
  assert.equal(direct.result.approvalRequired, true);
});

test("property intelligence agent interprets evidence with the local fallback", async () => {
  const { results, run } = await runPropertyIntelligenceAgent([
    { id: probate.id, address: probate.address, ownerName: probate.ownerName, ownershipYears: 31, notes: probate.summary, signalLabels: probate.signals },
  ]);
  assert.equal(run.provider, "local_fallback");
  assert.ok(results[0].signals.some((signal) => signal.type === "inheritance_or_estate"));
  assert.ok(results[0].signals.some((signal) => signal.type === "ownership_length"));
});

test("outreach agent adds a subject only for the email channel (local fallback)", async () => {
  const emailDraft = await runOutreachAgent({
    property: { id: probate.id, address: probate.address, ownerName: probate.ownerName, notes: probate.summary },
    channel: "email",
    rationale: "long ownership",
  });
  assert.equal(emailDraft.result.allowed, true);
  assert.ok(emailDraft.result.subject?.includes(probate.address));

  const callDraft = await runOutreachAgent({
    property: { id: probate.id, address: probate.address, ownerName: probate.ownerName, notes: probate.summary },
    channel: "call",
    rationale: "long ownership",
  });
  assert.equal(callDraft.result.subject, undefined);
});

test("outreach agent cites only supplied evidence ids, never trusts freeform model text", async () => {
  const evidenceSignals = [
    { type: "tax_lien", evidence: "Tax lien recorded 2024-03-01", source: "NYC ACRIS", confidence: "high" },
  ];
  const client = {
    messages: {
      async create() {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                message: "Hi there — I also heard the owner just won the lottery!",
                subject: "Following up",
                usedFactIds: ["evidence-0", "bogus-id"],
              }),
            },
          ],
          usage: { input_tokens: 10, output_tokens: 10 },
        };
      },
    },
  };

  const { result } = await runOutreachAgent(
    {
      property: { id: probate.id, address: probate.address, ownerName: probate.ownerName, notes: probate.summary },
      channel: "email",
      rationale: "long ownership",
      evidenceSignals,
    },
    { client },
  );

  assert.deepEqual(result.evidenceUsed, ["Tax lien recorded 2024-03-01 (source: NYC ACRIS)"]);
  assert.ok(!result.evidenceUsed?.some((item) => item.includes("lottery")));
});

test("blocked outreach never reaches evidence citation or Claude", async () => {
  const client = {
    messages: {
      async create() {
        throw new Error("should not be called when compliance blocks the request");
      },
    },
  };

  const { result } = await runOutreachAgent(
    {
      property: { id: probate.id, address: probate.address, ownerName: probate.ownerName, notes: probate.summary },
      channel: "call",
      permission: { ...DEFAULT_PERMISSION, doNotContact: true },
      rationale: "long ownership",
      evidenceSignals: [{ type: "tax_lien", evidence: "Tax lien recorded", source: "NYC ACRIS", confidence: "high" }],
    },
    { client },
  );

  assert.equal(result.allowed, false);
  assert.equal(result.subject, undefined);
  assert.equal(result.evidenceUsed, undefined);
});

test("orchestrator plumbs subject/evidenceUsed onto the draft from stored intelligence signals", async () => {
  const enriched = {
    ...probate,
    intelligenceSignals: [{ type: "tax_lien", evidence: "Tax lien recorded 2024-03-01", source: "NYC ACRIS", confidence: "high" }],
  };
  const client = {
    messages: {
      async create() {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                message: "Hi there, following up about the property.",
                subject: "Following up",
                usedFactIds: ["evidence-0"],
              }),
            },
          ],
          usage: { input_tokens: 10, output_tokens: 10 },
        };
      },
    },
  };
  const response = await runOrchestrator(`draft an email for ${enriched.address}`, {
    properties: [enriched],
    client,
  });
  assert.equal(response.drafts[0].allowed, true);
  assert.deepEqual(response.drafts[0].evidenceUsed, ["Tax lien recorded 2024-03-01 (source: NYC ACRIS)"]);
  assert.equal(response.drafts[0].subject, "Following up");
});

test("follow-up agent adds sentiment on the local path", async () => {
  const leads = [
    { address: "1 Test Street", ownerName: "Test Owner", lastContact: "", followUpDate: "", notes: "inherited home, call me tomorrow please", rowNumber: 2 },
  ];
  const { results, run } = await runFollowUpAgent(leads);
  assert.equal(run.provider, "local_fallback");
  assert.ok(["warm", "neutral", "open_but_not_ready", "cold"].includes(results[0].sentiment));
});
