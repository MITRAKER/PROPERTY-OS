import { generateBriefingFromLeads, parseLeadCsv } from "../../../lib/briefing.ts";
import { extractLeadsWithAnthropic, extractLocally } from "../../../lib/extraction.ts";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { csvText?: unknown };
    if (typeof body.csvText !== "string" || body.csvText.trim().length === 0) {
      return Response.json({ error: "Upload a CSV file before generating the briefing." }, { status: 400 });
    }

    const { leads, rejectedRows } = parseLeadCsv(body.csvText);
    const now = new Date();
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    let batch;

    if (apiKey) {
      try {
        batch = await extractLeadsWithAnthropic(leads, {
          apiKey,
          model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5",
          fallbackModel: process.env.ANTHROPIC_FALLBACK_MODEL || "claude-opus-4-8",
          enableOpusFallback: process.env.ANTHROPIC_ENABLE_OPUS_FALLBACK === "true",
          now,
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Unknown provider error";
        console.error("Claude extraction failed; using local fallback:", detail);
        batch = extractLocally(
          leads,
          now,
          "Claude was unavailable, so this run used the deterministic local fallback. Review the evidence before acting.",
        );
      }
    } else {
      batch = extractLocally(
        leads,
        now,
        "No Anthropic API key is configured. This run used the deterministic local fallback.",
      );
    }

    return Response.json(
      generateBriefingFromLeads(leads, batch.extractions, rejectedRows, batch.metrics, now),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "The briefing could not be generated.";
    return Response.json({ error: message }, { status: 400 });
  }
}
