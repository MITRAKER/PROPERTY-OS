# Property OS

Property OS is a property-centered workflow tool for real-estate professionals. The first MVP feature turns a CSV lead list into an evidence-backed morning briefing showing the three properties an agent should contact first.

## Team members

- Mitra Kermanian

## First P0 feature

Upload a CSV containing property leads and receive a ranked **Top 3 properties to contact today** briefing. Every recommendation includes the property, owner, reason for prioritization, source evidence, confidence, and recommended next action. Do-not-contact records are excluded before ranking, and no outreach is sent automatically.

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

## MVP model and audio stack

- **Extraction:** Anthropic Claude Haiku 4.5 (`claude-haiku-4-5`) with JSON-schema structured output.
- **Optional fallback:** Claude Opus 4.8 (`claude-opus-4-8`) for low-confidence records only. It is disabled by default to control latency and cost.
- **Safety and ranking:** deterministic TypeScript validates dates and evidence, excludes do-not-contact records, and owns priority scoring.
- **Audio:** the browser Web Speech API reads the generated morning briefing aloud. Speech-to-text and automated calling are outside this MVP.
- **Observability:** each run reports provider, latency, token use, estimated API cost, low-confidence review count, and excluded do-not-contact count.

## Environment variables

Secrets belong in `.env.local` or `.env`, both ignored by Git. Copy `web/.env.example`, add `ANTHROPIC_API_KEY`, and never expose it through a `NEXT_PUBLIC_` variable. If no key is configured or Claude is unavailable, the app uses a labeled deterministic fallback so the demo still works without pretending that Claude ran.
