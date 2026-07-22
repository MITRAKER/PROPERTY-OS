import { decideApproval, getApproval, getContactPermission, getProperty, isRecipientSuppressed, recordApprovalDelivery } from "../../../../db/repo";
import { withAuth } from "../../../../lib/auth/server.ts";
import { checkChannelPermission, checkDoNotCall, checkQuietHours, checkSuppression, DEFAULT_PERMISSION } from "../../../../lib/agents/compliance.ts";
import type { ContactPermission } from "../../../../lib/agents/compliance.ts";
import { deliverOutreach, type DeliveryChannel } from "../../../../lib/outreach/delivery.ts";

export async function POST(request: Request) {
  return withAuth(request, async () => {
    try {
      const body = (await request.json()) as { id?: unknown; decision?: unknown; recipient?: unknown; subject?: unknown };
      const id = typeof body.id === "string" ? body.id : "";
      const decision = body.decision === "approved" || body.decision === "rejected" ? body.decision : "";
      const recipient = typeof body.recipient === "string" ? body.recipient.trim() : "";
      if (!id || !decision) {
        return Response.json({ error: "id and decision (approved|rejected) are required." }, { status: 400 });
      }

      const approval = await decideApproval(id, decision);
      if (!approval) return Response.json({ error: "Approval not found." }, { status: 404 });

      // Rejected, or approved without a recipient: nothing is sent.
      if (decision !== "approved" || !recipient) {
        return Response.json({
          approval,
          delivery: decision === "approved"
            ? { status: "ready", detail: "Approved. Add a recipient to send it, or send it yourself." }
            : { status: "none", detail: "Draft rejected. Nothing was sent." },
        });
      }

      const stored = await getApproval(id);
      const channel = (stored?.channel ?? "email") as DeliveryChannel;
      const propertyId = stored?.propertyId ?? null;

      // Re-run the compliance gate AT SEND TIME — permissions may have changed
      // since the draft was written.
      const permissionRow = propertyId ? await getContactPermission(propertyId) : null;
      const permission: ContactPermission = permissionRow
        ? {
            doNotContact: permissionRow.doNotContact,
            phoneAllowed: permissionRow.phoneAllowed,
            emailAllowed: permissionRow.emailAllowed,
            mailAllowed: permissionRow.mailAllowed,
            textAllowed: permissionRow.textAllowed,
          }
        : DEFAULT_PERMISSION;

      const property = propertyId ? await getProperty(propertyId) : null;
      const dnc = checkDoNotCall(permission, property?.summary ?? "");
      const channelCheck = checkChannelPermission(permission, channel);
      // Workspace-wide do-not-contact scrub + quiet-hours (8am–9pm) for calls/texts.
      const suppression = checkSuppression(await isRecipientSuppressed(recipient));
      const quietHours = checkQuietHours(channel, new Date(), process.env.OUTREACH_TIMEZONE || "America/New_York");

      if (!dnc.passed || !channelCheck.passed || !suppression.passed || !quietHours.passed) {
        const reason = [dnc, channelCheck, suppression, quietHours].filter((check) => !check.passed).map((check) => check.detail).join(" ");
        await recordApprovalDelivery(id, { recipient, status: "blocked", error: reason, channel, propertyId });
        return Response.json({
          approval: await getApproval(id),
          delivery: { status: "blocked", detail: reason },
        }, { status: 409 });
      }

      const result = await deliverOutreach({
        channel,
        to: recipient,
        subject: typeof body.subject === "string" ? body.subject : undefined,
        body: stored?.draft ?? "",
      });

      const updated = await recordApprovalDelivery(id, {
        recipient,
        status: result.status,
        providerMessageId: result.providerMessageId,
        error: result.error,
        channel,
        propertyId,
      });

      return Response.json({ approval: updated, delivery: result });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not record the decision.";
      return Response.json({ error: message }, { status: 500 });
    }
  });
}
