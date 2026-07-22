import { createProspectedProperty } from "../../../../db/repo";
import { withAuth } from "../../../../lib/auth/server.ts";

// POST /api/leads/claim — adds a prospected parcel to the workspace as a real lead.
export async function POST(request: Request) {
  return withAuth(request, async () => {
    try {
      const body = (await request.json()) as Record<string, unknown>;
      const bbl = typeof body.bbl === "string" ? body.bbl : "";
      const address = typeof body.address === "string" ? body.address.trim() : "";
      if (!bbl || !address) return Response.json({ error: "bbl and address are required." }, { status: 400 });

      const toNum = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : null);

      const { property, alreadyExisted } = await createProspectedProperty({
        bbl,
        address,
        ownerName: typeof body.ownerName === "string" && body.ownerName ? body.ownerName : "Owner not listed",
        yearBuilt: toNum(body.yearBuilt),
        unitsTotal: toNum(body.unitsTotal),
        assessedValue: toNum(body.assessedValue),
        latitude: toNum(body.latitude),
        longitude: toNum(body.longitude),
        score: toNum(body.score) ?? 50,
        reasons: Array.isArray(body.reasons) ? (body.reasons as string[]).filter((r) => typeof r === "string") : [],
      });

      return Response.json({ property, alreadyExisted }, { status: alreadyExisted ? 200 : 201 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not claim the lead.";
      return Response.json({ error: message }, { status: 500 });
    }
  });
}
