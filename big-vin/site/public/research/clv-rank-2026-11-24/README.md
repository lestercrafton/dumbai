# Line movement (CLV) as the ranking signal: backtest (Nov 24, 2026)

Research only. **Nothing live changed.** The board and bankroll still rank and stake by Kelly %.

## Question
Since Oct 24 the board and bankroll rank by Kelly %, which uses the learned win chance and the price. The older
rank signal (`lib/rank-signal.mjs`) also learns an *expected line movement* (closing-line value, CLV) per bucket
(favorite/underdog × small/medium/large gap) and was meant to switch to it once a sport had 100 closing lines.
Would ranking or staking by expected CLV, or a blend, beat the current Kelly ranking?

## Data
- Tracked pick history from the live site, `/api/results?sport=S&history=1&historyDate=D`, every week Aug 24 – Nov 23,
  pulled Nov 24, 2026 at about 4:25 PM CT (`merge.mjs`). Raw pulls are not committed (about 12 MB).
- `validate.mjs`: the local `replayKellyBankroll` matches the live `/api/bankroll` for every sport (same picks, same
  staked bets, same ending bankroll).
- Realized CLV = the line taken minus the closing line, from the picked side (positive = the market moved our way).
  Closing lines are ESPN's last pregame line (`big-vin/data/spreads/history-*.json` or the saved grade). The line
  taken may be from a different book than the closing line, which adds noise.

| Sport | Graded picks | With a closing line | Picked before kickoff | Picks where the signal already had ≥100 closing lines (out-of-sample) |
|---|---|---|---|---|
| CFB | 1,083 | 0 | 1,083 | 0 |
| CBB | 980 | 956 | 980 | 859 (837 with a close), from Nov 3 |
| NBA | 258 | 250 | 258 | 151 (143 with a close), from Nov 4 |
| NFL | 161 | 0 | 161 | 0 |
| NHL | 384 | 0 | 384 | 0 |
| MLB | 232 | 0 | 232 | 0 |
| WNBA | 50 | 0 | 50 | 0 |

Football, hockey and baseball have no saved closing lines, so line movement cannot rank them at all.

## Method (`backtest.mjs`)
Walk-forward, no look-ahead: each pick uses the frozen rank signal (only finals recorded before its kickoff), its
own line and price. Expected CLV is used only once ≥100 closing lines were known before that kickoff
(the old `CLV_SWITCH`); before that every variant equals the current rule.
- **A current**: Kelly % from the learned win chance; order by Kelly %.
- **B rank by expected CLV**: order the day by expected CLV (B1: stakes still Kelly; B2: Kelly only when expected CLV > 0).
- **C blend**: win chance + expected CLV × φ(0)/σ (σ = spread of cover margins graded before kickoff); Kelly on that.
Bankroll replays use the live rules (stars only from Nov 4, daily 100% cap via `fitSequentialKelly`).
"All picks" drops the star gate to get more bets. Day-paired bootstrap (2,000 resamples) for top-of-card differences.

## Results (out-of-sample window only)

### Does expected CLV predict anything?
| | CBB | NBA |
|---|---|---|
| corr(expected CLV, realized CLV) | +0.10 | −0.05 |
| corr(expected CLV, win) | −0.02 | +0.13 |
| corr(learned win chance, win) | +0.04 | −0.21 |
| corr(realized CLV, win), all picks | +0.09 | +0.05 |
| Average realized CLV, all picks | +0.19 pts (956) | +0.10 pts (250) |

In CBB, the buckets with the most favorable line movement (large underdogs, +0.55 pts) went 77-106 (42.1%).
Line movement toward a pick has barely related to covering in this sample.

### Top of each day's card, flat $1 per pick
| Sport / slice | Kelly order (current) | Expected-CLV order | Blend | CLV − Kelly, $/pick [95% CI] |
|---|---|---|---|---|
| CBB top 3 (22 days) | 37-29, +$0.089, CLV −0.10 | 24-42, −$0.306, CLV +0.60 | 35-31, +$0.030 | −0.40 [−0.70, −0.07] |
| CBB top 5 | 58-52, +$0.017, CLV −0.05 | 43-67, −$0.257, CLV +0.40 | 57-53, +$0.001 | −0.27 [−0.56, −0.01] |
| CBB top 10 | 112-108, −$0.026, CLV +0.18 | 98-122, −$0.153, CLV +0.50 | 108-112, −$0.059 | −0.13 [−0.28, +0.01] |
| NBA top 3 (20 days) | 29-30, −$0.059, CLV −0.02 | 39-20, +$0.265, CLV +0.04 | 28-31, −$0.089 | +0.33 [+0.07, +0.58] |
| NBA top 5 | 55-40, +$0.107, CLV +0.02 | 58-37, +$0.167, CLV −0.03 | 54-41, +$0.088 | +0.06 [−0.08, +0.23] |
| NBA top 10 | 87-58, +$0.145, CLV +0.09 | same | same | 0.00 |

### Bankroll ($1M start, out-of-sample window to Nov 23)
| Sport | Rule | Live rules (stars only): end / max drawdown / bets | All picks: end / max drawdown / bets |
|---|---|---|---|
| CBB | A current | $988,560 / 11.3% / 18 | $837,504 / 51.5% / 186 |
| CBB | B1 CLV order | $988,560 / 11.3% / 18 | $860,002 / 51.5% / 188 |
| CBB | B2 CLV gate | $988,560 / 11.3% / 18 | $837,504 / 51.5% / 186 |
| CBB | C blend | $901,658 / 20.9% / 23 | $755,753 / 55.8% / 181 |
| NBA | A current | $1,000,000 / 0% / 0 | $1,046,607 / 7.7% / 20 |
| NBA | B1 / B2 | same as A | same as A |
| NBA | C blend | $1,000,000 / 0% / 0 | $1,053,512 / 9.2% / 26 |

## Decision: no change
- CBB: ranking by expected CLV finds picks the market moves toward, but they cover far less often; it loses
  clearly at the top of the card, and the blend loses more bankroll with a deeper drawdown.
- NBA: the CLV order won more top-3 picks, but expected CLV did not predict realized CLV (corr −0.05), so the gain
  is not line movement; it comes from one bucket (medium underdogs, 22-8) over 20 days, it vanishes at top 5 and
  top 10, and under the live rules NBA staked no bets in this window, so profit and drawdown cannot improve.
  With about a dozen comparisons, one interval clearing zero is expected by chance.
- Other sports have no closing lines.

Re-run when NBA has a full season of closing lines, or if football closing lines start being saved.

Files: `merge.mjs`, `validate.mjs`, `backtest.mjs`, `out/report.json` (all numbers), `out/pick-rows.csv` (one row per graded pick).
