# Property OS

Property OS is a property-centered workflow tool for real-estate professionals. The first MVP feature turns a CSV lead list into an evidence-backed morning briefing showing the three properties an agent should contact first.

## Team members

- Mitra Kermanian

## First P0 feature

Upload a CSV containing property leads and receive a ranked **Top 3 properties to contact today** briefing. Every recommendation includes the property, owner, reason for prioritization, source evidence, and recommended next action.

## Run locally

```bash
cd web
npm install
npm run dev
```

Open `http://localhost:3000` and choose **Use demo leads**, or upload your own CSV with these columns:

```text
address,owner_name,last_contact,follow_up_date,notes
```

## Test

```bash
cd web
npm test
```

The test suite exercises the CSV import and prioritization logic, creates a production build, and verifies the rendered application output.

## Environment variables

Secrets belong in `.env`, which is ignored by Git. Copy `web/.env.example` if environment-specific values are added later. This first feature does not require an external AI key because its evidence-backed prioritization rules run locally.
