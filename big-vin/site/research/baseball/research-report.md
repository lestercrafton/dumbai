# MLB free-data model study — September 17, 2026

**Retain `mlb-weekly-tuned-2026-09-14`.** None of the 21 predeclared residual corrections beat the unchanged score-rating formula on 790 development games. The best new feature specification increased MAE from **3.48608 to 3.49303 runs**. No feature candidate is recommended for activation or a new shadow from this experiment.

## What was collected and tested

The sibling collector obtained 7,234 unique official completed games across 2024–2026. The model used 7,041 regular-season games dated March 20, 2024 through September 16, 2026 UTC after excluding 98 games with suspension/resumption/reschedule flags, 90 postseason games and 5 games beyond the registered UTC boundary. Of those eligible games, 435 before May 1, 2024 supplied warmup only, leaving 6,606 prequential feature/label rows. No additional target failed the 10-prior-game minimum, and every declared stat ratio was available for both 20- and 60-game windows. Missing-value handling was therefore unused in this sample.

The collector's 259 disagreements between team-fielding error totals and schedule linescores were retained in its audit. Fielding errors were excluded here. No starter, final weather, attendance, pitch-location, future-next-game or season-end aggregate information was used.

The active formula uses a 480-day score half-life, 730-day lookback, team penalty 12, home prior 0.4/home penalty 120,and no rest adjustment. Both it and original Ridge v1 were refitted on the same newly collected regular-season history. These are algorithm comparisons on a common dataset, **not reproductions of original frozen production forecasts**. The collected history starts in 2024; it cannot supply earlier rows that a full 730-day history would have contained at the earliest cutoffs. The active parameter settings were selected after 2026 outcomes in earlier work, so their historical performance is descriptive.

## Chronology and bounded candidates

The original protocol was registered at 2026-09-17T18:42:26.810015Z. A preserved pre-fit clarification specifies workload windows, conservative flagged-game exclusions and omitted fielding errors. For a target on UTC date D, score/stat inputs stop at D−2. There is no same-day doubleheader input. This conservative buffer sacrifices freshness to avoid ordinary overnight finalization ambiguity; flagged suspension/resumption/reschedule cases are excluded entirely.

Each baseline prediction is fitted using only its own eligible prior scores. Residual learners train on those prequential errors, rather than full-history fitted residuals. Each Monday block fit uses labeled games through C−2, within 730 days, with at least 500 labels. Medians, scaling and all coefficients come only from that prior training set. Learner coefficients can refit in later blocks under the frozen specification; candidate settings are never chosen using validation scores.

The bounded set contains the unchanged active baseline plus 21 residual ridge specifications. Ridge penalties are 10/100/1000. Three calibration-only variants use the active margin. Eighteen variants combine 20/60-game windows with runs, box-score or context feature families. They use run-scoring/prevention form; batting hits, walks, strikeouts and homers per plate appearance; pitching rates per out; lagged total staff outs/pitches; recent game counts; and a prior venue scoring-environment proxy with 100-game shrinkage toward league scoring. The venue proxy is not an official or causal park factor. Staff workload is not exact bullpen usage.

The selector minimizes development MAE, then RMSE, feature count, and stable ID. Development is August 1–September 30, 2025 (actual targets end September29 UTC): 790 games in 9 Monday blocks. The selected specification was locked before corrected later-period scoring. Every candidate uses the same targets; no price, score, team or betting-threshold filtering is optimized.

| Feature family | Best development specification | MAE | RMSE | Winner sign accuracy |
| --- | --- | ---: | ---: | ---: |
| unchanged | active-unadjusted | 3.48608 | 4.46505 | 57.22% |
| calibration | calibration-ridge1000 | 3.49488 | 4.47676 | 57.34% |
| runs | runs-last60-ridge1000 | 3.49303 | 4.47494 | 56.96% |
| boxscore | boxscore-last60-ridge1000 | 3.49536 | 4.47392 | 55.70% |
| context | context-last60-ridge1000 | 3.49942 | 4.47651 | 55.82% |

The best extension, 60-game run form with ridge 1000, was **0.00694 runs worse** in MAE. Its exploratory paired-week bootstrap 95% interval for extension-minus-active error is **[−0.00159,+0.01594]** (5,000 draws, seed 20260917). These 9 reused development blocks do not establish an improvement. The highest development winner-sign accuracy was 57.72% for a richer context model, but its MAE was 3.51096 versus 3.48608 active. A secondary winner-picking percentage did not override poorer line accuracy.

## Later-date retrospective comparison

The registered later period is April1–September 16, 2026 UTC: 2,182 games in 25 blocks. Much of 2026 was already examined by prior research; this is **retrospective temporal validation, not a fresh holdout**. No feature candidate passed the development selector, so the selected later strategy remains the unchanged active formula. Its zero difference from active is mechanical and must not be presented as a precise estimate of feature value.

| Same-history formula | MAE | RMSE | Winner sign accuracy |
| --- | ---: | ---: | ---: |
| Active September14 / selected unchanged strategy | 3.51480 | 4.58174 | 54.72% |
| Original Ridge v1 | 3.52539 | 4.58455 | 54.72% |

The Ridge-v1-minus-active MAE difference is +0.01058 runs, with exploratory weekly-bootstrap 95% interval [−0.00238,+0.02322]. The small difference is uncertain. There are no original historical offers for these targets, so the study reports no ATS, units, ROI or profitable betting claim. No calibrated probability model was fitted and no Brier/confidence claim is made.

## Verification and useful next step

Independent Node checks compared the Python score fits with the actual Big Vin runtime over dates in 2024,2025 and 2026; maximum prediction difference was 2.23e−15 runs. The corrected final replay's 5 parity fixtures also pass. Independent run-form reconstruction, train-only scaling and 9 residual normal-equation checks passed. Replacing current/future scores and box statistics with poisoned values leaves earlier features and predictions unchanged. Suspended/resumed ambiguity, source dates, all exclusions and source hashes are retained.

The result is a useful negative finding: this simple implementation of recent team totals, venue context and staff workload does not improve the chosen line-error objective on development. It does not prove that baseball statistics are useless or that another properly tested feature model cannot help.

After this study's input was frozen,the collector completed exact historical starter and bullpen splits for all7,234 games. Those fields are now available for a separately dated follow-up. They were not silently inserted into this result,and the tested workload proxy must not be relabeled as bullpen usage.

Next, preserve actual pregame probable-starter snapshots and prior pitcher appearances, then specify a separate starter and genuine bullpen comparison. A pitcher named in a final historical response is not evidence that the same pitcher was announced before first pitch. The collector's additional pitcher/Statcast work can support that later study; those fields were not silently added after examining these results. Production settings and historical forecast records remain unchanged.

## Reproduce

Use the saved `canonical-inputs.json` to reproduce exactly; rerunning the collector or `prepare_inputs.py` may select revised source data.

```sh
env OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 python3 '/Users/lestercrafton/Documents/Codex/2026-09-09/go/work/mlb-data-research-2026-09-17/model/feature_research.py'
node '/Users/lestercrafton/Documents/Codex/2026-09-09/go/work/mlb-data-research-2026-09-17/model/baseline-parity.test.mjs'
env OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 python3 '/Users/lestercrafton/Documents/Codex/2026-09-09/go/work/mlb-data-research-2026-09-17/model/build_report.py'
```

`report.json` is the compact UI-facing result. `research-results.json` retains the complete protocol and grid; `development-grid-predictions.json` and `validation-predictions.json` retain per-game comparisons. `feature-rows.json`, `feature-verification.json`, `exclusions.json`, the original/amended protocol and runtime source make the calculation auditable. A failed implementation run is quarantined locally and contributes no result.

Source lineage is the official [MLB 2025 schedule](https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=2025-01-01&endDate=2025-12-31&gameTypes=R,F,D,L,W&hydrate=team,probablePitcher,linescore,decisions,gameInfo,venue,weather) and [MLB 2025 team game logs](https://statsapi.mlb.com/api/v1/teams/stats?stats=gameLog&group=hitting,pitching,fielding&season=2025&sportIds=1&gameType=R&startDate=2025-01-01&endDate=2025-12-31&limit=10000&offset=0), with corresponding 2024 and 2026 requests listed in `report.json`. Current endpoints can change; exact fetched timestamps and hashes are preserved.
