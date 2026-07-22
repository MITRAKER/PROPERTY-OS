import { getContactPermission, getProperty, listProperties } from "../../../db/repo";
import { withAuth } from "../../../lib/auth/server.ts";

export async function GET(request: Request) {
  return withAuth(request, async () => {
    try {
      const id = new URL(request.url).searchParams.get("id");
      if (id) {
        const property = await getProperty(id);
        if (!property) return Response.json({ error: "Property not found." }, { status: 404 });
        const permission = await getContactPermission(id);
        return Response.json({ property, permission });
      }
      return Response.json({ properties: await listProperties() });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load properties.";
      return Response.json({ error: message }, { status: 500 });
    }
  });
}
