# NBA learned win chance ran backwards (Nov 4–23, 2026): why

Research only. Nothing live changed. Data: the tracked NBA picks pulled for `../clv-rank-2026-11-24` (Nov 24, about 4:25 PM CT);
the local replay matches the live bankroll. `analyze.mjs` -> `analysis.json`, `fixes.mjs` -> `fixes.json`.

## Verdict
The negative correlation is not a code bug and not pure coin-flip noise. Mechanically, the buckets were reversing to the mean,
and the history they learned from came from the previous model.
- The six NBA buckets (favorite/underdog × gap <2, 2–5, 5+) learned their win chance from ridge-v1 picks, Oct 20 – Nov 1 (37-55),
  with only 7–25 picks per bucket. NBA v2 (live from Nov 2) inherited those numbers. The October patterns then flipped.
  Medium underdogs had gone 6-19 under ridge-v1, so the estimate was 47%, and they went 22-8 under v2. Large underdogs had gone 9-5,
  so the estimate was 51%, and they went 7-10.
- At the same time, the NBA model is having a hot month: 91-60 (60.3%) in the window. Its 2025-26 holdout backtest was 655-667 (49.5%).
- Effect on money was small. Estimates only spanned 42.5%–53.5%, so few picks cleared break-even (52.4%): Kelly-positive picks went 10-10.
  The NBA bankroll stakes only starred (totals-edge) games.

## Key numbers
- corr(win chance, win) = −0.209 over 151 picks and 20 days. Permutation p = 0.011 (10,000 shuffles). Day-block bootstrap 95%: −0.33 to −0.06.
  Caveat: the win chance takes only six bucket values at a time, so this is really about two buckets
  (medium and large underdogs), and the p-value overstates how independent the evidence is.
- By week: −0.27 (Nov 2 week, 39 picks), −0.23 (51), −0.37 (51), +0.17 (10, partial). So it held for three weeks; it is not one bad stretch.
- No side or sign bug: 151/151 sides agree with the model's margin vs the line; no pick revision changed side. Frozen-at-kickoff logic behaves as designed.
- Raw model edge in the window: corr(edge, cover) = −0.15. Edge 0–2: 34-20; 2–5: 37-19; 5+: 20-21.
  Over the 3-season backtest (`big-vin/data/research/nba-backtest-2026-11-01.json`), NBA v2 vs the opener went 50.9% (2024-25) and 49.5% (2025-26) overall,
  and 53.4% and 56.1% at edge 5+. The model has no proven spread edge outside maybe the 5+ tier, so this month's 60% looks like luck,
  and so does the small-edge outperformance.

## Candidate fixes (walk-forward, same window)
| Learner | corr with win | Estimate range | Kelly-positive picks | Top 3 per day |
|---|---|---|---|---|
| Live: all versions, prior 100 | −0.209 | 42.5–53.5% | 10-10, −$0.02 | 29-30, −$0.06 |
| Same model version only | −0.111 | 52.5–59.5% | 89-58, +$0.16 | 36-23, +$0.18 |
| Prior 300 | −0.196 | 47.8–52.7% | 14-13, +$0.02 | 29-30, −$0.06 |
| Same version + prior 300 | −0.095 | 52.6–56.0% | 87-55, +$0.17 | 37-22, +$0.21 |
| No buckets (sport rate only) | −0.067 | 47.3–52.4% | 13-5, +$0.42 | 31-28, +$0.01 |
| Same version + prior 300 at backtest 49.5% | −0.072 | 49.8–54.3% | 30-26, +$0.04 | 33-26, +$0.08 |

The "same version" rows look best only because v2's hot month pushes every estimate above break-even. That would chase
151 picks against two seasons of ~50%. It is not evidence of a better learner.
