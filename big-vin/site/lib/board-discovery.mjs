/** Presentation-only board discovery. These helpers do not change API windows,
 * server ranks, score observations, grades, or record cohorts. */
const centralClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const LIVE_FRESHNESS_MS = 3 * 60 * 1000;
const finite = value => typeof value === 'number' && Number.isFinite(value);

function timestamp(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (finite(value)) return Number.isFinite(new Date(value).getTime()) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function startTimestamp(value) {
  // A date without a clock is not a known start time. Normalized feed timestamps
  // are ISO instants; do not turn a TBA/date-only value into a local midnight.
  if (typeof value === 'string' && !/T\d{2}:\d{2}/i.test(value)) return null;
  return timestamp(value);
}

function clockMinutes(value) {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) return null;
  const [hour, minute] = value.split(':').map(Number);
  return hour < 24 && minute < 60 ? hour * 60 + minute : null;
}

function centralMinutes(value) {
  const parts = centralClock.formatToParts(new Date(value));
  return Number(parts.find(part => part.type === 'hour').value) * 60
    + Number(parts.find(part => part.type === 'minute').value);
}

/** Filter the supplied board in CT wall-clock time, retaining its ranks/order.
 * `next` includes all scheduled future starts. `live` follows the actual status.
 * Valid custom bounds intersect a preset; an overnight range wraps midnight.
 * Bounds are inclusive from / exclusive to. Equal bounds produce an empty range.
 * Invalid custom bounds are ignored, leaving the remaining valid filter active.
 */
export function filterByStartTime(games, {preset = 'all', from = '', to = '', now = Date.now()} = {}) {
  const rows = Array.isArray(games) ? games : [];
  const lower = clockMinutes(from), upper = clockMinutes(to);
  const clockPreset = ['morning', 'afternoon', 'evening'].includes(preset);
  const activeClock = clockPreset || lower !== null || upper !== null;
  const current = timestamp(now);
  return rows.filter(game => {
    if (!game) return !activeClock && preset !== 'next' && preset !== 'live';
    if (preset === 'live' && (game.status !== 'live' || game.completed || game.result?.status === 'completed')) return false;
    const start = startTimestamp(game.startTime);
    if (preset === 'next' && (game.status !== 'scheduled' || game.completed
      || game.result?.status === 'completed' || start === null || current === null || start <= current)) return false;
    if (!activeClock) return true;
    if (start === null) return false;
    const minute = centralMinutes(start);
    if (preset === 'morning' && minute >= 12 * 60) return false;
    if (preset === 'afternoon' && (minute < 12 * 60 || minute >= 17 * 60)) return false;
    if (preset === 'evening' && minute < 17 * 60) return false;
    if (lower !== null && upper !== null) {
      return lower > upper ? minute >= lower || minute < upper : minute >= lower && minute < upper;
    }
    return (lower === null || minute >= lower) && (upper === null || minute < upper);
  });
}

const scoreValue = value => finite(value) && value >= 0 ? value : null;
const detailValue = value => typeof value === 'string' && value.trim() ? value.trim()
  : finite(value) ? value : null;

/** Show only observed scores from the current game state. Missing live scores
 * never borrow final fields/placeholders. Saved result finals take precedence;
 * do not combine a partial saved final with a different score observation.
 * Freshness describes the observation, never a prediction about game outcome.
 */
export function liveScorePresentation(game = {}, {offline = false, refreshFailed = false, now = Date.now()} = {}) {
  const savedFinal = game?.result?.status === 'completed' ? game.result : null;
  const isFinal = Boolean(savedFinal || game?.completed || game?.status === 'completed');
  const isLive = !isFinal && game?.status === 'live';
  const savedHasScore = savedFinal && (scoreValue(savedFinal.awayScore) !== null || scoreValue(savedFinal.homeScore) !== null);
  const source = isFinal ? savedHasScore ? savedFinal : game : game;
  const awayScore = isFinal ? scoreValue(source?.awayScore) : isLive ? scoreValue(game.liveAwayScore) : null;
  const homeScore = isFinal ? scoreValue(source?.homeScore) : isLive ? scoreValue(game.liveHomeScore) : null;
  const hasScore = awayScore !== null || homeScore !== null;
  const updated = timestamp(isFinal ? source?.observedAt ?? source?.retrievedAt
    : game && Object.hasOwn(game, 'scoreObservedAt') ? game.scoreObservedAt : game?.retrievedAt);
  const current = timestamp(now);
  const fresh = updated !== null && current !== null && updated <= current && current - updated <= LIVE_FRESHNESS_MS;
  const freshness = !hasScore ? 'unavailable' : isFinal ? 'final'
    : offline || refreshFailed ? 'last-reported'
      : fresh ? 'live' : updated === null || current === null || updated > current ? 'last-reported' : 'stale';
  const label = {'live': 'Live score', 'last-reported': 'Last reported score', 'stale': 'Stale score', 'unavailable': 'Score unavailable', 'final': 'Final'}[freshness];
  const details = {};
  // Preserve actual supplied progress only; never invent or advance a clock.
  if (isLive || isFinal) for (const key of ['statusDescription', 'period', 'clock']) {
    const value = detailValue(source?.[key]);
    if (value !== null) details[key] = value;
  }
  return {kind: isFinal ? 'final' : isLive ? 'live' : 'none', awayScore, homeScore,
    hasScore, completeScore: awayScore !== null && homeScore !== null,
    freshness, label, updatedAt: updated === null ? null : new Date(updated).toISOString(), ...details};
}
