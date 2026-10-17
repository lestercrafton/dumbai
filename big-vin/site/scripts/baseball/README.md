# Big Vin public MLB data collector

This collector uses public MLB StatsAPI and Baseball Savant endpoints without keys, subscriptions or paid calls. It writes research data outside the website and never changes frozen Big Vin forecasts or their prices.

## Run

Requires Node (optional launcher), Python 3.10+ and `curl`. No Python packages are required.

```sh
node collect.mjs --mode history --seasons 2024,2025,2026 --as-of 2026-09-17 --skip-current
python3 pitchers.py --seasons 2024,2025,2026
node collect.mjs --mode daily --lookback-days 7 --future-days 7 --pitchers --statcast-days 1
```

`--data-dir /absolute/path` selects persistent storage. The default is `collector/data`. `--as-of YYYY-MM-DD` fixes the run's reporting date; completed history ends the preceding day. `--skip-rosters` omits roster/player-season snapshots. `--skip-current` omits all current snapshots. Statcast is opt-in and bounded to 0–7 completed days. Its initial implementation collects regular-season pitches; postseason team/pitcher data are collected separately through StatsAPI.

The daily command updates only the last seven days of team games and pitcher appearances, merges by stable MLB `gamePk`, and retains all earlier history. Current probable pitchers cover today plus seven days. Historical pitcher enrichment is optional because it adds requests. The default delay is 0.5 seconds between request starts; `--interval` changes it. Transient errors get four bounded attempts with backoff. No public numerical request quota or SLA is assumed.

`collect.mjs` forwards arguments to Python; set `BIG_VIN_PYTHON` to choose another interpreter. It preserves the Python exit code. A completed validated run exits 0; incomplete data or failed integrity checks exit 2, transport errors fail visibly.

## What is collected

- **Completed games:** all regular-season and postseason game types R/F/D/L/W for requested seasons; game ID, teams, official date, start time, score, hits/errors, venue, day/night, doubleheader number, weather, attendance and duration when supplied.
- **Team game logs:** batting, pitching and fielding totals. Examples include hits, walks, strikeouts, home runs, plate appearances, total bases, stolen bases, pitch count, outs, earned runs, assists and putouts. Source omissions remain absent/null.
- **Pitcher appearances:** actual pitcher IDs, roles, outs, pitches and selected outcomes. Team full-season roster hydration supplies most regular-season logs efficiently. A bounded maximum of 200 official box scores fills postseason or incomplete games. Traded players are deduplicated by game/team/player. A complete staff-outs reconciliation is required before exporting bullpen totals.
- **Current snapshots:** timestamped probable pitchers, active rosters (IDs, position, batting/throwing hand) and player season batting/pitching/fielding totals. A probable pitcher is explicitly not a confirmed starter.
- **Optional daily Statcast:** official pitch CSV plus conservative normalized pitch fields and team-game contact summaries. Raw data retain all source fields. Normalized data omit `*_days_until_next_game` and the coordinate/strike-zone fields whose definitions changed in 2026.

This is a substantial reusable collection, not every baseball statistic. Pitch-level Statcast history, tracking vectors, medical information, news, true pregame weather forecasts, historical roster announcements, sportsbook prices and play-by-play are not silently inferred. The code can be extended independently of the score model.

## Files and schema

- `data/games.jsonl` and `games.csv`: one row per completed `gamePk`, sorted by UTC start.
- `data/pitcher-appearances.jsonl`: one row per game/team/pitcher, including source provenance.
- `data/snapshots/<fetchedAt>/`: probable pitchers, rosters, current player season stats and counts.
- `data/statcast/YYYY-MM-DD/`: normalized pitches, team-game contact summaries and coverage manifest.
- `data/cache/raw/<SHA256>.json|csv`: immutable response bytes, addressed by content hash.
- `data/cache/index.json`: URL to newest cached response metadata. Older response blobs remain retained.
- `data/manifests/<runStart>.json`: append-only run provenance, cache hits, hashes, coverage and output hashes.
- `data/latest-manifest.json`: latest completed run, with small `summary` suitable for a freshness endpoint.
- `data/validation.json`, `pitcher-validation.json`: coverage, reconciliation and source disagreement reports.

Stable join keys are `gamePk`, `homeId`/`awayId`, and pitcher `playerId`; MLB IDs differ from ESPN IDs. Core game fields include `date`/`officialDate`, `startTime`, `homeRuns`, `awayRuns`, `homeMargin`, `venueId`, and `hasResumeOrRescheduleFlag`. Stat names are prefixed, e.g. `home_batting_baseOnBalls`, `away_pitching_numberOfPitches`, `home_fielding_putOuts`. Pitcher enrichment adds `home_actual_starter_id`, `home_starter_outs`, `home_bullpen_outs`, `home_bullpen_pitches` and corresponding away fields.

Baseball innings such as `5.2` remain strings. Outs are integer counts; never treat `5.2` as 5.2 decimal innings. The team-game API reports some fielding-error totals differently from the schedule linescore. Both are retained (`home_fielding_errors` versus `home_linescore_errors`/`homeErrors`), with explicit warnings. They are not silently reconciled; initial research excludes this disputed feature. Scores, hitting totals and pitching runs allowed are independently cross-checked.

## Timing and leakage

Historical downloads are labeled `retrospectively-fetched-final`; a fetch today is not evidence those exact values were available before a historical prediction. Final-response probable pitchers and actual starters have `known_pregame=false`. Actual starter and bullpen data may inform **later games** after completion, never identify the target starter without a separately timestamped pregame snapshot.

Retain and inspect suspension/resumption/rescheduling fields. Schedule responses can repeat a suspended game on multiple dates; normalization deduplicates by `gamePk`. The default research policy excludes ambiguous resumed games and uses a full-day embargo. Exact historical completion/publication timestamps are not claimed. Current aggregate season stats and roster snapshots are for forecasts after their capture, not earlier games in that season. Final weather, attendance and duration are outcomes/context, not historical pregame predictors.

Statcast expected-wOBA fields are aggregated only on terminal plate appearances with actual populated values. The output retains supported/missing denominators and does not replace missing values with zero. Do not average them across every pitch. Raw expected metrics downloaded now can have revisions; any historical test is retrospective. In 2026, `plate_x/plate_z` and strike-zone bounds changed definitions; these columns are excluded from normalized research data unless a later version explicitly reconciles them.

## Primary sources and observed API behavior

- MLB full-season schedule: `https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=2025-01-01&endDate=2025-12-31&gameTypes=R,F,D,L,W&hydrate=team,probablePitcher,linescore,decisions,gameInfo,venue,weather`
- Bulk team logs: `https://statsapi.mlb.com/api/v1/teams/stats?stats=gameLog&group=hitting,pitching,fielding&season=2025&sportIds=1&gameType=R&limit=10000`
- Pitcher logs via roster: `https://statsapi.mlb.com/api/v1/teams/147/roster?rosterType=fullSeason&season=2025&hydrate=person(stats(type=gameLog,group=pitching,season=2025,gameType=R))`
- Final official box score: `https://statsapi.mlb.com/api/v1/game/775296/boxscore`
- [Savant CSV field documentation](https://baseballsavant.mlb.com/csv-docs), [official search](https://baseballsavant.mlb.com/statcast_search), [MLB Statcast glossary](https://www.mlb.com/glossary/statcast).
- Successful bounded CSV example: `https://baseballsavant.mlb.com/statcast_search/csv?all=true&type=details&game_date_gt=2026-09-16&game_date_lt=2026-09-16&hfGT=R%7C`

Observed pitfalls are checked rather than assumed: bulk team logs default to only 50 rows, so the collector sets and verifies pagination. Comma-separated `gameType` on team stats silently returned regular-season data in probes; the collector requests each postseason type separately. MLB date ranges use `YYYY-MM-DD`. Bulk `/stats?stats=gameLog&group=pitching` returned an empty array; roster hydration provided the actual player logs. The initial `probes/` directory preserves this discovery evidence; production provenance lives in the content-addressed cache.
