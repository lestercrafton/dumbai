# Learning loop data contract (site side)

Status: **proposed by the site, October 19, 2026.** The runner-side loop (versions manifest, Playbook v1 tag, shadow challenger picks, Tuesday scoreboard, promotion records) had no commits on `main` when this was written, so this file defines what the site accepts. If the runner settles on a different shape, change `lib/playbook.mjs` validators and this file together.

Validation lives in `lib/playbook.mjs`; storage in `lib/playbook-store.ts`; migration `drizzle/0005_playbook_learning_loop.sql` (new tables only).

## Writing

`POST /api/playbook` with the same authorization as `/api/collector` (the `big-vin-daily.yml` GitHub OIDC token, audience `https://big-vin-grind-to-win.sunlightisfree.chatgpt.site`). Body is one JSON document, at most 400 KB, with a `kind`:

| kind | body | stored | rule |
|---|---|---|---|
| `versions` | `{kind, manifest}` | `playbook_manifests` | append-only snapshot; same `manifest.id` again is a no-op; newest `generatedAt` is current |
| `challenger-picks` | `{kind, picks:[…≤400]}` | `challenger_picks` | insert-only, rejected unless saved before kickoff (server clock); same `id` again is a no-op |
| `challenger-results` | `{kind, results:[…≤400]}` | `challenger_results` | one row per pick, separate from the pick; a later `gradedAt` replaces an earlier grade (score corrections) |
| `scoreboard` | `{kind, scoreboard}` | `scoreboards` | insert-only; corrections are a new id with `supersedes` |
| `promotion` | `{kind, promotion}` | `promotions` | insert-only |

Responses: `{kind, inserted|saved, …}`; validation errors are HTTP 400 with `{error}`. Nothing here touches `forecasts`, `first_market_observations`, `pick_revision_states` or any price row.

Ids: `^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$`. Times: ISO 8601 with zone. Sports: `nfl cfb nba wnba cbb nhl mlb`. Week keys: the same `weekKey` the site already uses per sport (`2026-W07` for NFL, the Monday date `2026-10-19` for date-keyed sports).

### Versions manifest

```json
{"schema":"big-vin-versions/1","id":"versions-2026-10-19T12","generatedAt":"2026-10-19T17:00:00Z",
 "versions":[
  {"id":"v1","label":"Playbook v1","role":"live","createdAt":"2026-10-19T05:00:00Z","frozenAt":"2026-10-19T05:00:00Z","tag":"playbook-v1-2026-10-19",
   "modelVersions":["ridge-v1","nfl-season-tuned-2026-10-16"],"summary":"Everything through October 18, frozen."},
  {"id":"v2-injuries","label":"Injury and lineup news","role":"challenger","sports":["nfl","cfb"],"parent":"v1","createdAt":"2026-10-19T17:00:00Z","weekKey":"2026-W07","idea":"injuries","summary":"Adjusts the line when a starting QB is out."}]}
```

`role`: `live | challenger | retired | frozen`. Optional: `sports`, `modelVersions` (site model ids this version covers), `parent`, `frozenAt`, `weekKey`, `idea`, `summary`, `tag`. Labels come from here; which version is live comes from promotions.

### Challenger pick

```json
{"id":"v2-injuries:nfl:401772","versionId":"v2-injuries","sport":"nfl","gameId":"401772","weekKey":"2026-W07",
 "startTime":"2026-10-23T00:15:00Z","capturedAt":"2026-10-20T14:00:00Z","home":"Green Bay Packers","away":"Chicago Bears",
 "side":"home","homeSpread":-3.5,"odds":-110,"predictedMargin":5.8,"stakeUnits":1,"provider":"ESPN BET","note":"QB questionable"}
```

`side` is `home`, `away` or `null` (no play). `homeSpread` is the market line from the home side at capture and is required with a side. `odds` are American (or null: graded, not priced). `stakeUnits` 0–10, default 1. `gameId` is the ESPN event id the site uses.

### Challenger result

```json
{"pickId":"v2-injuries:nfl:401772","status":"completed","homeScore":24,"awayScore":20,"gradedAt":"2026-10-23T03:40:00Z",
 "closingHomeSpread":-4.5,"closingOdds":-115,"clv":1.0,"sourceUrl":"https://…"}
```

`status`: `completed | void`. CLV is in points toward the pick (positive = the market moved our way). Send `clv` or `closingHomeSpread`; the site computes CLV from the closing spread when `clv` is absent.

### Tuesday scoreboard

```json
{"schema":"big-vin-scoreboard/1","id":"scoreboard-2026-10-27","weekKey":"2026-W07","publishedFor":"2026-10-27","liveVersionId":"v1",
 "summary":"…","won":["…"],"lost":["…"],"kept":["v2-injuries"],"dropped":["v4-matchups"],"lessonEntryId":"nfl-2026-w07-playbook",
 "entries":[{"versionId":"v1","role":"live","decision":"kept","record":{"wins":8,"losses":6,"pushes":0,"roi":0.031,"clv":0.4,"bankroll":512.4}},
            {"versionId":"v2-injuries","role":"challenger","decision":"continuing","record":{…},"note":"…"}],
 "supersedes":null}
```

`publishedFor` must be a Tuesday. `decision`: `kept | dropped | promoted | continuing`. `lessonEntryId` is the id of the learning-log entry posted through `POST /api/learning` that week; the scoreboard page shows it inline.

### Promotion

```json
{"id":"promotion-nfl-2026-11-10","sport":"nfl","fromVersionId":"v1","toVersionId":"v2-injuries",
 "decidedAt":"2026-11-10T15:00:00Z","effectiveAt":"2026-11-10T16:00:00Z","scoreboardId":"scoreboard-2026-11-10",
 "reason":"Beat v1 on 64 games it had never seen.","evidence":{"unseenGames":64,"window":"2026-W07–2026-W10","metrics":{}}}
```

`evidence.unseenGames` ≥ 1 is required. `effectiveAt` cannot be before `decidedAt`.

## Reading (public)

`GET /api/playbook?view=versions` → `{playbook, manifest, promotions}`
`GET /api/playbook?view=challengers` → `{playbook, manifest, promotions, weeks:[{weekKey, sports, live:[{sport, versionId, week, running}], challengers:[{versionId, label, idea, summary, role, sports, week, running}]}]}`
`GET /api/playbook?view=scoreboards` → `{playbook, manifest, promotions, scoreboards}`

Each record: `{wins, losses, pushes, pending, voids, noPlays, pricedPicks, units, roi, clv, clvPicks, bankroll}`. ROI is units won per unit staked at saved odds. Bankroll is a paper $500 with a flat $10 per priced pick (`PAPER_BANKROLL`). Running records start at the freeze. The live row grades saved live forecasts (the site's active model per sport) with the same rules; CLV stays blank there until live closing lines are stored.

## Version on every pick

`playbookVersionFor(record)`: an explicit `playbookVersion` on the record wins; anything saved before **2026-10-19 00:00 America/Chicago** (`2026-10-19T05:00:00Z`) is `v1`; later picks take the live version from the most recent promotion for that sport at the capture time, otherwise `v1`. The badge shows on board cards, the featured pick, weekly results and pick history.
