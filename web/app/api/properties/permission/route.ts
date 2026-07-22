import { setPropertyPermission } from "../../../../db/repo";
import { withAuth } from "../../../../lib/auth/server.ts";

const KEYS = ["doNotContact", "phoneAllowed", "emailAllowed", "mailAllowed", "textAllowed"] as const;

export async function POST(request: Request) {
  return withAuth(request, async () => {
    try {
      const body = (await request.json()) as { propertyId?: unknown; patch?: Record<string, unknown> };
      const propertyId = typeof body.propertyId === "string" ? body.propertyId : "";
      if (!propertyId) return Response.json({ error: "propertyId is required." }, { status: 400 });

      const patch: Record<string, boolean> = {};
      for (const key of KEYS) {
        if (typeof body.patch?.[key] === "boolean") patch[key] = body.patch[key] as boolean;
      }
      if (Object.keys(patch).length === 0) {
        return Response.json({ error: "Provide at least one permission flag to update." }, { status: 400 });
      }

      const permission = await setPropertyPermission(propertyId, patch);
      return Response.json({ permission });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not update permissions.";
      return Response.json({ error: message }, { status: 500 });
    }
  });
}
