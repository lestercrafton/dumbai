import residuals from './margin-residuals.json' with {type: 'json'};
import {moneylineExpectedValue, worstPlayablePrice} from './moneyline.mjs';
import {MIN_ML_VALUE} from './pick-revisions.mjs';
const finite = v => typeof v === 'number' && Number.isFinite(v);
const sign = v => `${v > 0 ? '+' : ''}${v}`;
/** Chance the home team's final margin beats -homeSpread, from the empirical
 * distribution of saved forecast misses (actual minus predicted margin). */
export function homeCoverProbability(sport, margin, homeSpread) {
  const r = residuals[sport];
  if (!r?.length || !finite(margin) || !finite(homeSpread)) return null;
  let covers = 0;
  for (const e of r) if (margin + e + homeSpread > 0) covers++;
  // Light shrink so a 0 or 1 count never reads as certainty.
  return (covers + 1) / (r.length + 2);
}
/** Puck/run line pick: the side whose price beats its cover chance by the same
 * value bar as the moneyline, otherwise pass. */
export function runLinePick(sport, margin, {homeSpread, homePrice, awayPrice} = {}) {
  if (!finite(homeSpread) || Math.abs(homeSpread) < 0.5) return null;
  const p = homeCoverProbability(sport, margin, homeSpread);
  if (p === null) return null;
  const home = moneylineExpectedValue(p, homePrice), away = moneylineExpectedValue(1 - p, awayPrice);
  if (home === null || away === null) return null;
  const best = home >= away ? {side: 'home', value: home / 100, p, odds: homePrice, line: homeSpread}
    : {side: 'away', value: away / 100, p: 1 - p, odds: awayPrice, line: -homeSpread};
  if (best.value < MIN_ML_VALUE) return {side: null, homeSpread};
  return {side: best.side, homeSpread, line: best.line, odds: best.odds, probability: best.p, playable: worstPlayablePrice(best.p, MIN_ML_VALUE)};
}
export const runLineText = (pick, team) => pick?.side ? `${team} ${pick.line > 0 ? '+' : '−'}${Math.abs(pick.line).toFixed(1)}` : 'No pick';
export const playableOdds = odds => `playable to ${sign(odds)}`;
export function gradeRunLine(pick, homeScore, awayScore) {
  if (!pick?.side || !finite(homeScore) || !finite(awayScore)) return null;
  const c = (homeScore - awayScore + pick.homeSpread) * (pick.side === 'home' ? 1 : -1);
  return c === 0 ? 'push' : c > 0 ? 'win' : 'loss';
}
/** Season record from saved puck/run line offers on graded forecasts. */
export function runLineRecord(forecasts, sport) {
  const rec = {wins: 0, losses: 0, pushes: 0, units: 0};
  for (const f of forecasts) {
    if (f.result?.status !== 'completed' || !finite(f.runLineHomeSpread)) continue;
    const pick = runLinePick(sport, f.predictedMargin, {homeSpread: f.runLineHomeSpread, homePrice: f.runLineHomePrice, awayPrice: f.runLineAwayPrice});
    const g = gradeRunLine(pick, f.result.homeScore, f.result.awayScore);
    if (g === 'win') { rec.wins++; rec.units += pick.odds > 0 ? pick.odds / 100 : 100 / -pick.odds; }
    else if (g === 'loss') { rec.losses++; rec.units -= 1; } else if (g === 'push') rec.pushes++;
  }
  rec.units = Math.round(rec.units * 100) / 100;
  return rec;
}
