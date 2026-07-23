# Property OS — demo script (3–4 minutes)

**Live app:** https://property-os-morning-briefing.property-os.workers.dev
Local alternative: `cd web && npm run dev` → `http://localhost:3000`

**Before you start:** the workspace starts empty by design. Have
`web/tests/fixtures/messy-leads.csv` open in your file picker, ready to upload.

---

## 0. The one-liner (15s)

> "Property OS tells a real-estate agent which property to work next — ranked by
> evidence from real public records — and drafts the outreach, but never sends
> anything without a human's OK."

## 1. The success moment: messy CSV → today's plan (60s)

1. Open the app. Point at the empty dashboard: *"No fake data. This is a real
   product, so it starts empty."*
2. **Import leads** → upload `messy-leads.csv` (20 intentionally messy rows —
   inconsistent dates, free-text notes).
3. The **Who to call first** queue fills in: each property shows the owner, an
   opportunity score, the reason it ranked, and a confidence dot.
4. Call out the key safety point: a **do-not-contact** row was excluded before
   ranking. *"That's deterministic code, not the model — the AI cannot override it."*

## 2. Everything on one screen (30s)

Scroll the dashboard once, naming each panel: priority queue, neighborhood pulse,
reminders, **Messages** (drafts awaiting approval), **People** (owners), the
**live map**, and **recent activity**.

> "An agent sees their entire day in one screen instead of hunting through tabs."

## 3. Ask the assistant (30s)

In **How can I help today?**:

1. Type *"Who should I call today?"* → the orchestrator returns ranked
   recommendations with reasons.
2. Type *"Draft an email for 88 Linden Avenue"* → it writes a draft and **holds it
   for approval**. Nothing is sent.

> "One orchestrator routes to three specialists. Each has a deterministic fallback,
> so the demo works even with no API key."

## 4. Real property intelligence + map prospecting (45s)

1. Open a property → **Get full details** → pulls real NYC records: BBL, assessed
   value, year built, violations, permits — **each fact tagged with its source**.
2. Go to **Map** → **click any block** → Property OS pulls the real tax lots there
   from NYC PLUTO and ranks them as new leads, with a stated reason for each.
3. Click **Add as lead** to turn a candidate into a real property workspace.

> "This is how an agent finds new listings without buying a lead list."

## 5. Compliance + the approval gate (30s)

1. Go to **Messages** → approve a draft. The **compliance gate re-runs at send
   time**: do-not-contact, channel permission, 8am–9pm quiet hours, and the
   workspace-wide do-not-contact list.
2. Note: **cold SMS is off by default** (TCPA), and voice is never auto-dialed —
   a person places the call.

> "Public records carry no phone numbers, so numbers come from an authorized
> skip-trace vendor or a CSV — and every one passes the same gate."

## Close (15s)

> "Property-centered, evidence-backed, human-approved. Built on a free stack,
> deployed on Cloudflare, and it starts empty because it's a real product —
> not a demo."

---

## If something is slow or fails

- **NYC enrichment / map prospecting** call live public APIs. If one is slow, fall
  back to a property already imported from the CSV.
- **No Anthropic key needed** — the agents use a labeled deterministic fallback,
  so the flow never dead-ends.
- **Empty map** just means no imported property has coordinates yet; enrich one
  first, or click the map to prospect.
