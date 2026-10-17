# Saved pick history

The default board and `/api/results?history=1` use the same deterministic saved-pick selection. Formula-specific results and research remain available through the existing API without `history=1`; their bankroll replay and grading semantics are unchanged. Default formula responses also include an additive `trackedHistory` object.

## Selection policy

`saved-active-model-history-v1` admits only live `collector` and `local-pregame-archive` records with a valid saved forecast captured before kickoff. Reconstructed, recovered, retrospective, late and unverified records are excluded. A priced forecast also needs a pregame market timestamp; an attached first-market observation must have been recorded before kickoff. Missing prices remain unlined rather than being filled from later data.

The ledger has no historical published-primary marker. Formula ownership is therefore an explicit inference from the September 14 and October 16 activation registries. For each sport/game, use the earliest genuine saved capture's schedule (forecast ID breaks timestamp ties), then select the latest registered formula whose activation timestamp and reporting-week boundary both precede that game. NFL Week 6 remains on September settings even after October 16 because the new settings start in Week 7. If the selected formula has no genuine saved pick, leave the game unavailable; do not substitute a winning benchmark, a reconstructed line or a later formula. Within the selected formula, earliest capture then forecast ID breaks duplicate ties. Final scores, outcome, settlement status and profit never choose a pick.

The policy reports excluded-row counts by reason, games missing the eligible formula, and conflicting saved schedule metadata. It preserves original forecasts, sides, prices, result objects and original `rank` fields. `cardRank` is calculated from each formula's full saved live ranking window before exclusions, deduplication and season filters. Rank gaps stay gaps. These saved-input ranks are not proof of a historical published card, and multiple formula/window fragments can contribute to a calendar period. No combined bankroll or simulated profit is created for history.

## API scopes

- Top-level history `overall`, `days`, `weeks`, `spreadOverall`, `spreadDays`, `spreadWeeks` and `rankedCards` cover all selected saved history for the sport.
- `seasonRecord` uses only the explicit provider season supplied by `season=` and includes the same summaries, coverage and ranked-card summaries. Missing season identities are counted, not guessed from calendar dates.
- `week=` selects an exact saved league reporting week for `records`, `summary` and `spreadRecord`. An unavailable week stays empty.
- `historyDate=YYYY-MM-DD` instead selects its Monday–Sunday calendar week using Eastern settlement dates, including moved games' saved `playedAt`. It returns `selectedPeriod: {start,end}` and can span NFL reporting weeks. All-history summaries remain unchanged. Invalid calendar dates return HTTP 400.
- `records` contains the selected detail period. A season-specific detail consumer must additionally filter these rows by the explicit provider season and use `seasonRecord` for totals.
- Every coverage object has `complete:false`. The available CFB archive starts September 17, after the season began. Full-season results are unavailable.

The default game board uses the same selected saved picks, preserving saved sides and grades. Recovered or reconstructed games can supply final-score coverage but cannot supply a displayed historical forecast. An uncaptured game that has started cannot receive a regenerated forecast. The board's current-window sorting remains unchanged; it exposes `historyCardRank` separately from its current-window `rank` and original capture `originalRank`. Any saved bankroll contribution comes from that pick's original formula replay, never a pooled history replay. Explicit formula/collector requests retain their existing path.

Saved forecasts are loaded with stable ID pagination, removing the former silent 12,000-row truncation.

## Reproducible verification

Run the focused tests:

```sh
node --test lib/tracked-history.test.mjs lib/saved-board-history.test.mjs lib/forecast-pages.test.mjs lib/season-record.test.mjs lib/ranked-card-summary.test.mjs lib/record-periods.test.mjs
```

Run the read-only audit on a complete all-version production export:

```sh
node scripts/audit-tracked-history.mjs ../season-audit/production-live-all-versions.json
```

The audit verifies outcome and input-order invariance, unique game selection, saved pick/grade preservation, daily/weekly/card reconciliation and board/history selection agreement. It prints the source SHA-256 and policy evidence. The October 17, 2026 export had 2,085 live rows. Its selected CFB history was 208–160–3 ATS across 371 graded picks; 80 reconstructed rows were excluded. These are snapshot observations, not frozen production totals.
