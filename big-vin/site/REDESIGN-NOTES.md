# Integrated Big Vin update — October 17, 2026

See `LOCAL-UI-HANDOFF.md` and `README.md` for the completed Mac integration, time/team search, live scores, period records, retained newer remote work and validation. The earlier source-only handoff notes below describe the input archive, not the current publication state.

# Big Vin presentation redesign

This is the updated source for the existing Big Vin Site. This handoff does not publish or change its audience. No API routes, database schemas, stored records, model parameters, ranking calculations, or grading calculations were edited.

## What changed

- A responsive charcoal-and-lime visual system with clear hierarchy, generous spacing, and reduced-motion support.
- The hero checks all seven supported sports: NFL, college football, NBA, WNBA, men’s college basketball, NHL and MLB. It highlights each league’s highest-ranked eligible upcoming game on the current America/Chicago date, retaining its API rank. Visitors can choose any available league leader; the earliest-starting leader is featured first. Points, runs and goals are never combined into a cross-sport ranking. Empty and incomplete-coverage states are explicit.
- The default board is All sports on the selected Eastern sports date. Each league with returned games has a prominent count/control and its own grouped, ranked cards and visible record. Completed, unranked and limited-data games count toward league visibility; failed checks are reported instead of being treated as an empty schedule. Switching leagues preserves the selected date/window. A 7-day All-sports view uses one common rolling window. Rank/time/conference filters, Top 3/Easy 8/Top 10, CSV exports and provenance remain; Top-N is per sport. Exports and read-only slate metadata identify each game’s sport and edge units.
- A prominent Results tab shows every supported league’s day/overall record, even when that sport has no games on the selected date. Active-league records also appear directly on the game board. Every card prominently shows Win, Learn, Push, Void, Pending or an explicit ungraded state, with final score when supplied by saved settlement. The selected-day result cards include completed and unfinished games. NFL/general percentages retain the same percentage-first hierarchy as college. Denominators, saved prices and bankroll accounting are unchanged.
- Line lab and the old standalone calculators are removed. Existing paper-play entry is available from each card’s “Behind the line” details in an accessible modal. The saved paper ledger, grading, and export remain.
- Plain-English model explanation, original spreadsheet story, exact 50/50 pledge, running-cost panel, ambassador appreciation, and Coming soon donation dialog. No payment collection, subscription, lock, or paywall is implemented.

## Editable configuration

Edit all monthly running costs in `lib/site-config.ts`, under `SITE_CONFIG.monthlyCosts.items`.

The entries currently show Data feeds: Free; Automation: Free; Hosting: TBD. These are explicitly labelled planning placeholders, not audited expenses. Hosting and the total remain unconfirmed. The exact pledge and ambassador line are kept in the same configuration file.

`components/big-vin-experience.tsx` contains the hero, cards, explanation, story, support panel, and donation dialog. `app/big-vin.css` contains the scoped presentation styles. The Top 10 navigation is a separate presentation area for future expansion, but currently has full access and no paid behavior.

## Important retained semantics

- Date queries and record-day selection still use America/New_York. Kickoff and observation timestamps on the redesigned homepage explicitly display America/Chicago / CT.
- The hero requests a seven-day existing-API window to include late CT games whose Eastern sports date falls on the following day, then filters strictly to CT today and future kickoff times.
- API rank, edge, and side remain authoritative. Cards use existing `spreadDecision()` and `moneylinePair()` helpers.
- Archived board rows already contain the frozen saved pregame market/projection. These are not replaced with current market quotes.
- Stale and limited-evidence rows stay visibly labelled. CFB limited-data rows remain in the full card and its bankroll, outside ranked filters.
- Synthetic winner-only contracts are not presented as sportsbook spreads or ATS wins.
- Refresh cadence, resource race protection, version-aware records, ranking cohort parameters, and paper-ledger endpoints remain in place.

## Run and build

Use Node 22.13 or newer.

1. `npm ci`
2. `npx wrangler d1 migrations apply DB --local --config wrangler.local.jsonc`
3. `npm run dev`

For an isolated writable npm cache, prefix npm commands with `npm_config_cache=/tmp/bigvin-npm-cache` on Linux/macOS. This is optional and changes no application configuration.

Checks:

- `node --test lib/*.test.mjs`
- `npx tsc --noEmit`
- `npm run build`
- `git diff --check`

`npm run start` runs the generated Worker build locally using Wrangler. Preserve `.openai/hosting.json` and the existing Site identity when publishing through the supported Sites workflow.

## Verification

Final checks on this source: `node --test lib/*.test.mjs` passed 120/120 tests; `npx tsc --noEmit` passed; `npm run build` passed; `git diff --check` passed. The local unit suite includes ten presentation tests for CT boundaries, the existing seven-sport universe, within-league hero ranks, cross-unit-safe leader selection, exclusion of ineligible games, visibility of completed/limited-data games, failure-vs-empty coverage, explicit outcome wording, saved-versus-live result handling and invalid-date safety. The build reports Vinext’s existing static route-classification warning; all build stages complete successfully. The browser used for attempted QA was the assistant’s cloud browser, never the user’s computer.

Browser screenshot/click QA could not be completed in this workspace: the development server failed at Cloudflare Vite’s network-interface inspection with `uv_interface_addresses` (errno 1). The approved escalation launcher then failed before server execution with a read-only-filesystem setup error. No application or security configuration was changed to work around the environment restriction. Responsive layout and modal accessibility are implemented, but real-browser behavior remains to be checked in a working preview.

Suggested browser checks: 320px and 390px mobile plus 1440px desktop; All sports/per-league/Top 10/date/conference switching; Results for a sport with no games today; loading, empty, failure and stale states; donate dialog close button, Escape, focus return and repeat opening; paper dialog dismissal; retained ledger and CSV export. Do not test real money or change production records during visual QA.

## October 17 correction

The user requested all sports with games that day and visible results. The frontend now derives its league list from the existing `SPORT_PATHS` API map. No new feeds or cross-sport model were added. The hero’s “Top edge by sport” wording deliberately avoids an unsupported overall-best claim. Within a sport, the existing API rank chooses the best eligible game; start time only determines which league leader is initially displayed.

Results and paper-ledger views remain separate. `?view=records` opens the new saved-forecast Results view; the existing `?view=results` paper-ledger entry still works. All API record requests retain a real supported sport, never `sport=all`.
