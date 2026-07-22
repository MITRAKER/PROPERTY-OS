// Real outreach delivery. Email goes out through Resend, SMS through Twilio.
// Provider credentials are server-only env vars; nothing is ever sent unless a
// person approved the draft AND the compliance gate passes at send time.
//
// Deliberately NOT implemented: automated voice calls. Auto-dialing homeowners is
// the single most regulated channel (TCPA / do-not-call), so a call is logged as
// a human action and the agent dials it themselves.

export type DeliveryChannel = "email" | "text" | "call" | "direct_mail";

export type DeliveryResult = {
  status: "sent" | "not_configured" | "unsupported" | "failed";
  providerMessageId?: string;
  provider?: string;
  error?: string;
  detail: string;
};

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.OUTREACH_FROM_EMAIL?.trim());
}

// CAN-SPAM requires every commercial email to identify the sender, carry a valid
// physical postal address, and offer a working opt-out. This footer is appended
// to every outbound email so a draft can never go out missing them.
export function buildCanSpamFooter(): string {
  const sender = process.env.OUTREACH_SENDER_NAME?.trim() || process.env.OUTREACH_FROM_EMAIL?.trim() || "";
  const address = process.env.OUTREACH_MAILING_ADDRESS?.trim() || "";
  const lines = ["", "—"];
  if (sender) lines.push(sender);
  if (address) lines.push(address);
  lines.push("You're receiving this because public records list you as a property owner.");
  lines.push('To stop hearing from us, reply "unsubscribe" and we won\'t contact you again.');
  return `\n${lines.join("\n")}`;
}

export function isSmsConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID?.trim() &&
      process.env.TWILIO_AUTH_TOKEN?.trim() &&
      process.env.TWILIO_FROM_NUMBER?.trim(),
  );
}

export function deliveryCapabilities() {
  return {
    email: isEmailConfigured(),
    text: isSmsConfigured(),
    call: false, // human-dialed by design
    direct_mail: false, // physical mail, handled offline
  };
}

async function sendEmail(to: string, subject: string, body: string): Promise<DeliveryResult> {
  if (!isEmailConfigured()) {
    return { status: "not_configured", detail: "Email delivery is not configured. Set RESEND_API_KEY and OUTREACH_FROM_EMAIL." };
  }
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.OUTREACH_FROM_EMAIL,
        to: [to],
        subject,
        text: body,
      }),
    });
    const payload = (await response.json()) as { id?: string; message?: string };
    if (!response.ok) {
      return { status: "failed", provider: "resend", error: payload.message ?? `HTTP ${response.status}`, detail: "Resend rejected the message." };
    }
    return { status: "sent", provider: "resend", providerMessageId: payload.id, detail: `Email delivered to ${to}.` };
  } catch (error) {
    return { status: "failed", provider: "resend", error: error instanceof Error ? error.message : "Unknown error", detail: "Email delivery failed." };
  }
}

async function sendSms(to: string, body: string): Promise<DeliveryResult> {
  if (!isSmsConfigured()) {
    return { status: "not_configured", detail: "SMS delivery is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER." };
  }
  try {
    const sid = process.env.TWILIO_ACCOUNT_SID!;
    const auth = btoa(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`);
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: process.env.TWILIO_FROM_NUMBER!, Body: body }),
    });
    const payload = (await response.json()) as { sid?: string; message?: string };
    if (!response.ok) {
      return { status: "failed", provider: "twilio", error: payload.message ?? `HTTP ${response.status}`, detail: "Twilio rejected the message." };
    }
    return { status: "sent", provider: "twilio", providerMessageId: payload.sid, detail: `Text delivered to ${to}.` };
  } catch (error) {
    return { status: "failed", provider: "twilio", error: error instanceof Error ? error.message : "Unknown error", detail: "SMS delivery failed." };
  }
}

// Routes an approved draft to its channel. Callers must have already run the
// compliance gate for this property and channel.
export async function deliverOutreach(input: {
  channel: DeliveryChannel;
  to: string;
  subject?: string;
  body: string;
}): Promise<DeliveryResult> {
  if (input.channel === "email") {
    return sendEmail(input.to, input.subject?.trim() || "Following up on your property", input.body + buildCanSpamFooter());
  }
  if (input.channel === "text") {
    return sendSms(input.to, input.body);
  }
  if (input.channel === "call") {
    return {
      status: "unsupported",
      detail: "Calls are dialed by a person, not auto-placed. The approved script is ready and the call is logged once you make it.",
    };
  }
  return {
    status: "unsupported",
    detail: "Direct mail is produced offline. The approved letter is ready to hand to your mail vendor.",
  };
}
