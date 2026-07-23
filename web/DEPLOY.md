# Deploying Property OS to a live URL (Cloudflare Workers + D1)

Property OS is a Cloudflare Workers app (vinext) with a Cloudflare **D1** database.
`npm run build` generates a ready-to-deploy `dist/server/wrangler.json`; the only
thing it needs is *your* real D1 database id, supplied through an env var.

The result is a public URL like
`https://property-os-morning-briefing.<your-subdomain>.workers.dev`.

Everything below is free-tier. Run it from the `web/` folder.

> All commands run from the **`web/`** folder (the `build` script lives here, not
> in the project root). `cd web` first.

## One-time setup

1. **Sign in to Cloudflare** (opens a browser to authorize):
   ```
   npx wrangler login
   ```

2. **Create the database** and copy the `database_id` it prints:
   ```
   npx wrangler d1 create property-os
   ```
   Ignore the `"d1_databases"` binding snippet wrangler suggests — you don't edit
   any config. The app's binding is already `DB`; you only need the `database_id`.

## Build + deploy

3. **Point the build at your database**, then build (from `web/`):

   PowerShell:
   ```powershell
   cd web
   $env:D1_DATABASE_NAME = "property-os"
   $env:D1_DATABASE_ID   = "<the id from step 2>"
   npm run build
   ```
   bash:
   ```bash
   cd web
   D1_DATABASE_NAME=property-os D1_DATABASE_ID=<the id from step 2> npm run build
   ```

4. **Deploy from `web/`** (NOT from `dist/server`). The build wrote
   `.wrangler/deploy/config.json`, which points wrangler at the built worker, so
   this one command is all you need:
   ```
   npx wrangler deploy
   ```
   Running it inside `dist/server` makes wrangler find two configs and error out.
   Wrangler prints your live URL. Open it — the database tables are created
   automatically on the first request, and the app starts on an empty workspace.

## Secrets (optional)

Set from anywhere with `--name property-os-morning-briefing`:

- **Claude key** (optional — the app works without it via the local fallback):
  ```
  npx wrangler secret put ANTHROPIC_API_KEY --name property-os-morning-briefing
  ```
- **Google sign-in** is OFF by default, which is the simplest demo: the app runs
  as a single "Local Developer" workspace with no login. To enable real sign-in,
  set `SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` as secrets and
  add `https://<your-url>/api/auth/callback` as an authorized redirect URI in the
  Google Cloud console.
- **Outreach/compliance** (only if you demo real sending): `RESEND_API_KEY`,
  `OUTREACH_FROM_EMAIL`, `OUTREACH_MAILING_ADDRESS`, Twilio keys, etc. See
  `.env.example`. Not needed for the core demo.

## Redeploying after changes

Repeat steps 3–4 (build with the same env vars, then `wrangler deploy`).

## Demo path on the live site

1. Open the URL.
2. On the home dashboard, **Import leads** → upload `tests/fixtures/messy-leads.csv`.
3. You get the top-3 priority queue with evidence, and the do-not-contact row is
   excluded — that's the MVP success moment.
4. Then show: **Map** (click a block to prospect real NYC parcels), a property's
   **Enrich from NYC records**, the **Ask** assistant, and the **Messages**
   approval + compliance gate.
