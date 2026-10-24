import {liveScorePresentation} from './board-discovery.mjs';

const text = value => typeof value === 'string' && value.trim() ? value.trim() : null;
const positivePeriod = value => Number.isInteger(value) && value > 0 ? value : null;

function periodLabel(sport, period) {
  const regulation = {nfl:4, cfb:4, nba:4, wnba:4, cbb:2, nhl:3}[sport];
  if (period === null) return null;
  if (regulation && period > regulation) return period === regulation + 1 ? 'OT' : `${period - regulation}OT`;
  if (sport === 'nhl') return `Period ${period}`;
  if (sport === 'cbb') return `Half ${period}`;
  return regulation ? `Q${period}` : `Period ${period}`;
}

/** Factual feed progress only: a reported period clock is never extrapolated.
 * Baseball has innings/outs, not a game countdown. Final grading is separate.
 */
export function liveGameProgress(game = {}, options = {}) {
  const score = liveScorePresentation(game, options);
  if (score.kind !== 'live') return null;
  const period = positivePeriod(game?.period);
  const name = text(game?.statusName) || '';
  const detail = text(game?.statusDetail) || text(game?.statusShortDetail);
  const clock = text(game?.clock);
  let parts;
  if (game?.sport === 'mlb') {
    const inning = period === null ? null : `${typeof game.isTopInning === 'boolean' ? game.isTopInning ? 'Top' : 'Bottom' : 'Inning'} ${period}`;
    // Provider detail carries actual middle/end-of-inning states when supplied.
    const phase = detail && /\b(top|bottom|middle|mid|end|inning)\b/i.test(detail) ? detail : inning || detail || 'Inning unavailable';
    const outs = Number.isInteger(game.outs) && game.outs >= 0 && game.outs <= 3 ? `${game.outs} out${game.outs === 1 ? '' : 's'}` : null;
    parts = [phase, outs];
  } else if (/HALFTIME/i.test(name)) {
    parts = ['Halftime'];
  } else if (game?.sport === 'nhl' && (/SHOOTOUT/i.test(name) || /\bshootout\b|\bSO\b/i.test(detail || ''))) {
    parts = ['Shootout', 'Untimed'];
  } else if (/END_PERIOD|INTERMISSION/i.test(name)) {
    parts = [detail || (period === null ? 'Intermission' : `End of ${periodLabel(game.sport, period)}`)];
  } else {
    const phase = periodLabel(game?.sport, period) || (/OVERTIME/i.test(name) ? 'OT' : 'Period unavailable');
    parts = game?.sport === 'cfb' && ((period !== null && period > 4) || /OVERTIME/i.test(name))
      ? [phase, 'Untimed overtime']
      : [phase, clock ? `${clock} remaining` : 'Game clock unavailable'];
  }
  const isLastReported = score.freshness !== 'live';
  return {label: `${isLastReported ? 'Last reported: ' : ''}${parts.filter(Boolean).join(' · ')}`, isLastReported};
}

/** Short prominent clock for cards and Today's plays, e.g. "Q4 · 7:14". */
export function clockBadge(game = {}, options = {}) {
  if (game?.finalPendingGrade || game?.statusDescription === 'Final') return 'FINAL';
  const progress = liveGameProgress(game, options);
  if (!progress) return null;
  return progress.label.replace(/^Last reported:\s*/, '').replace(/\s*remaining$/, '').replace(/ · Game clock unavailable$/, '').replace(/Game clock unavailable/, '—');
}
