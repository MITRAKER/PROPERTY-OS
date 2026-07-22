import { addContact, findPropertyIdByAddress } from "../../../../db/repo";
import { withAuth } from "../../../../lib/auth/server.ts";
import { parseSkipTraceCsv } from "../../../../lib/contacts/contact-model.ts";

// POST /api/contacts/import { csvText, source? }
// Takes whatever a skip-trace vendor returned and files the numbers against the
// right properties. Matches on property_id when the export round-trips, otherwise
// on address. Every number lands under the existing compliance gate.
export async function POST(request: Request) {
  return withAuth(request, async () => {
    try {
      const body = (await request.json()) as { csvText?: unknown; source?: unknown };
      const csvText = typeof body.csvText === "string" ? body.csvText : "";
      const source = typeof body.source === "string" && body.source.trim() ? body.source.trim() : "skip_trace_import";
      if (!csvText.trim()) return Response.json({ error: "Paste the CSV your vendor returned." }, { status: 400 });

      const rows = parseSkipTraceCsv(csvText);
      let imported = 0;
      let matched = 0;
      const unmatched: string[] = [];

      for (const row of rows) {
        let propertyId = row.propertyId ?? null;
        if (!propertyId && row.address) propertyId = await findPropertyIdByAddress(row.address);
        if (!propertyId) {
          if (row.address) unmatched.push(row.address);
          continue;
        }
        matched += 1;
        for (const contact of row.contacts) {
          await addContact({ propertyId, type: contact.type, value: contact.value, source });
          imported += 1;
        }
      }

      return Response.json({
        rows: rows.length,
        matchedProperties: matched,
        contactsImported: imported,
        unmatched: unmatched.slice(0, 10),
        note: "Imported numbers are governed by the same do-not-contact gate. Scrub against the National DNC Registry before calling.",
      });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Import failed." }, { status: 500 });
    }
  });
}
