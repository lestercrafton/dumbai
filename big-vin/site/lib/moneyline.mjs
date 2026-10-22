import {displayLines} from './board-presentation.mjs';

/** Spread-to-moneyline conversion for the board's model estimate.
 * Big Vin forecasts a margin; its fair spread implies an estimated win chance
 * using one sport-specific margin standard deviation (normal CDF).
 * moneylineComparison uses an actual sportsbook quote for Vegas ML.
 * This is a transparent conversion, not a calibrated probability
 * model. Sigmas are the frozen model's residual RMSE on saved 2026 season
 * forecasts (Oct 16 backtest) where available; NBA/CBB use league-typical
 * margin SDs until those sports have graded saved forecasts. */
export const MARGIN_SIGMA = Object.freeze({nfl: 12.3, cfb: 19.3, nba: 12, wnba: 13.3, cbb: 10.5, nhl: 2.6, mlb: 3.8});
const erf = (x) => {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x < 0 ? -y : y;
};
export const winProbability = (expectedMargin, sport) => {
  const sigma = MARGIN_SIGMA[sport];
  if (!Number.isFinite(expectedMargin) || !sigma) return null;
  return 0.5 * (1 + erf((expectedMargin / sigma) / Math.SQRT2));
};
export const fairAmericanOdds = (probability) => {
  if (!Number.isFinite(probability) || probability <= 0 || probability >= 1) return null;
  const rounded = probability >= 0.5 ? -Math.round((100 * probability) / (1 - probability)) : Math.round((100 * (1 - probability)) / probability);
  return Math.abs(rounded) < 100 ? (rounded < 0 ? -100 : 100) : rounded;
};
const signedOdds = (v) => v === null ? '—' : `${v > 0 ? '+' : ''}${v}`;
/** Estimated net units won/lost per 100 units staked at the actual ML quote.
 * Keep the probability and result unrounded until presentation. The quoted
 * payout already reflects the book's price; do not remove its margin or
 * force a favorable spread pick to have positive moneyline EV. */
export function moneylineExpectedValue(probability, odds) {
  if (!Number.isFinite(probability) || probability <= 0 || probability >= 1
    || !Number.isInteger(odds) || Math.abs(odds) < 100) return null;
  const profitIfWin = odds > 0 ? odds : 10000 / -odds;
  const ev = probability * profitIfWin - (1 - probability) * 100;
  return Math.abs(ev) < 1e-10 ? 0 : ev;
}
/** Moneyline pair for the board's pick team: what the Vegas spread implies
 * for that team, and what Big Vin's line says it should be. */
export function moneylinePair(record, sport) {
  const margin = record.predictedMargin ?? record.projection?.predictedHomeMargin;
  const spread = record.marketHomeSpread ?? record.market?.homeSpread;
  if (!Number.isFinite(margin) || !Number.isFinite(spread)) return null;
  const edge = margin + spread;
  if (Math.abs(edge) < 1e-9) return null;
  const side = record.side ?? (edge > 0 ? 'home' : 'away');
  const pickIsHome = side === 'home';
  const team = pickIsHome ? record.home : record.away;
  const teamName = typeof team === 'string' ? team : team?.abbreviation || team?.name || 'Pick';
  const vegasMargin = pickIsHome ? -spread : spread; // expected margin for the pick team, from the market spread
  const bigVinMargin = pickIsHome ? margin : -margin;
  const vegasProb = winProbability(vegasMargin, sport);
  const bigVinProb = winProbability(bigVinMargin, sport);
  return {
    team: teamName, side,
    vegasImplied: signedOdds(fairAmericanOdds(vegasProb)), bigVinFair: signedOdds(fairAmericanOdds(bigVinProb)),
    vegasProb, bigVinProb,
  };
}

/** A compact comparison for the displayed ATS team. Only the model price is
 * converted. The book price must be a real American-odds quote and retains its
 * own snapshot metadata; a saved ATS price is never substituted for it. */
export function moneylineComparison(record, sport) {
  let lines = displayLines(record);
  // NHL/MLB: on a pass, still compare the model's favored team at its ML.
  if (!lines.side && sport === 'mlb') {
    const m = record.predictedMargin ?? record.projection?.predictedHomeMargin;
    if (Number.isFinite(m) && m !== 0) {
      const side = m > 0 ? 'home' : 'away', team = record[side];
      lines = {...lines, side, teamShort: team?.abbreviation || team?.name || 'Team', teamName: team?.displayName || team?.name || 'Team', fairLine: -Math.abs(m)};
    }
  }
  if (!lines.side || !Number.isFinite(lines.fairLine)
    || record.paperWager?.kind === 'synthetic-winner-even') return null;
  const probability = winProbability(-lines.fairLine, sport);
  const implied = fairAmericanOdds(probability);
  if (implied === null) return null;
  const quote = Object.hasOwn(record, 'moneylineMarket') ? record.moneylineMarket : record.market;
  const price = lines.side === 'home' ? quote?.homeMoneyline : quote?.awayMoneyline;
  const vegas = typeof price === 'number' && Number.isInteger(price) && Math.abs(price) >= 100 ? price : null;
  const evPer100 = moneylineExpectedValue(probability, vegas);
  const displayedEV = evPer100 === null ? null : Number(evPer100.toFixed(2)) || 0;
  const historical = quote?.timing === 'historical-display-time-unverified' || record.completed || record.status === 'completed';
  return {
    team: lines.teamShort, teamName: lines.teamName, side: lines.side,
    implied: signedOdds(implied), vegas: signedOdds(vegas),
    evPer100, ev: displayedEV === null ? '—' : `${displayedEV > 0 ? '+' : displayedEV < 0 ? '-' : ''}${Math.abs(displayedEV).toFixed(2)}u`,
    quote: vegas === null ? null : {
      provider: quote?.provider || 'Feed provider', observedAt: quote?.observedAt || null,
      providerUpdatedAt: quote?.providerUpdatedAt || null,
      historical: !!historical,
      label: historical ? 'Vegas ML (feed)' : record.archived ? 'Vegas ML (latest)' : 'Vegas ML',
    },
  };
}

/** Worst American price at which a win chance still clears minValue per $1 staked.
 * Rounded toward the better price so the bar is never loosened. */
export function worstPlayablePrice(probability, minValue = 0.03) {
  if (!Number.isFinite(probability) || probability <= 0 || probability >= 1) return null;
  const win = (1 + minValue - probability) / probability; // profit per $1 needed
  if (!(win > 0)) return null;
  const odds = win >= 1 ? Math.ceil(win * 100 - 1e-9) : -Math.floor(100 / win + 1e-9);
  return Math.abs(odds) < 100 ? 100 : odds;
}
/** NHL +1.5 picks: cover rate of the saved 2026 puck line picks (88-48 through
 * Oct 22, shrunk by one win and one loss). Game-level cover chances from the
 * model margin were overconfident, so the price bar uses this record. */
export const NHL_PUCK_COVER = (88 + 1) / (136 + 2);
/** "playable to -143" for an NHL/MLB moneyline pick. */
export function playablePriceText(game, sport) {
  if (sport === 'nhl') {
    if (game.side !== 'home' && game.side !== 'away') return null;
    const odds = worstPlayablePrice(NHL_PUCK_COVER);
    return odds === null ? null : `playable to ${signedOdds(odds)}`;
  }
  if (sport !== 'mlb') return null;
  const margin = game.predictedMargin ?? game.projection?.predictedHomeMargin;
  if (!Number.isFinite(margin)) return null;
  const picked = game.side === 'home' || game.side === 'away';
  const side = picked ? game.side : margin > 0 ? 'home' : margin < 0 ? 'away' : null;
  if (!side) return null;
  const odds = worstPlayablePrice(winProbability(side === 'home' ? margin : -margin, sport));
  if (odds === null) return null;
  const team = game[side];
  return `${picked ? '' : `${team?.abbreviation || team?.name || 'Team'} `}playable to ${signedOdds(odds)}`;
}
