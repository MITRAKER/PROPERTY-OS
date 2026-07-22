import { listPeople } from "../../../db/repo";
import { withAuth } from "../../../lib/auth/server.ts";

export async function GET(request: Request) {
  return withAuth(request, async () => {
    try {
      return Response.json({ people: await listPeople() });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load contacts.";
      return Response.json({ error: message }, { status: 500 });
    }
  });
}
