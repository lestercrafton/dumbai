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
  const moneyline = row.sport === 'mlb' && lines.marketLine === 0;
  const need = Math.floor(-coverMargin) + 1;
  return {...base, state,
    label:moneyline ? (state === 'covering' ? `Winning by ${coverMargin}` : state === 'not-covering' ? `Needs ${need} to win` : 'Tied')
      : state === 'covering' ? `Covering by ${coverMargin.toFixed(1)}`
      : state === 'not-covering' ? `Needs ${need.toFixed(1)} to Cover` : 'Currently a push',
    isWinning:state === 'covering', tone:state === 'covering' ? 'winning' : 'neutral',
    provisional:true, coverMargin, reason:null};
}

/** Live status of the saved total pick against its market total. */
export function liveTotalStatus(game = {}, options = {}) {
  const row = game && typeof game === 'object' ? game : {};
  const pick = row.overUnder;
  const score = liveScorePresentation(row, options);
  const none = {state:'unavailable', label:null, isWinning:false, provisional:false};
  if (!pick?.side || pick.result || !finite(pick.marketTotal) || score.kind !== 'live'
    || !score.completeScore || score.freshness !== 'live') return none;
  const total = score.homeScore + score.awayScore;
  const diff = pick.side === 'over' ? total - pick.marketTotal : pick.marketTotal - total;
  const word = pick.side === 'over' ? 'Over' : 'Under';
  if (pick.side === 'under') {
    const room = diff;
    return {state:room > 0 ? 'covering' : room < 0 ? 'not-covering' : 'push',
      label:room > 0 ? `Under by ${room.toFixed(1)}` : room < 0 ? `Over by ${(-room).toFixed(1)}` : 'At the total',
      isWinning:room > 0, provisional:true};
  }
  const need = Math.floor(-diff) + 1;
  return {state:diff > 0 ? 'covering' : diff < 0 ? 'not-covering' : 'push',
    label:diff > 0 ? `${word} by ${diff.toFixed(1)}` : diff < 0 ? `Needs ${need} more` : 'At the total',
    isWinning:diff > 0, provisional:true};
}

/** Map a live cover state to the graded outcome shown once the clock hits FINAL. */
export function coverToOutcome(state){
 return state==='covering'?'win':state==='not-covering'?'loss':state==='push'?'push':null;
}

/** Card badge text for a provisional final (before the board grades it). */
export function provisionalFinalLabel(state,{short=false}={}){
 const outcome=coverToOutcome(state);
 if(!outcome)return null;
 if(short)return ({win:'Win',loss:'Loss',push:'Push'})[outcome];
 return ({win:'Big Vin Wins.',loss:'Learn',push:'Push'})[outcome];
}

/** Graded or score-derived O/U outcome for a final/completed game.
 * Prefers the saved grade; otherwise compares final scores to the market total
 * once the game is done (including live-overlay finals pending board grade). */
export function totalPickOutcome(game = {}) {
  const row = game && typeof game === 'object' ? game : {};
  const pick = row.overUnder;
  if (!pick?.side || !finite(pick.marketTotal)) return null;
  if (pick.result && ['win','loss','push'].includes(pick.result)) return pick.result;
  const done = row.result?.status === 'completed' || row.completed || row.status === 'completed'
    || row.status === 'final' || !!row.finalPendingGrade;
  if (!done) return null;
  const home = finite(row.result?.homeScore) ? row.result.homeScore
    : finite(row.liveHomeScore) ? row.liveHomeScore
    : finite(row.homeScore) ? row.homeScore : null;
  const away = finite(row.result?.awayScore) ? row.result.awayScore
    : finite(row.liveAwayScore) ? row.liveAwayScore
    : finite(row.awayScore) ? row.awayScore : null;
  if (!finite(home) || !finite(away)) return null;
  const total = home + away;
  if (Math.abs(total - pick.marketTotal) < 1e-9) return 'push';
  if (pick.side === 'over') return total > pick.marketTotal ? 'win' : 'loss';
  return total < pick.marketTotal ? 'win' : 'loss';
}
