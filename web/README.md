# Property OS web app

This folder contains the runnable Morning Briefing MVP.

- `app/page.tsx` provides CSV upload, run metrics, confidence labels, and browser audio controls.
- `app/api/briefing/route.ts` keeps the Anthropic key server-side and falls back safely if Claude is unavailable.
- `lib/extraction.ts` extracts structured note fields with Claude Haiku 4.5 and enforces deterministic safeguards.
- `lib/briefing.ts` validates, ranks, and explains the property recommendations.
- `public/messy-leads.csv` is the 20-row messy-note demo input.
- `data/messy-leads-expected.json` contains separate human labels for repeatable evaluation.

## Run

```bash
npm install
Copy-Item .env.example .env.local
npm run dev
```

Add the class Anthropic key to `.env.local`. Without it, the application remains demonstrable and clearly labels the run as `Local extraction fallback`.

Run the complete verification suite with `npm test`.
