# Property OS web app

This folder contains the runnable Property OS MVP and its broader product demonstration.

- `app/page.tsx` provides Morning Briefing (with the "Ask Property OS" orchestrator bar and agent-activity panel), Properties, Property Workspace, Map Intelligence, Tasks, Approvals, CSV upload, and browser audio controls — all backed by the database.
- `db/` holds the Drizzle schema (`schema.ts`), the persistence + audit-logging repository (`repo.ts`), and the D1 binding accessor (`index.ts`). Cloudflare D1 (SQLite) persists locally under `.wrangler/state`; the schema is created and demo data seeded on first use.
- `lib/agents/` holds the four agents: `orchestrator.ts`, `follow-up.ts`, `property-intelligence.ts`, `outreach-compliance.ts`, plus `compliance.ts` (deterministic gates), `anthropic.ts` (shared Claude helper), and `property-context.ts` (the `PropertyContext` + `PropertyDataProvider` contract). Agents are pure and DB-free.
- `lib/data/` holds the swappable data providers: `workspace-provider.ts` (default, the workspace's own records → `PropertyContext`), `nyc-provider.ts` (live NYC GeoSearch + PLUTO + HPD + DOB + ACRIS), and `provider.ts` (the factory). Exposed via `GET /api/property/lookup?address=…&source=workspace|nyc`. The agent analyzes the context and never fetches; phone/email/consent/sale-intent are always `missingInformation`.
- `lib/demo-data.ts` is the seed data for the workspace.
- `app/api/` exposes `briefing`, `orchestrator`, `properties` (list/note/mark-called), `tasks` (list/toggle), `approvals` (list/decide), and `trace`. All keep the Anthropic key server-side and fall back safely if Claude is unavailable.
- `lib/extraction.ts` extracts structured note fields with Claude Haiku 4.5 and enforces deterministic safeguards.
- `lib/briefing.ts` validates, ranks, explains, and maps imported leads to persisted property records.
- `tests/fixtures/messy-leads.csv` and `tests/fixtures/messy-leads-expected.json` are test-only benchmark data (a 20-row messy-note sample + human labels). They are not served by the app or seeded anywhere.

## Run

```bash
npm install
Copy-Item .env.example .env.local
npm run dev
```

Add the class Anthropic key to `.env.local`. Without it, the application remains demonstrable and clearly labels the run as `Local extraction fallback`.

Run the complete verification suite with `npm test`.

Read [`../docs/PROJECT_MEMORY.md`](../docs/PROJECT_MEMORY.md) before making material product or architecture changes.
