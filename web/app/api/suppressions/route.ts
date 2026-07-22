import { addSuppression, listSuppressions, removeSuppression } from "../../../db/repo";
import { withAuth } from "../../../lib/auth/server.ts";

// Workspace-wide do-not-contact list. A phone or email added here is blocked on
// every property and channel by the send-time compliance gate. This is how an
// owner's opt-out ("stop contacting me") is honored across the whole workspace.
export async function GET(request: Request) {
  return withAuth(request, async () => {
    try {
      return Response.json({ suppressions: await listSuppressions() });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Could not load the do-not-contact list." }, { status: 500 });
    }
  });
}

export async function POST(request: Request) {
  return withAuth(request, async () => {
    try {
      const body = (await request.json()) as { value?: unknown; reason?: unknown };
      const value = typeof body.value === "string" ? body.value.trim() : "";
      if (!value) return Response.json({ error: "A phone number or email is required." }, { status: 400 });
      const reason = typeof body.reason === "string" ? body.reason.trim() : "";
      const entry = await addSuppression(value, reason);
      if (!entry) return Response.json({ error: "That is not a valid phone number or email." }, { status: 400 });
      return Response.json({ suppression: entry }, { status: 201 });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Could not add to the do-not-contact list." }, { status: 500 });
    }
  });
}

export async function DELETE(request: Request) {
  return withAuth(request, async () => {
    try {
      const id = new URL(request.url).searchParams.get("id");
      if (!id) return Response.json({ error: "id is required." }, { status: 400 });
      return Response.json(await removeSuppression(id));
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Could not remove from the do-not-contact list." }, { status: 500 });
    }
  });
}
