/** Big Vin spreadsheet compatibility plus consistent settlement accounting.
 * Historical blend/edge/rank source: see ../sheet-forensics.md.
 * Signed margins use dataFave score minus dataDog score. A market margin of +3
 * therefore means the dataFave is offered at -3. Percent edge is NOT a win
 * probability. Missing inputs remain null; they are never silently zeroed.
 */
const finite = (x) => typeof x === 'number' && Number.isFinite(x);
const MODELS = ['sag', 'whiteOwl', 'goldenMean', 'recent'];
export const HISTORICAL_WEIGHTS = Object.freeze({
  cbb_20210203: Object.freeze([0.3714, 0.30, 0.2046, 0.124]),
  cbb_20210322: Object.freeze([0.3643, 0.2914, 0.225, 0.1193]),
  nba_20210517: Object.freeze([0.29, 0.26, 0.24, 0.21]),
  nhl_20210521: Object.freeze([0.20, 0.30, 0.30, 0.20]),
  spring_cfb_20210508: Object.freeze([0.26, 0.24, 0.26, 0.24]),
});

export function blendMargins(margins, weights) {
  const values = Array.isArray(margins) ? margins : MODELS.map((k) => margins?.[k]);
  if (values.length !== 4 || !values.every(finite)) return null;
  if (!Array.isArray(weights) || weights.length !== 4 ||
      !weights.every((w) => finite(w) && w >= 0) ||
      Math.abs(weights.reduce((a, b) => a + b, 0) - 1) > 1e-9) {
    throw new RangeError('Four nonnegative model weights must sum to one.');
  }
  return values.reduce((sum, value, i) => sum + value * weights[i], 0);
}

export function legacyEdge(modelMargin, marketProjectedMargin) {
  if (!finite(modelMargin) || !finite(marketProjectedMargin)) return null;
  const difference = modelMargin - marketProjectedMargin;
  return {
    rawEdge: Math.abs(difference),
    percentEdge: marketProjectedMargin === 0 ? null : Math.abs(difference / marketProjectedMargin),
    // Legacy IF(model>market,fave,dog) selects the data dog on an exact tie.
    legacySide: difference > 0 ? 'dataFave' : 'dataDog',
    // New recommendations should pass when there is no model/market edge.
    side: difference === 0 ? null : difference > 0 ? 'dataFave' : 'dataDog',
    selectedSpread: difference === 0 ? null : difference > 0 ? -marketProjectedMargin : marketProjectedMargin,
  };
}

function competitionRank(value, values, descending = true) {
  if (!finite(value)) return null;
  return 1 + values.filter((v) => finite(v) && (descending ? v > value : v < value)).length;
}

/** Returns input order with numeric ranks; choose/sort display order explicitly.
 * rows: {id, dataFave, dataDog, modelMargins:[sag,owl,golden,recent],
 *        marketProjectedMargin}. Percent-edge zero denominators are unranked.
 */
export function rankLegacyCard(rows, {weights, percentRankWeight = 0.35} = {}) {
  if (!finite(percentRankWeight) || percentRankWeight < 0 || percentRankWeight > 1)
    throw new RangeError('Percent rank weight must be between zero and one.');
  const card = rows.map((row) => {
    const modelMargin = blendMargins(row.modelMargins, weights);
    return {...row, modelMargin, ...legacyEdge(modelMargin, row.marketProjectedMargin)};
  });
  for (const row of card) {
    row.rawRank = competitionRank(row.rawEdge, card.map((r) => r.rawEdge));
    row.percentRank = competitionRank(row.percentEdge, card.map((r) => r.percentEdge));
    row.blendRank = row.rawRank === null || row.percentRank === null ? null :
      percentRankWeight * row.percentRank + (1 - percentRankWeight) * row.rawRank;
  }
  return card.map((row) => ({...row, pickRank: competitionRank(row.blendRank, card.map((r) => r.blendRank), false)}));
}

export function americanToDecimal(odds) {
  if (!finite(odds) || Math.abs(odds) < 100) return null;
  return odds > 0 ? 1 + odds / 100 : 1 + 100 / -odds;
}

export function impliedProbability(odds) {
  const decimal = americanToDecimal(odds);
  return decimal === null ? null : 1 / decimal;
}

export function fairAmericanOdds(probability) {
  if (!finite(probability) || probability <= 0 || probability >= 1) return null;
  if (probability === 0.5) return 100;
  return probability > 0.5 ? -100 * probability / (1 - probability) : 100 * (1 - probability) / probability;
}

export function noVigProbabilities(oddsA, oddsB) {
  const a = impliedProbability(oddsA), b = impliedProbability(oddsB);
  if (a === null || b === null) return null;
  return {a: a / (a + b), b: b / (a + b), overround: a + b - 1};
}

/** Probabilities are unconditional, so pushes are explicitly allowed. */
export function expectedValuePerUnit(winProbability, odds, pushProbability = 0) {
  const decimal = americanToDecimal(odds);
  if (decimal === null || !finite(winProbability) || !finite(pushProbability) ||
      winProbability < 0 || pushProbability < 0 || winProbability + pushProbability > 1) return null;
  return winProbability * (decimal - 1) - (1 - winProbability - pushProbability);
}

/** A unit consistently means amount risked. Prices remain the recorded prices.
 * Call only with the provider's settlement scores/status (including applicable OT).
 */
export function settleBet({status, market, selection, homeScore, awayScore, line, odds, risk = 1}) {
  if (!finite(risk) || risk < 0) throw new RangeError('Risk must be a nonnegative number.');
  const pending = {outcome: 'pending', pnl: null, risk, gradedRisk: 0};
  if (status === 'void' || status === 'cancelled') return {outcome: 'void', pnl: 0, risk, gradedRisk: 0};
  if (!['final', 'completed'].includes(status) || !finite(homeScore) || !finite(awayScore) || homeScore < 0 || awayScore < 0) return pending;
  const decimal = americanToDecimal(odds);
  if (decimal === null) return pending;
  let margin;
  if (market === 'spread' && ['home', 'away'].includes(selection) && finite(line)) {
    margin = (selection === 'home' ? homeScore - awayScore : awayScore - homeScore) + line;
  } else if (market === 'total' && ['over', 'under'].includes(selection) && finite(line)) {
    margin = (homeScore + awayScore - line) * (selection === 'over' ? 1 : -1);
  } else if (market === 'moneyline' && ['home', 'away'].includes(selection)) {
    margin = (homeScore - awayScore) * (selection === 'home' ? 1 : -1);
  } else return pending;
  const outcome = margin === 0 ? 'push' : margin > 0 ? 'win' : 'learn';
  return {outcome, pnl: outcome === 'push' ? 0 : outcome === 'win' ? risk * (decimal - 1) : -risk, risk, gradedRisk: risk};
}

export function summarizeLedger(settlements) {
  const totals = {win: 0, learn: 0, push: 0, void: 0, pending: 0, pnl: 0, gradedRisk: 0};
  for (const entry of settlements) {
    if (!['win', 'learn', 'push', 'void', 'pending'].includes(entry.outcome)) continue;
    totals[entry.outcome]++;
    if (entry.outcome !== 'pending' && finite(entry.pnl)) totals.pnl += entry.pnl;
    if (['win', 'learn', 'push'].includes(entry.outcome) && finite(entry.gradedRisk)) totals.gradedRisk += entry.gradedRisk;
  }
  return {...totals, winRate: totals.win + totals.learn ? totals.win / (totals.win + totals.learn) : null,
    roi: totals.gradedRisk > 0 ? totals.pnl / totals.gradedRisk : null};
}

export function bankrollStake(bankroll, fraction = 0.02) {
  return finite(bankroll) && bankroll >= 0 && finite(fraction) && fraction >= 0 && fraction <= 1 ? bankroll * fraction : null;
}
