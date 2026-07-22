# Property OS Agent Instructions

Before changing this repository, read [`docs/PROJECT_MEMORY.md`](docs/PROJECT_MEMORY.md). It is the canonical source for product intent, scope, architecture, safety rules, current implementation, and roadmap.

Working rules:

- Preserve Property OS as a property-centered product. The property, not the person, is the primary workspace.
- Keep the first P0 workflow working end to end: messy lead CSV -> structured extraction -> deterministic safeguards and ranking -> evidence-backed priority queue.
- Never claim demo data is live public-record data.
- Never automate calls, texts, emails, letters, or other consequential actions without explicit human approval. Outreach delivery is implemented (`web/lib/outreach/delivery.ts`) but MUST stay human-triggered: re-run the compliance gate at send time, and never auto-dial voice calls.
- Keep secrets server-side and out of Git. Never expose `ANTHROPIC_API_KEY` through a `NEXT_PUBLIC_` variable.
- Keep compliance checks, do-not-contact enforcement, scoring, permission checks, and database writes deterministic and testable.
- Treat LLM output as a proposal that must be validated before it affects ranking or actions.
- Persistence is live on Cloudflare D1 (SQLite) via Drizzle. Keep the specialist agents in `web/lib/agents/` pure and database-free; only API routes and `web/db/repo.ts` touch the database. The local schema is bootstrapped in `repo.ts` — mirror any `web/db/schema.ts` change in that `CREATE TABLE` DDL.
- Keep every consequential write in the audit log and every model/agent call in `model_runs`.
- The app is multi-tenant. Every data-table query in `web/db/repo.ts` MUST be scoped to `currentWorkspaceId()` (reads, writes, updates, deletes), and every data API route MUST be wrapped in `withAuth`. Never trust a caller-supplied workspace id; it comes from the signed session only. New data tables need a `workspace_id` column and scoped queries.
- The Property Intelligence Agent must only analyze a normalized `PropertyContext` from a `PropertyDataProvider` (`web/lib/data/`). Agents never fetch or scrape; add new public sources as providers behind `/api/property/lookup`, calling official APIs only. Phone, email, contact permission, and sale intent are CRM-only and must always appear in `missingInformation`.
- Run `npm run lint` and `npm test` from `web/` before calling a change complete.
- Preserve unrelated user files and untracked files in the repository root.
- Update `docs/PROJECT_MEMORY.md` when a product decision, architecture choice, integration, limitation, or milestone materially changes.

The active frontend development branch is `Frontend` unless the user directs otherwise.
