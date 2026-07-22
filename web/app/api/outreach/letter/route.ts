import { buildLetterHtml } from "../../../../lib/outreach/letter.ts";
import { getApproval, getContactPermission, getProperty } from "../../../../db/repo";
import { withAuth } from "../../../../lib/auth/server.ts";
import { currentAuth } from "../../../../lib/auth/context.ts";
import { checkChannelPermission, checkDoNotCall, DEFAULT_PERMISSION } from "../../../../lib/agents/compliance.ts";
import type { ContactPermission } from "../../../../lib/agents/compliance.ts";

// GET /api/outreach/letter?approvalId=...
// Renders an approved draft as a print-ready letter. Still compliance-gated:
// a do-not-contact or mail-disallowed property will not produce a letter.
export async function GET(request: Request) {
  return withAuth(request, async () => {
    try {
      const approvalId = new URL(request.url).searchParams.get("approvalId");
      if (!approvalId) return Response.json({ error: "approvalId is required." }, { status: 400 });

      const approval = await getApproval(approvalId);
      if (!approval) return Response.json({ error: "Approval not found." }, { status: 404 });

      const property = approval.propertyId ? await getProperty(approval.propertyId) : null;
      const permissionRow = approval.propertyId ? await getContactPermission(approval.propertyId) : null;
      const permission: ContactPermission = permissionRow
        ? {
            doNotContact: permissionRow.doNotContact,
            phoneAllowed: permissionRow.phoneAllowed,
            emailAllowed: permissionRow.emailAllowed,
            mailAllowed: permissionRow.mailAllowed,
            textAllowed: permissionRow.textAllowed,
          }
        : DEFAULT_PERMISSION;

      const dnc = checkDoNotCall(permission, property?.summary ?? "");
      const mail = checkChannelPermission(permission, "direct_mail");
      if (!dnc.passed || !mail.passed) {
        const reason = [dnc, mail].filter((check) => !check.passed).map((check) => check.detail).join(" ");
        return Response.json({ error: reason }, { status: 409 });
      }

      const auth = currentAuth();
      const html = buildLetterHtml({
        ownerName: property?.ownerName ?? "Property owner",
        propertyAddress: property?.address ?? "",
        body: approval.draft,
        agentName: auth?.name ?? "Your agent",
        agentEmail: auth?.email,
      });

      return new Response(html, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not build the letter.";
      return Response.json({ error: message }, { status: 500 });
    }
  });
}
