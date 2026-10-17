/** Spread-to-moneyline conversion for the board.
 * Vegas does not post a moneyline for every game we list, and Big Vin only
 * forecasts a margin. Both moneylines below are therefore derived from a
 * spread with one sport-specific margin standard deviation (normal CDF):
 * the Vegas spread implies one win chance; Big Vin's fair spread implies
 * the other. This is a transparent conversion, not a calibrated probability
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
