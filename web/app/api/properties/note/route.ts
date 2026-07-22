import { addNote } from "../../../../db/repo";
import { withAuth } from "../../../../lib/auth/server.ts";

export async function POST(request: Request) {
  return withAuth(request, async () => {
    try {
      const body = (await request.json()) as { propertyId?: unknown; body?: unknown };
      const propertyId = typeof body.propertyId === "string" ? body.propertyId : "";
      const text = typeof body.body === "string" ? body.body.trim() : "";
      if (!propertyId || !text) {
        return Response.json({ error: "propertyId and body are required." }, { status: 400 });
      }
      const property = await addNote(propertyId, text);
      if (!property) return Response.json({ error: "Property not found." }, { status: 404 });
      return Response.json({ property }, { status: 201 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save the note.";
      return Response.json({ error: message }, { status: 500 });
    }
  });
}
