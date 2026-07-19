# Property OS web app

This folder contains the runnable Morning Briefing MVP.

- `app/page.tsx` provides CSV selection and the briefing interface.
- `app/api/briefing/route.ts` accepts the uploaded CSV data.
- `lib/briefing.ts` validates, ranks, and explains the lead recommendations.
- `tests/briefing.test.mjs` verifies the real import and prioritization output.

Run `npm install`, then `npm run dev`. Run the complete verification suite with `npm test`.
