import { NycPropertyDataProvider } from "../../../../lib/data/nyc-provider.ts";
import { analyzePropertyContext } from "../../../../lib/agents/property-intelligence.ts";
import { enrichProperty, getProperty, logModelRun } from "../../../../db/repo";
import { withAuth } from "../../../../lib/auth/server.ts";

// Pull real NYC public records for a property and persist them onto its workspace.
export async function POST(request: Request) {
  return withAuth(request, async () => {
    try {
      const body = (await request.json()) as { propertyId?: unknown };
      const propertyId = typeof body.propertyId === "string" ? body.propertyId : "";
      if (!propertyId) return Response.json({ error: "propertyId is required." }, { status: 400 });

      const property = await getProperty(propertyId);
      if (!property) return Response.json({ error: "Property not found." }, { status: 404 });

      const query = property.neighborhood && property.neighborhood !== "Imported lead"
        ? `${property.address}, ${property.neighborhood}`
        : property.address;

      const context = await new NycPropertyDataProvider().getByAddress(query);
      const { report, run } = analyzePropertyContext(context);
      try {
        await logModelRun(run);
      } catch (logError) {
        console.error("Model-run logging failed:", logError);
      }

      const updated = await enrichProperty(propertyId, context);
      return Response.json({ property: updated, report, context });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Enrichment failed.";
      const status = /could not resolve|not found/i.test(message) ? 404 : 502;
      return Response.json({ error: message }, { status });
    }
  });
}
