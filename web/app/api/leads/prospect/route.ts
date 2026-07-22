import { prospectNearby } from "../../../../lib/data/prospecting.ts";
import { listPropertyAddresses } from "../../../../db/repo";
import { withAuth } from "../../../../lib/auth/server.ts";

// POST /api/leads/prospect { latitude, longitude, radius }
// Returns real NYC parcels near the clicked point, ranked as prospective leads,
// excluding anything already in the workspace.
export async function POST(request: Request) {
  return withAuth(request, async () => {
    try {
      const body = (await request.json()) as { latitude?: unknown; longitude?: unknown; radius?: unknown };
      const latitude = Number(body.latitude);
      const longitude = Number(body.longitude);
      const radius = Math.min(Math.max(Number(body.radius) || 250, 50), 1000);

      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return Response.json({ error: "A latitude and longitude are required." }, { status: 400 });
      }

      const [candidates, existingAddresses] = await Promise.all([
        prospectNearby(latitude, longitude, radius),
        listPropertyAddresses(),
      ]);

      const known = new Set(existingAddresses.map((address) => address.toLowerCase()));
      const fresh = candidates.filter((candidate) => !known.has(candidate.address.toLowerCase()));

      return Response.json({
        radius,
        found: candidates.length,
        candidates: fresh.slice(0, 12),
        note: "Public records supply property facts only. Phone, email, and contact permission must come from your CRM or an authorized provider.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Prospecting failed.";
      return Response.json({ error: message }, { status: 502 });
    }
  });
}
