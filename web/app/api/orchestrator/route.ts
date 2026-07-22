import { runOrchestrator } from "../../../lib/agents/orchestrator.ts";
import { createApproval, getPermissionsMap, listProperties, logModelRun } from "../../../db/repo";
import { withAuth } from "../../../lib/auth/server.ts";

export async function POST(request: Request) {
  return withAuth(request, async () => {
    try {
      const body = (await request.json()) as { message?: unknown };
      const message = typeof body.message === "string" ? body.message.trim() : "";
      if (!message) return Response.json({ error: "Ask a question or give an instruction." }, { status: 400 });

      const [properties, permissions] = await Promise.all([listProperties(), getPermissionsMap()]);
      const apiKey = process.env.ANTHROPIC_API_KEY?.trim();

      const response = await runOrchestrator(message, { properties, permissions, apiKey });

      for (const run of response.trace) {
        try {
          await logModelRun(run);
        } catch (error) {
          console.error("Model-run logging failed:", error);
        }
      }

      const approvalIds: string[] = [];
      for (const draft of response.drafts) {
        if (!draft.allowed) continue;
        try {
          const id = await createApproval({
            propertyId: draft.propertyId,
            kind: "outreach",
            channel: draft.channel,
            draft: draft.message,
            complianceWarnings: draft.complianceWarnings,
          });
          approvalIds.push(id);
        } catch (error) {
          console.error("Approval creation failed:", error);
        }
      }

      return Response.json({ ...response, approvalIds });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The orchestrator could not respond.";
      return Response.json({ error: message }, { status: 500 });
    }
  });
}
