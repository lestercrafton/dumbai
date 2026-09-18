# Big Vin unattended sports experiment

[Live site](https://big-vin-grind-to-win.sunlightisfree.chatgpt.site/) · [Learning log](https://big-vin-grind-to-win.sunlightisfree.chatgpt.site/learning-log) · [Cloud runs](https://github.com/lestercrafton/dumbai/actions/workflows/big-vin-daily.yml)

The scheduled runner lives in **Lester's personal `lestercrafton/dumbai` repository**. GitHub-hosted Ubuntu machines fetch the data and publish to the existing cloud-hosted Big Vin site. Neither the Mac nor Codex needs to be open. No company Azure services are used. The domain is independent of the scheduler; this workflow does not change millymate.com DNS.

## Schedule and behavior

- Every day at **7:17 a.m. America/Chicago**, collect NFL, college football, NBA, WNBA, men's college basketball, NHL, and MLB schedules/results; capture eligible upcoming forecasts; grade saved predictions; refresh baseball research data; and publish a dated daily learning entry.
- **8:17 a.m.** retries incomplete work. A completed date is a no-op. Runs share one concurrency group.
- **Tuesday at 9:17 a.m.**, publish descriptive weekly results and the existing paired shadow-model comparison. This deterministic review does not independently invent or promote new formulas.
- The Actions page also has **Run workflow** for a manual daily or weekly run. Code changes trigger the tested daily runner.

These are scheduled times, not a real-time SLA. GitHub can delay scheduled runs and disables public-repository schedules after 60 days without repository activity. A disabled workflow can be re-enabled from Actions. [GitHub scheduling documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

## Authentication without stored secrets

GitHub's short-lived OpenID Connect identity tokens authenticate this exact workflow in `lestercrafton/dumbai` on `main`. The Site verifies GitHub's RSA signature, issuer, audience, numeric repository and owner IDs, branch, workflow path, subject, event and expiration. Other repositories, fork/PR jobs and other workflows are rejected. The runner renews tokens before expiration.

No GitHub personal access token or permanent Site secret is stored in this repository. The job requests `id-token: write` to obtain its own identity, with read-only repository and Actions access. Local runs can still use the original private collector config. The `refresh` manual task performs a fresh all-sports collection before the daily journal check.

## Durable results and recoverable local data

The existing Site database retains canonical forecasts, first observed prices, outcomes, bankroll records, and append-only learning entries. Moving this runner does not replace that database.

Small Actions artifacts preserve frozen daily journal bodies, retry checkpoints, collection reports and a compact college-football schedule registry. They are saved even on partial failures, retained for 14 days, and restored across runs. Each checkpoint carries the last 35 days of completed snapshots plus any unresolved work; the canonical full history remains in the Site database. No credentials or private config are included. Artifacts in this public repository contain only public sporting data and the already-public paper experiment.

Baseball's larger source/normalized data use the Actions cache. Cache loss triggers a historical rebuild from the free MLB Stats API, with season/count/date checks against migration floors and published coverage. A cold seven-day download must never replace the cumulative research history. Cold rebuilds include every season from 2024 through the current year. Baseball research retries independently, so a source failure cannot prevent the other sports from collecting and journaling results. CFB bootstrap observations preserve verified schedule group membership so omitted games can be recovered individually.

Expired or missing checkpoints can recover the exact daily entry from the public learning log before safely repeating collection. Original forecasts, sides, odds, capture times and model versions are never overwritten. Machine-specific locks/PIDs are not carried between runners.

## Experiment rules

All data sources are free. No wagers are placed. Every sport/formula/cohort is a separate hypothetical $500 bankroll. Each priced full-card pick risks 2% of its Eastern day's opening bankroll, compounded only across settled days, using original saved odds. Missing prices stay missing; retrospective fits do not become pregame predictions. Automatic results collection does not authorize changing model priors after seeing outcomes.

## Local verification

Requires Node 22+, Python 3.10+, and curl; the runner has no npm packages to install.

```sh
cd big-vin
npm test
node scripts/cloud-state.mjs prepare
node scripts/daily-experiment.mjs
node scripts/weekly-review.mjs --apply
```

The source was extracted from the deployed Big Vin project at commit `03bcf588b4f5230e7c5b5bb054ed6267d7e5c0ae`. Cloud-specific recovery and coverage checks live alongside the original collector logic.

## Migration verification

The first GitHub-hosted run [completed successfully on September 18, 2026](https://github.com/lestercrafton/dumbai/actions/runs/35398579094): all seven sports collected with zero unresolved failures, 7,243 baseball games rebuilt from free sources, and checkpoint/cache uploads succeeded. It reused the already-published daily journal rather than duplicating it.
