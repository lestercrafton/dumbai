# Moving Big Vin to Cloudflare (Workers + D1, free plan)

## Current state (October 19, 2026)

Live in parallel at **https://big-vin.sitetime.workers.dev** (Worker `big-vin`, D1 `big-vin`; `sitetime` is the account's existing workers.dev subdomain). The ChatGPT Sites site is still the primary and the runner's `BIG_VIN_SITE_URL` is unchanged.

- Seeded from what is recoverable without the ChatGPT Sites export: the bundled bootstrap forecasts (`initialize`), every forecast and result the old site's public `/api/results` shows (all sports, cohorts, model versions and weeks; `scripts/public-recovery.mjs`, rows carry `payload.recovery`), its public learning log, collection reports from the runner's latest checkpoint artifact (`scripts/checkpoint-recovery.mjs`), and ESPN finals since each bundled history ends (`scripts/backfill-finals.mjs`, historical-only collector posts).
- Missing until the export (about October 24): first-seen market rows, pick revision rows, the feed cache, older collection runs, and anything the public pages do not show. Import it with `scripts/d1-import-from-export.mjs --additive` so rows already here are kept.
- Dual write: `big-vin-daily.yml` loads `scripts/mirror-writes.mjs` on its site-writing steps. Each POST to the primary `/api/` is repeated to the Cloudflare site with a GitHub OIDC token for audience `https://big-vin.sitetime.workers.dev` (`COLLECTOR_AUDIENCE` in `wrangler.cloudflare.jsonc`). Failures only warn; the run summary has a “Cloudflare copy” section.
- Writes made directly here use the Worker secret `BIG_VIN_ADMIN_TOKEN`, kept on the box in `~/.config/big-vin-cloudflare/admin-token`.

`wrangler.cloudflare.jsonc` deploys the normal `npm run build` output (`dist/server` as the Worker, `dist/client` as static assets) with D1 bound as `DB`, the same binding the site already reads through `cloudflare:workers` in `lib/db.ts`. There is no adapter layer to swap: the ChatGPT Sites build is already a Cloudflare Worker, and nothing OpenAI-specific ships in `dist/server`. The only secret the site reads is `BIG_VIN_ADMIN_TOKEN` (optional; the runner signs in with GitHub OIDC).

Checked on the box (Oct 19, 2026): `npm run build` + `wrangler deploy --dry-run` → 6.5 MiB, **913 KiB gzipped** (free limit is 3 MiB). All drizzle migrations 0000–0005 apply cleanly to a fresh local D1. An export made with `scripts/site-export-client.mjs` imported into that D1 with matching row counts.

## Steps (run in `big-vin/site`, Node 22)

1. Sign in: `npx wrangler whoami` must show the Cloudflare account Big Vin should live in, with a token that can edit Workers scripts and D1. Otherwise run `npx wrangler login` (browser), or set `CLOUDFLARE_API_TOKEN` to a token with *Workers Scripts: Edit* and *D1: Edit*, plus `CLOUDFLARE_ACCOUNT_ID`.
2. `npm ci && npm run build`
3. `npx wrangler d1 create big-vin` and put the printed `database_id` into `wrangler.cloudflare.jsonc`.
4. `npx wrangler d1 migrations apply big-vin --remote --config wrangler.cloudflare.jsonc`
5. Download the `big-vin-site-export-<run>` artifact from the **Site data export** workflow, unzip it to `./export`, and check `sha256sum -c SHA256SUMS` inside it.
6. `node scripts/d1-import-from-export.mjs ./export ./import-sql`
   `for f in ./import-sql/data-*.sql; do npx wrangler d1 execute big-vin --remote --config wrangler.cloudflare.jsonc --file "$f" || break; done`
   The import skips `d1_migrations` (step 4 rebuilt it), loads foreign-key parents first, and splits long cells under D1's 100 KB statement limit. Pass `--additive` when the database already has rows (it does now): existing rows are kept and the count of skipped duplicates is reported.
7. Check the counts: `npx wrangler d1 execute big-vin --remote --config wrangler.cloudflare.jsonc --file ./import-sql/verify-counts.sql` must match `./import-sql/expected-counts.json` and the export's `counts.json`.
8. Optional: `npx wrangler secret put BIG_VIN_ADMIN_TOKEN --config wrangler.cloudflare.jsonc`
9. `npx wrangler deploy --config wrangler.cloudflare.jsonc`, then open `/`, `/weekly-results`, `/notes/october-19-2026`, `/challengers`, `/scoreboard` and `/api/playbook?view=versions` on the workers.dev URL.
10. Cutover: point `BIG_VIN_SITE_URL` in `.github/workflows/big-vin-daily.yml` (and the default in `big-vin/scripts/cloud-state.mjs`) at the new URL. The collector's OIDC audience is a fixed string on both sides (`COLLECTOR_AUDIENCE` here, `SITE_URL` in `big-vin/lib/collector-access.mjs`), so runner sign-in keeps working without changing it. Keep chatgpt.site up until the first scheduled run lands on the new site.

If the live database has a table that no drizzle migration creates, step 6 fails with `no such table`; create it from the export's `schema.json` `sql` for that table, then rerun the failed file (inserts are plain, so rerun only files that did not finish).

## Free plan limits to watch

- Workers: 100,000 requests/day and 10 ms CPU per request. Page rendering is the most likely thing to hit the CPU cap; check `wrangler tail` for `exceededCpu` after the deploy.
- D1: 5 GB storage, 5 million rows read and 100,000 rows written per day. The import counts toward that day's writes.
