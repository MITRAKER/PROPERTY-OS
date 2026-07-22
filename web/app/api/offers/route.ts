import { addOffer, listOffers, updateOfferStatus } from "../../../db/repo";
import { withAuth } from "../../../lib/auth/server.ts";

export async function GET(request: Request) {
  return withAuth(request, async () => {
    try {
      const propertyId = new URL(request.url).searchParams.get("propertyId");
      if (!propertyId) return Response.json({ error: "propertyId is required." }, { status: 400 });
      return Response.json({ offers: await listOffers(propertyId) });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Could not load offers." }, { status: 500 });
    }
  });
}

export async function POST(request: Request) {
  return withAuth(request, async () => {
    try {
      const body = (await request.json()) as { propertyId?: unknown; party?: unknown; amount?: unknown; notes?: unknown; id?: unknown; status?: unknown };

      if (typeof body.id === "string" && typeof body.status === "string") {
        const offer = await updateOfferStatus(body.id, body.status);
        return Response.json({ offer });
      }

      const propertyId = typeof body.propertyId === "string" ? body.propertyId : "";
      const amount = typeof body.amount === "number" ? body.amount : Number(body.amount);
      if (!propertyId || !Number.isFinite(amount) || amount <= 0) {
        return Response.json({ error: "propertyId and a positive amount are required." }, { status: 400 });
      }
      const offer = await addOffer({
        propertyId,
        party: typeof body.party === "string" ? body.party : "Buyer",
        amount: Math.round(amount),
        notes: typeof body.notes === "string" ? body.notes : "",
      });
      return Response.json({ offer }, { status: 201 });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Could not save the offer." }, { status: 500 });
    }
  });
}
