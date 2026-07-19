import { generateBriefing } from "../../../lib/briefing";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { csvText?: unknown };
    if (typeof body.csvText !== "string" || body.csvText.trim().length === 0) {
      return Response.json({ error: "Upload a CSV file before generating the briefing." }, { status: 400 });
    }

    return Response.json(generateBriefing(body.csvText));
  } catch (error) {
    const message = error instanceof Error ? error.message : "The briefing could not be generated.";
    return Response.json({ error: message }, { status: 400 });
  }
}
