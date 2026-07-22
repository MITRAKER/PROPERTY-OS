import { analyzePropertyContext } from "../../../../lib/agents/property-intelligence.ts";
import { createPropertyDataProvider } from "../../../../lib/data/provider.ts";
import { listProperties, logModelRun } from "../../../../db/repo";
import { withAuth } from "../../../../lib/auth/server.ts";

// GET /api/property/lookup?address=...&source=demo|nyc
export async function GET(request: Request) {
  return withAuth(request, async () => {
    const url = new URL(request.url);
    const address = url.searchParams.get("address")?.trim();
    const source = url.searchParams.get("source") ?? process.env.PROPERTY_DATA_PROVIDER ?? "workspace";

    if (!address) {
      return Response.json({ error: "Provide an address, e.g. ?address=120 Broadway." }, { status: 400 });
    }

    try {
      const provider = createPropertyDataProvider(source, source.toLowerCase() === "nyc" ? undefined : await listProperties());
      const context = await provider.getByAddress(address);

      const { report, run } = analyzePropertyContext(context);
      try {
        await logModelRun(run);
      } catch (logError) {
        console.error("Model-run logging failed:", logError);
      }

      return Response.json({ provider: provider.name, context, report });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The property lookup failed.";
      const status = /could not resolve|no workspace property|not found/i.test(message) ? 404 : 502;
      return Response.json({ error: message, source }, { status });
    }
  });
}
