# Property OS

Property OS is a property-centered workflow tool for real-estate professionals. It turns a messy CSV lead list into an evidence-backed morning briefing showing the properties an agent should contact first, then keeps every relationship, signal, and next action organized by address — surfaced together on a single command-center dashboard.

**▶ Live app:** https://property-os-morning-briefing.property-os.workers.dev — deployed on Cloudflare Workers + D1, running as a single demo workspace (no login required).

## Project memory

The complete product vision, problem definition, MVP decisions, current architecture, four-agent plan, safety rules, implementation status, and roadmap are preserved in [`docs/PROJECT_MEMORY.md`](docs/PROJECT_MEMORY.md). Future contributors and coding agents should read it before making changes.

The detailed orchestration design is in [`REAL_ESTATE_AGENT_ORCHESTRATION.md`](REAL_ESTATE_AGENT_ORCHESTRATION.md).

## Team members

- Mitra Kermanian

## First P0 feature

Upload a CSV containing property leads and receive a ranked **Top 3 properties to contact today** briefing. Every recommendation includes the property, owner, reason for prioritization, source evidence, confidence, and recommended next action. Do-not-contact records are excluded before ranking, and no outreach is sent automatically.

The current `Frontend` branch runs the wider Property OS experience on a **real database** with the **four-agent orchestration** implemented: a home dashboard that shows every module at once (priority queue, neighborhood pulse, reminders, messages, owners, a live map, and recent activity), plus Properties, Property Workspace, Map, To-do, Messages (approvals), and People. Imported leads, notes, tasks, timelines, drafts, and approvals persist across reloads and server restarts. The map is a **real Leaflet/OpenStreetMap tile map** with click-to-prospect lead generation from **live NYC public records**, and the Property Intelligence Agent can read live NYC Open Data (six official sources) in addition to the records the workspace holds. Settings also includes an authorization-gated active-listings connection for REBNY RLS and TRREB; it remains locked unless the workspace confirms its board authorization/data agreement and the server has board-issued RESO credentials. The interface uses a warm "amber glass" theme.

## Run locally

```bash
cd web
npm install
npm run dev
```

Copy the environment template and add the class key when it is available:

```powershell
Copy-Item .env.example .env.local
```

Open `http://localhost:3000`. The workspace starts **empty** (no demo data). Click **Import leads** and upload the sample file at [`web/tests/fixtures/messy-leads.csv`](web/tests/fixtures/messy-leads.csv), or **any CSV of your own** — there are no required column names.

Property OS recognizes the file rather than imposing a schema: it matches headers loosely (`Property Address`, `Seller`, `Comments`, `Last Touch`… all resolve), and for anything the headers don't reveal it infers the column from the data — addresses by their shape, owners by name-like values, dates by parseability, and notes by being the free-text column. Files exported **without a header row** import too. Only a column containing addresses is genuinely needed, since the whole product is organized by address.

`ANTHROPIC_API_KEY` is optional — without it, the agents use a labeled deterministic fallback, so the app works offline.

## Deploy

Property OS deploys to **Cloudflare Workers + D1** (free tier). Step-by-step instructions are in [`web/DEPLOY.md`](web/DEPLOY.md); the short version, from `web/`:

```powershell
npx wrangler login
npx wrangler d1 create property-os     # copy the database_id it prints
$env:D1_DATABASE_NAME="property-os"; $env:D1_DATABASE_ID="<id>"; npm run build
npx wrangler deploy                    # run from web/, prints your live URL
```

Tables are created automatically on the first request; the deployed app runs as a single "Local Developer" workspace unless Google OAuth is configured.

## Test

```bash
cd web
npm test
```

The test suite evaluates 20 intentionally messy notes against human labels, verifies deterministic do-not-contact enforcement, tests the Claude structured-output path with a fake client, creates a production build, and verifies the rendered application output.

## Architecture

- **Auth & multi-tenancy:** Google OAuth sign-in + signed session cookies, with full per-workspace data isolation (`users`/`workspaces`/`workspace_members`, `workspace_id` on every table, every query scoped via an `AsyncLocalStorage` context). Set `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`SESSION_SECRET` to require sign-in; with them unset the app runs locally as an auto-provisioned "Local Developer" user (no login needed).
- **Persistence:** Cloudflare D1 (SQLite) via Drizzle ORM — the same store locally (miniflare, persisted to `web/.wrangler/state`) and in production (Cloudflare D1). The schema is created idempotently on first use with **no demo data seeded** — a new workspace starts empty. Tables cover properties, people, signals, timeline, tasks, contact permissions, contacts, a do-not-contact suppression list, model runs, approvals, and an append-only audit log.
- **Four agents** (`web/lib/agents/`): an **Orchestrator** routes intent and coordinates three specialists as tools — **Follow-Up** (motivation, timing, sentiment), **Property Intelligence** (signals, priority), and **Outreach & Compliance** (drafts, never sends). Each has a deterministic local fallback so the app works with no API key.
- **Property data ingestion (swappable):** the Property Intelligence Agent analyzes a normalized `PropertyContext` from a `PropertyDataProvider` — it never fetches or scrapes. The default provider reads workspace/CRM data; a live provider (`GET /api/property/lookup?address=…&source=nyc`) pulls real NYC Open Data from all six official sources — GeoSearch (BBL/BIN), PLUTO (facts), HPD (violations), DOB (permits), and ACRIS (deeds, mortgages, transfers via legals → master) — tagging every fact with its source and retrieval time. Public records never supply phone, email, contact permission, or sale intent — those stay CRM-only and are surfaced as `missingInformation`. Set `PROPERTY_DATA_PROVIDER=nyc` to make the live source the default.
- **Extraction:** Anthropic Claude Haiku 4.5 (`claude-haiku-4-5`) with JSON-schema structured output, optional Claude Opus 4.8 fallback for low-confidence records (disabled by default).
- **Safety and ranking:** deterministic TypeScript validates dates and evidence, excludes do-not-contact records, owns priority scoring, and enforces the compliance gate. The model cannot override do-not-contact or send anything.
- **Opportunity map + lead prospecting:** a real Leaflet/OpenStreetMap tile map plots your properties. **Click any block** and Property OS pulls the real tax lots there from NYC PLUTO, ranks them as leads with a stated reason for every point, and one click turns a candidate into a real property workspace. A **"Next lead →"** action always answers "who do I work now?" with the reason it was chosen.
- **Free reminders + direct mail:** desktop notifications for due follow-ups (browser API, no service), `.ics` calendar export so your own calendar reminds you when the app is closed, and print-ready letters for prospected owners — the mailing address comes free from public records. Paid SMS is optional and off by default.
- **Human approval gate + real delivery:** drafted outreach is held as a `pending` approval. Approving with a recipient **actually sends** — email via Resend, SMS via Twilio — and the compliance gate is **re-checked at send time**. Nothing sends autonomously, and voice calls are never auto-dialed (TCPA); the approved script goes to a person.
- **Contact data (skip tracing):** public records carry no phone numbers, so a vendor-agnostic `ContactDataProvider` seam (`web/lib/contacts/provider.ts`) adds them on demand — a generic HTTP adapter (with a BatchData preset) that any vendor plugs into via env, plus a bulk CSV export/import path for the cheapest option. Every number that enters the workspace passes the same compliance gate.
- **Licensed active listings:** Settings offers REBNY RLS (NYC) and TRREB (GTA) as explicit choices. A workspace must attest board/brokerage authorization and an executed IDX/VOW/data-feed agreement. Search activates only when the corresponding server-side RESO Property endpoint and access token are configured; no credential is stored in D1 or exposed to the browser, and the app never presents public records as MLS data.
- **Compliance controls (enforced at send time):** cold **SMS is off by default** (TCPA); calls and texts are blocked outside **8am–9pm** quiet hours; a **workspace-wide do-not-contact list** blocks a number/email on every property and channel; and every email gets a **CAN-SPAM footer** (sender, physical address, opt-out). See `web/lib/agents/compliance.ts`.
- **Audio:** the browser Web Speech API reads the generated morning briefing aloud and supported browsers can dictate command-bar queries. Reliable cross-browser transcription and automated calling are outside this MVP.
- **Observability:** every agent/model call is logged to `model_runs` and shown in the agent-activity panel; every consequential write is logged to `audit_log`.

## Environment variables

Secrets belong in `.env.local` or `.env`, both ignored by Git. Copy `web/.env.example`, add `ANTHROPIC_API_KEY`, and never expose it through a `NEXT_PUBLIC_` variable. If no key is configured or Claude is unavailable, the app uses a labeled deterministic fallback so the demo still works without pretending that Claude ran.
