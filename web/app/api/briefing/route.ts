import { buildImportedProperties, generateBriefingFromLeads, parseLeadCsv } from "../../../lib/briefing.ts";
import { runFollowUpAgent } from "../../../lib/agents/follow-up.ts";
import { logModelRun, upsertImportedProperties } from "../../../db/repo";
import { withAuth } from "../../../lib/auth/server.ts";

export async function POST(request: Request) {
  return withAuth(request, async () => {
    try {
      const body = (await request.json()) as { csvText?: unknown };
      if (typeof body.csvText !== "string" || body.csvText.trim().length === 0) {
        return Response.json({ error: "Upload a CSV file before generating the briefing." }, { status: 400 });
      }

      const { leads, rejectedRows } = parseLeadCsv(body.csvText);
      const now = new Date();
      const apiKey = process.env.ANTHROPIC_API_KEY?.trim();

      // Follow-Up Agent (Claude when a key is present, deterministic local model otherwise).
      const followUp = await runFollowUpAgent(leads, {
        apiKey,
        model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5",
        fallbackModel: process.env.ANTHROPIC_FALLBACK_MODEL || "claude-opus-4-8",
        enableOpusFallback: process.env.ANTHROPIC_ENABLE_OPUS_FALLBACK === "true",
        now,
      });

      const briefing = generateBriefingFromLeads(leads, followUp.results, rejectedRows, followUp.metrics, now);

      // Persist imported leads (and their follow-up tasks) into the workspace.
      // Persistence failures must not break the briefing response.
      try {
        await upsertImportedProperties(buildImportedProperties(leads, followUp.results, now));
        await logModelRun(followUp.run);
      } catch (persistError) {
        console.error("Briefing persistence failed:", persistError);
      }

      return Response.json(briefing);
    } catch (error) {
      const message = error instanceof Error ? error.message : "The briefing could not be generated.";
      return Response.json({ error: message }, { status: 400 });
    }
  });
}
