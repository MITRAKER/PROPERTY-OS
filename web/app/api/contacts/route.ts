import { addContact, deleteContact, listContacts } from "../../../db/repo";
import { withAuth } from "../../../lib/auth/server.ts";
import { normalizeContact } from "../../../lib/contacts/contact-model.ts";

export async function GET(request: Request) {
  return withAuth(request, async () => {
    try {
      const propertyId = new URL(request.url).searchParams.get("propertyId");
      if (!propertyId) return Response.json({ error: "propertyId is required." }, { status: 400 });
      return Response.json({ contacts: await listContacts(propertyId) });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Could not load contacts." }, { status: 500 });
    }
  });
}

export async function POST(request: Request) {
  return withAuth(request, async () => {
    try {
      const body = (await request.json()) as { propertyId?: unknown; value?: unknown; label?: unknown };
      const propertyId = typeof body.propertyId === "string" ? body.propertyId : "";
      const raw = typeof body.value === "string" ? body.value : "";
      if (!propertyId || !raw.trim()) {
        return Response.json({ error: "propertyId and a phone number or email are required." }, { status: 400 });
      }

      const normalized = normalizeContact(raw);
      if (!normalized) {
        return Response.json({ error: "That does not look like a valid phone number or email address." }, { status: 400 });
      }

      const contact = await addContact({
        propertyId,
        type: normalized.type,
        value: normalized.value,
        label: typeof body.label === "string" ? body.label : "",
        source: "manual",
      });
      return Response.json({ contact }, { status: 201 });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Could not save the contact." }, { status: 500 });
    }
  });
}

export async function DELETE(request: Request) {
  return withAuth(request, async () => {
    try {
      const id = new URL(request.url).searchParams.get("id");
      if (!id) return Response.json({ error: "id is required." }, { status: 400 });
      const removed = await deleteContact(id);
      if (!removed) return Response.json({ error: "Contact not found." }, { status: 404 });
      return Response.json(removed);
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Could not delete the contact." }, { status: 500 });
    }
  });
}
