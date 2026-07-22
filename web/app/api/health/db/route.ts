import { listProperties } from "../../../../db/repo";
import { withAuth } from "../../../../lib/auth/server.ts";

export async function GET(request: Request) {
  return withAuth(request, async () => {
    try {
      const properties = await listProperties();
      return Response.json({
        ok: true,
        propertyCount: properties.length,
        sample: properties.slice(0, 2).map((property) => property.address),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Database health check failed.";
      return Response.json({ ok: false, error: message }, { status: 500 });
    }
  });
}
