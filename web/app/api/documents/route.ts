import { addDocument, listDocuments } from "../../../db/repo";
import { withAuth } from "../../../lib/auth/server.ts";

export async function GET(request: Request) {
  return withAuth(request, async () => {
    try {
      const propertyId = new URL(request.url).searchParams.get("propertyId");
      if (!propertyId) return Response.json({ error: "propertyId is required." }, { status: 400 });
      return Response.json({ documents: await listDocuments(propertyId) });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Could not load documents." }, { status: 500 });
    }
  });
}

export async function POST(request: Request) {
  return withAuth(request, async () => {
    try {
      const body = (await request.json()) as { propertyId?: unknown; name?: unknown; docType?: unknown; reference?: unknown };
      const propertyId = typeof body.propertyId === "string" ? body.propertyId : "";
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!propertyId || !name) return Response.json({ error: "propertyId and name are required." }, { status: 400 });
      const document = await addDocument({
        propertyId,
        name,
        docType: typeof body.docType === "string" ? body.docType : "document",
        reference: typeof body.reference === "string" ? body.reference : "",
      });
      return Response.json({ document }, { status: 201 });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Could not add the document." }, { status: 500 });
    }
  });
}
