import { addContact, getProperty } from "../../../../db/repo";
import { withAuth } from "../../../../lib/auth/server.ts";
import { createContactDataProvider } from "../../../../lib/contacts/provider.ts";

// POST /api/contacts/lookup { propertyId }
// Runs the configured contact-data vendor. With none configured this reports
// `not_configured` honestly rather than pretending to search.
export async function POST(request: Request) {
  return withAuth(request, async () => {
    try {
      const body = (await request.json()) as { propertyId?: unknown };
      const propertyId = typeof body.propertyId === "string" ? body.propertyId : "";
      if (!propertyId) return Response.json({ error: "propertyId is required." }, { status: 400 });

      const property = await getProperty(propertyId);
      if (!property) return Response.json({ error: "Property not found." }, { status: 404 });

      const provider = createContactDataProvider();
      const result = await provider.lookup({
        propertyId,
        address: property.address,
        ownerName: property.ownerName,
        mailingAddress: property.ownerMailingAddress ?? null,
      });

      // Persist whatever a vendor returned so it falls under the compliance gate.
      for (const contact of result.contacts) {
        await addContact({
          propertyId,
          type: contact.type,
          value: contact.value,
          label: contact.label ?? "",
          source: result.provider,
        });
      }

      return Response.json(result);
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Contact lookup failed." }, { status: 500 });
    }
  });
}
