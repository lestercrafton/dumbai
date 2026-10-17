# Big Vin website: agent editing guide

The shared website source is `big-vin/site/` in https://github.com/lestercrafton/dumbai, separate from its existing collector package in `big-vin/`. Start from the repository's current `main`; do not overwrite newer source from an old ZIP. Keep website changes inside this package unless a task explicitly concerns the collector.

## Runtime and public link

Production is already hosted remotely at https://big-vin-grind-to-win.sunlightisfree.chatgpt.site. Its Worker and D1 database do not need Lester's Mac to be on. Preserve this public address, audience, `.openai/hosting.json` project identity and `DB` binding. The existing GitHub-hosted `big-vin-daily.yml` workflow handles scheduled collection and scores independently of any local computer. Do not change its OIDC authorization or unrelated Milly workflows.

## Edit and verify

Use Node 22.13 or newer and the committed lockfile. With dependencies available, run:

```sh
npm run check
npm run build
```

For a local preview, initialize only the local database with `npx wrangler d1 migrations apply DB --local --config wrangler.local.jsonc`, then `npm run dev`. Inspect desktop and 320/390px phone layouts, touch targets, keyboard focus and horizontal overflow for UI changes. Do not copy production data or secrets into GitHub. Never commit `.env*`, `.dev.vars*`, local databases, credentials, `node_modules`, build outputs or browser artifacts.

Keep the original saved sides, prices, grades, capture times and formula ownership. Live provisional ATS color is separate from settled grading. Search/time filters must retain original board ranks. Sports remain separate. Read `TRACKED-HISTORY.md` and `CFB-FEED-FIX.md` before changing records or feeds. Operating-cost claims were removed; do not restore invented free/zero-cost figures or publish private billing records.

Game-card BV ML uses the existing fair-spread conversion and is labeled an estimate. Vegas ML must use actual same-team bookmaker odds from `moneylineMarket`, retaining its own provider and observation time. This feed quote is separate from the frozen ATS market; missing ML stays unavailable. ML Value is the BV estimated win chance minus the quoted price’s break-even chance, in percentage points (pp), including book margin; missing quotes also leave value unavailable. Never substitute ATS juice, derive a quote from the Vegas spread, or call historical feed prices verified pregame odds.

Brand assets `public/bv-logo.svg` and `bv-wordmark.svg` preserve the original header's Geist glyphs, weight, spacing and proportions as paths. Use those exact assets for sharing and icons; do not redraw the mark in another font. `big-vin-share.svg` is the editable share-image source, with a versioned PNG referenced by root Open Graph and Twitter metadata. Icon metadata uses the same original mark.

The user chose FIJI purple and white: `app/fiji-theme.css` owns the light theme using #520975 and #7d4798 from phigam.org's stylesheet. Logo shapes remain unchanged when recolored. Keep the green/yellow ATS status outlines distinct from the purple brand palette, and neutral styling for uncertain scores.

## Publish from any connected agent environment

A GitHub push runs source checks; it does **not** automatically publish the existing Site. A cloud agent can publish without using Lester's Mac when its Sites connector and build environment are available:

1. Read the current Sites skill, get this existing Site, request its short-lived source credential and use the supported source helper to open its managed checkout in a separate directory. Never replace this GitHub repository's `.git` with the Sites repository.
2. Export the committed `big-vin/site/` package from GitHub into that checkout using `git archive HEAD:big-vin/site` from the GitHub checkout. Review source differences and deletions before applying the archive; do not overwrite a different Site identity. Preserve any newer remote edits and record the GitHub commit used.
3. Run the supported Sites source workflow with the opening result, remaining checks/build and archive path. It owns the Site commit/push/package. Save and deploy that exact result to existing project `appgprj_6aa0ff29e7948191857b18c0d737f893`, keeping its public audience.
4. Verify the deployed version and behavior, and report the GitHub commit and Site version. Update the same source Library ZIP when requested. If a connector is unavailable, report the exact publication limit; do not claim a GitHub push changed production.

Credentials stay in session memory and travel through stdin only. Do not persist short-lived Sites tokens in GitHub secrets or reuse collector OIDC as deployment authorization. No new hosting account, paid service, access grant or runtime migration is required for normal edits.
