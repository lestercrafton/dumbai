# Why Big Vin's NHL picks were almost all underdogs, and the fix (Nov 26, 2026)

## Data
- Tracked NHL picks from the live site (`/api/results?sport=nhl&history=1`) and `/api/bankroll`, pulled Nov 26, 2026 about 1:24 AM CT.
  Picks Sep 29 – Nov 23, 2026 (Central): 399 priced picks, 384 graded, all `ridge-v1`. Raw pulls are not committed.
- Both puck-line prices are saved from Oct 22 on, so the price-aware tests use the 231 graded games from Oct 22 – Nov 23.
- Moneyline tests use `playbook/odds/nhl/*.jsonl` snapshots (last one before the pick locked).
- Scripts: `analyze.mjs` -> `analysis.json` (diagnosis), `backtest.mjs` -> `backtest.json` (flat price-aware tests),
  `replay.mjs` -> `replay.json` (Kelly bankroll replays on the real code), `diff-sports.mjs` -> `diff-sports.json` (other sports unchanged).

## Diagnosis
- The NHL puck line is ±1.5. The side was chosen by model margin vs line, ignoring price (`lib/pick-revisions.mjs` `spreadSelection`).
  The model's margin is above 1.5 goals in only 3.5% of games (median 0.48), so it took the +1.5 side in 386 of 399 picks (96.7%).
  The model picked the betting favorite to win straight up in 81% of games; this was a side-selection artifact, not an underdog belief.
- The margin model itself is fine: actual margin vs predicted slope 1.04, RMSE 2.5 goals (the assumed sigma is 2.6).
- Results: +1.5 picks 239-132 (64.4%) at an average −202 (66.2% needed), −3.1% flat; the other side of every pick, −3.5%. No edge either way.
- Staking: the bucket win chance (`lib/rank-signal.mjs`) ignores price and was earned mostly at about −200, so Kelly treated cheap prices as big edges
  (e.g. Carolina −1.5 at +114 and Boston −1.5 at +105 at about 61%, staked 26% and 25%, both lost). NHL bankroll: −44.6%, max drawdown 72.7%.

## Fix (owner-approved Nov 26, 2026), from Nov 27, 2026 12:00 AM CT (`lib/nhl-pricing.mjs`)
1. Side: the cover chance for each side from the model margin (normal, sigma 2.6); take the side with the better expected value at its own price.
2. Win chance for ranking and Kelly %: 50% that model chance + 50% the market's no-vig chance from both puck-line prices.
3. NHL is shown and graded but not staked and never starred, until a walk-forward test shows an edge (revisit at about 500 graded games).
Earlier NHL games keep the rules they were picked and staked under, so the published NHL history does not change.

## Replay, Oct 22 – Nov 23, 2026 ($1M from Oct 22; learning uses all earlier finals)
| Rule | Flat record / ROI | +1.5 share | Kelly bets | Staked record | Ending bankroll | Max drawdown |
|---|---|---|---|---|---|---|
| A. Current, as live (stars only from Nov 4) | 144-87, −6.5% | 96.5% | 49 | 28-21 | $571,459 (−42.9%) | 68.2% |
| B. Current, every positive-Kelly pick | 144-87, −6.5% | 96.5% | 73 | 37-36 | $205,075 (−79.5%) | 87.7% |
| C. Fixed 1+2, every positive-Kelly pick | 133-98, +2.1% | 70.1% | 85 | 46-39 | $858,010 (−14.2%) | 40.5% |
| D. Fixed 1+2+3 (as shipped: unstaked) | 133-98, +2.1% | 70.1% | 0 | — | $1,000,000 | 0% |

- The fixed win chance is roughly calibrated (predicted 35% / 43% / 56% / 66% / 72% vs actual 38% / 52% / 50% / 67% / 72%);
  the old one put 205 of 231 picks at about 64%.
- Even with the fixes, full Kelly lost money in this window (C). The +2.1% flat gain is not statistically significant (SE about 6%).
  That is why NHL stays unstaked.

## Other sports
`diff-sports.json`: for CFB, CBB, NBA, NFL, MLB and WNBA, the bankroll replay, rank signal, side, win chance and star are identical on main and on this change,
both at their saved times and if quoted after Nov 27. The NHL bankroll replay and every saved NHL pick are also identical (all before Nov 27).
