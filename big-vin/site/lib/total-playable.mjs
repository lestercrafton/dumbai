/** Worst total line that still meets the totals edge bar (same both ways;
 * CFB overs need 3). Mirrors big-vin/lib/totals.mjs MIN_TOTAL_EDGE. */
const MIN_TOTAL_EDGE = {nfl: 1, cfb: 1, nba: 1.5, wnba: 1.5, cbb: 1.5};
export function playableTotal(sport, side, modelTotal) {
  if (!Number.isFinite(modelTotal) || (side !== 'over' && side !== 'under')) return null;
  const need = sport === 'cfb' && side === 'over' ? 3 : MIN_TOTAL_EDGE[sport] ?? 0;
  return side === 'under' ? Math.ceil((modelTotal + need) * 2) / 2 : Math.floor((modelTotal - need) * 2) / 2;
}
