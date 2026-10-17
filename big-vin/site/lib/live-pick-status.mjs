import {displayLines} from './board-presentation.mjs';
import {liveScorePresentation} from './board-discovery.mjs';

const finite = value => typeof value === 'number' && Number.isFinite(value);

/** Provisional status of the ATS recommendation actually displayed on the card.
 * This is a score comparison against its original/displayed line, not a grade,
 * prediction, outright winner, or inferred moneyline recommendation. Only a
 * fresh observed score currently covering that line receives a winning tone.
 */
export function livePickStatus(game = {}, options = {}) {
  const row = game && typeof game === 'object' ? game : {};
  const lines = displayLines(row);
  const score = liveScorePresentation(row, options);
  const base = {state:'unavailable', label:'Live pick status unavailable',
    isWinning:false, tone:'neutral', provisional:false, side:lines.side,
    pick:lines.pick, line:lines.marketLine, coverMargin:null, reason:null};

  // Final/void decisions belong to the existing result grader and record UI.
  if (score.kind === 'final' || row.result?.status === 'void')
    return {...base, state:'settled', label:'Final result', reason:'settled'};
  if (score.kind !== 'live') return {...base, reason:'not-live'};
  if (!lines.pick || !['home','away'].includes(lines.side) || !finite(lines.marketLine))
    return {...base, reason:'no-ats-pick'};
  if (!score.completeScore) return {...base, reason:'incomplete-score'};
  if (row.stale) return {...base, reason:'stale-line'};
  if (score.freshness !== 'live') return {...base, label:'Last reported score', reason:'stale-score'};

  const selectedScore = lines.side === 'home' ? score.homeScore : score.awayScore;
  const opponentScore = lines.side === 'home' ? score.awayScore : score.homeScore;
  const margin = selectedScore - opponentScore + lines.marketLine;
  const coverMargin = Math.abs(margin) < 1e-9 ? 0 : margin;
  const state = coverMargin > 0 ? 'covering' : coverMargin < 0 ? 'not-covering' : 'push';
  return {...base, state,
    label:state === 'covering' ? `Covering by ${coverMargin.toFixed(1)}`
      : state === 'not-covering' ? `Needs ${(Math.floor(-coverMargin) + 1).toFixed(1)} to Cover` : 'Currently a push',
    isWinning:state === 'covering', tone:state === 'covering' ? 'winning' : 'neutral',
    provisional:true, coverMargin, reason:null};
}
