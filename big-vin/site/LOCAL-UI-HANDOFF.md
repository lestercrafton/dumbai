# Big Vin UI update — October 17, 2026

Existing Site: `appgprj_6aa0ff29e7948191857b18c0d737f893`.
Public URL: https://big-vin-grind-to-win.sunlightisfree.chatgpt.site
Remote branch: `main`. Refreshed base: `4c2e3363e201bdf4529d94fa42473e1e0e1dd357`.

The saved Library redesign was materialized on this Mac and its 1,091,665-byte ZIP verified against SHA256 `6c5bb3e9ae20cbc4828423c4aae12ed1a5572ed59912d20b29418a91de52f0df`. Original screenshot pixels were inspected.

Integration retains the newer standalone paper ledger, research links, shared browser transport and same-team line-display safeguards. The API, stored data, model calculations, grading and server ranks remain authoritative. Time/team/conference searches filter display only. CT clock ranges apply to each game's local start time; date queries and record days remain ET. Original ranks remain visible after sorting/filtering. Day/week/season records do not use the visible search subset.

No Milly files or unrelated checkout changes are included. Existing public audience is preserved.

A reproduced client issue was fixed: the results API maps a retired formula request to baseline, but the prior header treated the mismatched version as a fatal error. The display now skips mismatched responses and continues the existing version chain; it never attributes baseline data to another formula. Server/API behavior remains unchanged.

## Validation

- All 160 Node unit tests pass, including aliases/ambiguity, CT/DST/overnight filters, live/final freshness, record periods and version-fallback guards.
- TypeScript passes; the supported Sites build passes; whitespace check passes. Build retains Vinext's existing route-classification warning.
- Local browser QA: 1440px desktop; 390px and 320px mobile, no horizontal overflow; visible all-sport records; actual live/final score panels; time presets/sorting; team typo query and MSU ambiguity. MSU matched Mississippi State, Michigan State and Morehead State on October 17.
- Local database uses only local migrations. Production API/model/data files are unchanged.

## Season correction

The existing collector preserves forecast.season. Existing ESPN scoreboard responses also include league season year, display label and published start/end instants, even on an empty game day. These fields are now retained as additive seasonContext metadata; no feed, collection behavior or grades change. Current identity is accepted only inside the provider's explicit season interval. Missing/conflicting/expired metadata displays unavailable rather than guessing.

The results API accepts optional season=<provider ID> and returns additive seasonRecord summaries from the existing sport/cohort/formula scoped records. Ranking membership is established before season filtering. Push treatment, CFB synthetic exclusions and original bankroll contributions are preserved. Formula fallback considers seasonal counts rather than resurrecting a previous season's totals. The card is now Season, with the actual league label (including 2026-27 where supplied), saved coverage dates, decided sample counts and unknown-season exclusions. It explicitly does not claim full schedule coverage.

Season correction validation: all 171 unit tests pass; TypeScript passes; supported Sites build passes with the existing classification warning; whitespace check passes. Local API integration confirms the existing retrospective NFL overall remains 855/855, season 2025 contains only its 285 games, and season 2026 contains none of those prior-season games. Invalid season queries return 400. Browser QA confirms exact current metadata for all seven sports (2026 football/baseball/WNBA, 2026–27 NBA/CBB/NHL); 1440px desktop and 320px mobile have no horizontal overflow.

## Live progress and weekend discovery

Based on published version 32 / d0e21526810edf0d62ceb3d5cd002ed77bd7ee8b, this update preserves the existing visual format and public audience.

ESPN's existing status metadata now supplies the reported period/clock, halftime/intermission/overtime, and baseball inning detail/outs when available. The browser never advances that clock. CFB overtime and NHL shootouts are shown as untimed; finals never reuse a live clock. Missing clocks are explicit. The score panel, displayed side and live card are green only when a fresh observed score provisionally covers the exact displayed/saved ATS line. Losing, push/tie, missing pick/line/scores, stale price and stale/offline observations are grey with text labels. No moneyline recommendation is inferred from the illustrative spread conversion or a synthetic paper winner. Final grading and records remain separate.

Score freshness uses the actual network observation timestamp, retained through browser cache hits. Market timestamps retain their existing semantics. Scores older than three minutes, unavailable timestamps, offline snapshots or refresh errors do not receive green. Visible-page age is reevaluated every 15 seconds and on focus/visibility return. Existing board refresh remains approximately every minute, browser raw cache remains 60 seconds, and server fallback cache remains 300 seconds. These timestamps describe a feed check; ESPN can itself lag, and no real-time guarantee is made.

Prominent Today, Tomorrow and This weekend shortcuts precede the time/team controls. This weekend selects the current Friday–Sunday on Friday/Saturday/Sunday and the upcoming Friday–Sunday on other weekdays, using ET sports date keys and an explicit dated range. It selects all sports/full card/all start times and retains the team query. CT start-time display is unchanged. Three-day transport reads each date independently across all sports, preserves successful/saved games if another date fails, and discloses partial coverage. Existing one-day/seven-day behavior remains intact. CFB compact feed caps remain disclosed. Search/time filters retain original ranks. Weekend records show saved full-card Day/Week/Season periods, explicitly separate from the three-day game filter.

Validation includes actual current provider field shapes, Node regression tests, TypeScript, the supported Sites build, and desktop/mobile browser checks. Local-only labelled fixtures verified a leading favorite not covering, a trailing underdog covering, a push and a stale score. Those fixtures were removed before the final build/package. Actual weekend search verified Saturday MSU matches and Sunday Chargers–Chiefs retaining its original #2 rank in the local board.

Final release checks: 209/209 Node tests pass, TypeScript and whitespace checks pass. Browser inspection at 1440px desktop, 390px and 320px mobile found no horizontal overflow. The revised actual Oct 16–18 weekend feeds returned 98 games across six sports (19 Friday, 64 Saturday, 15 Sunday), with CFB partial coverage disclosed and completed NBA scores visible. Tomorrow and This weekend controls were exercised, as were Saturday team search and Sunday original-rank retention. Counts are observations at verification time, not a claim of complete live coverage.

## Authentic tracked history and compact records — October 17 follow-up

Based on published version 33 / f8bc70ff6499344ff5c8d7a1028c7108463f2d5f. The latest supplied screenshot was materialized from Library and its actual pixels inspected. The old record query selected one formula before computing its periods, so the newest formula's four CFB finals hid genuine September history. The separate default board also skipped the September formula for earlier dates and could show a different historical pick. Both paths now share a deterministic selection policy over the genuine saved ledger. See TRACKED-HISTORY.md for the complete policy and limits.

The audit reconciled all 2,085 production live rows and the available local genuine pregame archives. Those archives were already present in production, so no historical records were imported or fabricated. Outcomes never choose a formula or duplicate winner. Reconstructed, retrospective, late and unverified picks remain excluded. Original saved sides, prices and grades are preserved, with per-formula bankroll accounting kept separate. All stored forecast pages are loaded without the former fixed row cap. No production database was manually edited.

The verified snapshot has CFB 208–160–3 ATS from 497 selected saved games (56.5%, 371 graded, 109 pending, 17 without lines). The October 12–18 calendar week is 6–4–1 across 118 saved games. NFL is 37–39–2 across 92 saved games (48.7%). These are partial tracked records: genuine CFB coverage begins September 17 and NFL coverage September 13. Full-season records remain explicitly unavailable. Nine CFB games lack an eligible genuine active-formula pick; seven have differing saved schedule snapshots. The policy discloses these exclusions and uses the earliest genuine saved schedule deterministically. The ledger has no historical primary-publication marker, so activation-based formula selection is a documented inference, not proof of the exact historical visitor card.

League and Full card / Top 10 controls now precede time discovery with a clearer framed hierarchy and accessible touch targets. Day, Week and Tracked season share compact three-column cards across NFL and college football. Detailed coverage and model-weight dates are in an expandable method section; weight-update dates are not presented as record-start dates. The new /tracked-results page follows the same calendar week, season and saved-card selection as its referring record. Board rank and saved-card rank are separately labelled. Live clock, ATS status, weekend, search and time-filter behavior remain intact.

Independent Astra review found no release blockers in these changes. All 240 runtime tests pass; TypeScript passes without incremental cache. Audit checks cover all seven sports, input-order and outcome invariance, preservation of saved picks and prices, and 21 sport/window board combinations. Local API integration confirms history/detail agreement and restores Kansas's October 10 saved away pick/loss instead of regenerating it. Desktop 1440px and phones 390px/320px were visually inspected with no horizontal overflow. Full card, Top 10, Top 3, historical week, NFL/CFB selection, weekend, Chiefs/MSU search and CT time presets were exercised; filtering retains original ranks. Local QA used an isolated copy of authentic production rows, with the original local database backed up for restoration. The separate baseball research parity test remains unavailable because its pre-existing canonical-inputs.json fixture is missing.

## Cost panel removal and shared agent source

The user requested removal of the unaudited operating-cost panel. Removed its live and retained alternate component, zero-cost configuration, and unverified free-data wording. The 50/50 pledge remains, with a balanced desktop grid and single-column phone layout. The narrowest phone uses a smaller unbroken 50/50 heading. Updated auxiliary source descriptions and the outdated baseball note: the existing collector runs on GitHub Actions, not on the owner's Mac. Private billing evidence does not belong in this public source.

Shared source is `big-vin/site/` in `lestercrafton/dumbai`, preserving the existing collector package and Milly work. `AGENTS.md` gives editing, verification and exact existing Sites publication instructions. `npm run check` executes 242 tests and TypeScript. The site CI has read-only repository permission and performs install/check/build; it has no collector OIDC or production write access. Source checks and live publication remain separate. Site-only changes do not trigger full sports/research collection. Current hosting, D1 data, audience and public link remain in place, so existing shared URLs continue receiving published updates.

The style pass inspected 1440px, 390px and 320px layouts, checked overflow, cost-panel absence, the remaining header donation dialog, and clear source/cost language. No prediction, ranking, saved-grade, live-clock, ATS-color or data-storage semantics change in this follow-up.
