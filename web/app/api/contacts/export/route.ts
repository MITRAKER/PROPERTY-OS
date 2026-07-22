import { listSkipTraceTargets } from "../../../../db/repo";
import { withAuth } from "../../../../lib/auth/server.ts";
import { buildSkipTraceCsv } from "../../../../lib/contacts/contact-model.ts";

// GET /api/contacts/export?minScore=70
// Vendor-neutral CSV for bulk skip tracing — the cheapest tier. Only includes
// contactable properties above the score threshold that have no contact details
// yet, so you never pay to trace the same record twice.
export async function GET(request: Request) {
  return withAuth(request, async () => {
    try {
      const raw = new URL(request.url).searchParams.get("minScore");
      const minScore = Math.min(Math.max(Number(raw) || 70, 0), 100);
      const targets = await listSkipTraceTargets(minScore);
      const csv = buildSkipTraceCsv(targets);

      return new Response(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="skip-trace-leads-${minScore}plus.csv"`,
          "Cache-Control": "no-store",
        },
      });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Could not build the export." }, { status: 500 });
    }
  });
}
