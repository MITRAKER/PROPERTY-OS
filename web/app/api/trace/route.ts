import { listAuditLog, listModelRuns } from "../../../db/repo";
import { withAuth } from "../../../lib/auth/server.ts";

export async function GET(request: Request) {
  return withAuth(request, async () => {
    try {
      const [modelRuns, auditLog] = await Promise.all([listModelRuns(12), listAuditLog(20)]);
      return Response.json({ modelRuns, auditLog });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load the agent trace.";
      return Response.json({ error: message }, { status: 500 });
    }
  });
}
