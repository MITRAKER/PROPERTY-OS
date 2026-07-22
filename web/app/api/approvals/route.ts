import { listApprovals } from "../../../db/repo";
import { withAuth } from "../../../lib/auth/server.ts";

export async function GET(request: Request) {
  return withAuth(request, async () => {
    try {
      const status = new URL(request.url).searchParams.get("status") ?? undefined;
      return Response.json({ approvals: await listApprovals(status) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load approvals.";
      return Response.json({ error: message }, { status: 500 });
    }
  });
}
