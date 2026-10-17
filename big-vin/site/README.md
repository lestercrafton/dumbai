# Big Vin · Grind to Win

The existing Big Vin site, redesigned around start-time and team discovery, all-sport game boards, visible scores and saved results. The live model, APIs, data sources, research records, and collector workflows are retained.

## Run locally

Requires Node 22.13 or newer.

```sh
npm ci
npx wrangler d1 migrations apply DB --local --config wrangler.local.jsonc
npm run dev
```

The local migration command creates only a local preview database. Production records and secrets are not included in this source export.

```sh
npm run build
npm run start
```

The production build creates the Cloudflare Workers application in `dist/`. `npm run start` runs that artifact locally. Preserve the existing `.openai/hosting.json` project identity and `DB` binding when publishing an update. This is an update of the existing Big Vin Site, not a new Site.

## Public copy

Pledge copy and source links are in `lib/site-config.ts`. The cost panel and its unverified free/zero-cost placeholders have been removed. Provider subscriptions, plugins, AI usage and hosting cannot be priced from source-code defaults. Keep financial records outside this public source tree.

## Page structure and preserved behavior

The first panel finds games by **Central start time**: Any time, In progress, Upcoming, Before noon, Noon–5 PM, 5 PM onward, or a custom CT clock range. Team search handles full names, abbreviations, aliases and close spellings. A shared abbreviation such as MSU returns every matching team on the selected board. Filters retain original server ranks; sorting by time changes display order only.

League and Full card / Top 3 / Easy 8 / Top 10 controls appear above the records. All seven supported sports stay separate, including per-sport Top N and edge units. The All sports default checks one common ET day or rolling 7-day window. Empty, unavailable and partial coverage remain distinct.

Every sport section starts with compact Day / Week / Tracked season cards. They use one authentic pregame forecast per game across registered formula activations, preserving original saved sides, prices, grades and ranks. Reconstructed/retrospective rows are excluded; missing active-formula picks have no favorable fallback. Week is Monday–Sunday ET, and saved seasonal coverage remains explicitly partial. Search does not change records. Read `TRACKED-HISTORY.md` for the exact policy; `/tracked-results` follows the same period/card/season selection. NFL uses the same format as college football.


Actual in-progress scores appear in a prominent score panel. Recent observations say Live score; offline/failed refreshes say Last reported score, old observations say Stale score, and missing scores stay unavailable. Supplied period/clock/status details are shown; unsupported details are not invented. Final outcomes still come from saved settlement, never live score inference.

Results are visible on every card, with final score and Win / Loss / Push / Pending / Ungraded where applicable. The Results tab shows every supported sport, including those without games on the selected day. The retained standalone `/paper-ledger` route and homepage paper ledger remain available; `/weekly-results`, `/learning-log`, `/college-experiment`, and `/baseball-research` are unchanged.

The editorial hero appears after the board. It selects one eligible authoritative league leader per sport on the CT day, initially showing the earliest-starting leader. Points, runs and goals are never compared across sports. The story, model explanation, exact 50/50 pledge, Coming soon donation dialog remain; the operating-cost panel was removed.

`lib/board-client.ts` retains the original browser payload and server fallback behavior, 60-second cache and 15-second timeout. Home and record refresh behavior, race protection, API routes, feed sources, ratings, ranking, grading, bankroll and database schema are preserved. Saved forecasts retain their original model and market prices. `lib/board-presentation.mjs` keeps market and fair lines in the same selected-team perspective, including null, archived-price and synthetic-contract safeguards.

The existing Site remains **public** at https://big-vin-grind-to-win.sunlightisfree.chatgpt.site . Publishing preserves its project identity, audience and database bindings.

## Files introduced by the redesign

| File | Purpose |
| --- | --- |
| `app/home.module.css` | Responsive, scoped landing-page design |
| `components/project-sections.tsx` | Retained alternate method, story, pledge, ambassadors, and donation dialog |
| `components/project-sections.module.css` | Scoped styles for those sections |
| `lib/site-config.ts` | Pledge copy and source links |
| `lib/board-client.ts` | Unchanged browser transport, extracted for reuse |
| `lib/board-presentation.mjs` | CT display, daily hero selection, and same-team line presentation |
| `lib/board-presentation.test.mjs` | Focused CT, hero eligibility, and spread-perspective regressions |
| `app/paper-ledger/page.tsx` | Preserved management of recorded paper plays |
| `app/paper-ledger/page.module.css` | Responsive ledger presentation |

`app/page.tsx`, `app/layout.tsx`, `components/research-frame.tsx`, and this README were updated. The existing source tree, assets, data snapshots, research code, API routes, migration files, and lockfile are included in the complete source export.

## Verification

```sh
npx tsc --noEmit --incremental false
node --test lib/*.test.mjs scripts/daily-experiment.test.mjs
npm run build
```

The integrated redesign passed TypeScript, the production build, and all **23 test files**. Focused new checks cover Central midnight, both daylight-saving transitions, cross-league hero selection, game eligibility, unchanged ranks, null/zero spreads, home/away perspective, archived opening lines, and synthetic-contract exclusions. The original browser transport was retained without changing its request logic.

The current integrated site has been inspected in a browser at desktop and narrow phone widths. See `LOCAL-UI-HANDOFF.md`, `TRACKED-HISTORY.md`, and `CFB-FEED-FIX.md` for current verification and data-selection details.

## Shared source and editing

The shared source is [big-vin/site in lestercrafton/dumbai](https://github.com/lestercrafton/dumbai/tree/main/big-vin/site). See [AGENTS.md](AGENTS.md) for the editing and publishing workflow. The live URL stays unchanged. Runtime hosting and the existing GitHub Actions collector operate without a local computer. GitHub CI checks source changes; production publication is a separate supported Sites step with fresh short-lived credentials. Do not claim push-to-deploy until that separate step succeeds.
