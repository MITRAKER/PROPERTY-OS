# Property OS

Property OS is a property-centered workflow tool for real-estate professionals. The first MVP feature turns a CSV lead list into an evidence-backed morning briefing showing the three properties an agent should contact first.

## Project memory

The complete product vision, problem definition, MVP decisions, current architecture, four-agent plan, safety rules, implementation status, and roadmap are preserved in [`docs/PROJECT_MEMORY.md`](docs/PROJECT_MEMORY.md). Future contributors and coding agents should read it before making changes.

The detailed orchestration design is in [`REAL_ESTATE_AGENT_ORCHESTRATION.md`](REAL_ESTATE_AGENT_ORCHESTRATION.md).

## Team members

- Mitra Kermanian

## First P0 feature

Upload a CSV containing property leads and receive a ranked **Top 3 properties to contact today** briefing. Every recommendation includes the property, owner, reason for prioritization, source evidence, confidence, and recommended next action. Do-not-contact records are excluded before ranking, and no outreach is sent automatically.

The current `Frontend` branch runs the wider Property OS experience on a **real database** with the **four-agent orchestration** implemented: Morning Briefing (with an "Ask Property OS" orchestrator bar and agent-activity panel), Properties, Property Workspace, Map Intelligence, Tasks, and Approvals. Imported leads, notes, tasks, timelines, drafts, and approvals persist across reloads and server restarts. The map remains a stylized demo visualization, and there is no live public-record integration yet — the Property Intelligence Agent interprets only the records the workspace holds.

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

Open `http://localhost:3000` and choose **Use 20 messy demo leads**, or upload your own CSV with these columns:

```text
address,owner_name,last_contact,follow_up_date,notes
```

## Test

```bash
cd web
npm test
```

The test suite evaluates 20 intentionally messy notes against human labels, verifies deterministic do-not-contact enforcement, tests the Claude structured-output path with a fake client, creates a production build, and verifies the rendered application output.

## Architecture

- **Auth & multi-tenancy:** Google OAuth sign-in + signed session cookies, with full per-workspace data isolation (`users`/`workspaces`/`workspace_members`, `workspace_id` on every table, every query scoped via an `AsyncLocalStorage` context). Set `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`SESSION_SECRET` to require sign-in; with them unset the app runs locally as an auto-provisioned "Local Developer" user (no login needed).
- **Persistence:** Cloudflare D1 (SQLite) via Drizzle ORM. Locally it runs on miniflare and persists to `web/.wrangler/state`; on first run it creates the schema and seeds demo data. Tables cover properties, people, signals, timeline, tasks, contact permissions, model runs, approvals, and an append-only audit log.
- **Four agents** (`web/lib/agents/`): an **Orchestrator** routes intent and coordinates three specialists as tools — **Follow-Up** (motivation, timing, sentiment), **Property Intelligence** (signals, priority), and **Outreach & Compliance** (drafts, never sends). Each has a deterministic local fallback so the app works with no API key.
- **Property data ingestion (swappable):** the Property Intelligence Agent analyzes a normalized `PropertyContext` from a `PropertyDataProvider` — it never fetches or scrapes. The default provider reads workspace/CRM data; a live provider (`GET /api/property/lookup?address=…&source=nyc`) pulls real NYC Open Data from all six official sources — GeoSearch (BBL/BIN), PLUTO (facts), HPD (violations), DOB (permits), and ACRIS (deeds, mortgages, transfers via legals → master) — tagging every fact with its source and retrieval time. Public records never supply phone, email, contact permission, or sale intent — those stay CRM-only and are surfaced as `missingInformation`. Set `PROPERTY_DATA_PROVIDER=nyc` to make the live source the default.
- **Extraction:** Anthropic Claude Haiku 4.5 (`claude-haiku-4-5`) with JSON-schema structured output, optional Claude Opus 4.8 fallback for low-confidence records (disabled by default).
- **Safety and ranking:** deterministic TypeScript validates dates and evidence, excludes do-not-contact records, owns priority scoring, and enforces the compliance gate. The model cannot override do-not-contact or send anything.
- **Opportunity map + lead prospecting:** a real Leaflet/OpenStreetMap tile map plots your properties. **Click any block** and Property OS pulls the real tax lots there from NYC PLUTO, ranks them as leads with a stated reason for every point, and one click turns a candidate into a real property workspace. A **"Next lead →"** action always answers "who do I work now?" with the reason it was chosen.
- **Free reminders + direct mail:** desktop notifications for due follow-ups (browser API, no service), `.ics` calendar export so your own calendar reminds you when the app is closed, and print-ready letters for prospected owners — the mailing address comes free from public records. Paid SMS is optional and off by default.
- **Human approval gate + real delivery:** drafted outreach is held as a `pending` approval. Approving with a recipient **actually sends** — email via Resend, SMS via Twilio — and the compliance gate (do-not-contact + channel permission) is **re-checked at send time**. Nothing sends autonomously, and voice calls are never auto-dialed (TCPA); the approved script goes to a person.
- **Audio:** the browser Web Speech API reads the generated morning briefing aloud. Speech-to-text and automated calling are outside this MVP.
- **Observability:** every agent/model call is logged to `model_runs` and shown in the agent-activity panel; every consequential write is logged to `audit_log`.

## Environment variables

Secrets belong in `.env.local` or `.env`, both ignored by Git. Copy `web/.env.example`, add `ANTHROPIC_API_KEY`, and never expose it through a `NEXT_PUBLIC_` variable. If no key is configured or Claude is unavailable, the app uses a labeled deterministic fallback so the demo still works without pretending that Claude ran.
