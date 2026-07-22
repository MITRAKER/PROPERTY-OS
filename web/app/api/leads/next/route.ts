import { getPermissionsMap, listProperties } from "../../../../db/repo";
import { withAuth } from "../../../../lib/auth/server.ts";

// GET /api/leads/next?exclude=<propertyId>
// "I finished that one — who's next?" Returns the highest-value contactable
// property that still needs work, with the reason it was chosen.
export async function GET(request: Request) {
  return withAuth(request, async () => {
    try {
      const exclude = new URL(request.url).searchParams.get("exclude") ?? "";
      const [properties, permissions] = await Promise.all([listProperties(), getPermissionsMap()]);
      const todayIso = new Date().toISOString().slice(0, 10);

      const eligible = properties.filter(
        (property) => property.id !== exclude && !permissions[property.id]?.doNotContact,
      );

      if (eligible.length === 0) {
        return Response.json({
          property: null,
          reason: "No contactable properties are left. Prospect a new area on the map to add leads.",
        });
      }

      const overdue = (property: (typeof eligible)[number]) =>
        property.followUpDate && /^\d{4}-\d{2}-\d{2}$/.test(property.followUpDate) && property.followUpDate <= todayIso;

      const ranked = [...eligible].sort((a, b) => {
        const overdueDiff = Number(overdue(b)) - Number(overdue(a));
        if (overdueDiff !== 0) return overdueDiff;
        const contactedDiff = Number(!a.lastContact) - Number(!b.lastContact);
        if (contactedDiff !== 0) return contactedDiff;
        return b.score - a.score;
      });

      const next = ranked[0];
      const reason = overdue(next)
        ? `Follow-up was due ${next.followUpDate}.`
        : !next.lastContact
          ? "Highest-scoring property you have not contacted yet."
          : `Highest opportunity score (${next.score}/100).`;

      return Response.json({ property: next, reason });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not pick the next lead.";
      return Response.json({ error: message }, { status: 500 });
    }
  });
}
