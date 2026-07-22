import { markCalled } from "../../../../db/repo";
import { withAuth } from "../../../../lib/auth/server.ts";

export async function POST(request: Request) {
  return withAuth(request, async () => {
    try {
      const body = (await request.json()) as { propertyId?: unknown };
      const propertyId = typeof body.propertyId === "string" ? body.propertyId : "";
      if (!propertyId) return Response.json({ error: "propertyId is required." }, { status: 400 });
      const property = await markCalled(propertyId);
      if (!property) return Response.json({ error: "Property not found." }, { status: 404 });
      return Response.json({ property });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not log the call.";
      return Response.json({ error: message }, { status: 500 });
    }
  });
}
