import {handicap, spreadDecision} from './spread-display.mjs';

const CENTRAL_ZONE = 'America/Chicago';
const dayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: CENTRAL_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
});
const timeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: CENTRAL_ZONE, month: 'short', day: 'numeric',
  hour: 'numeric', minute: '2-digit', hour12: true,
});
const clockFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: CENTRAL_ZONE, hour: 'numeric', minute: '2-digit', hour12: true,
});
const finite = value => typeof value === 'number' && Number.isFinite(value);

function validDate(value) {
  if (!(value instanceof Date) && !['number', 'string'].includes(typeof value)) return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const date = new Date(value instanceof Date ? value.getTime() : value);
  return Number.isFinite(date.getTime()) ? date : null;
}

/** Presentation dates only. ESPN/API sports days remain Eastern. */
export function centralDay(value = Date.now()) {
  const date = validDate(value);
  if (!date) return null;
  const parts = dayFormatter.formatToParts(date);
  const part = name => parts.find(item => item.type === name)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function formatCentralTime(value) {
  const date = validDate(value);
  return date ? `${timeFormatter.format(date)} CT` : 'Time TBA';
}

export function formatCentralClock(value) {
  const date = validDate(value);
  return date ? `${clockFormatter.format(date)} CT` : 'Time TBA';
}

/** Choose an upcoming CT-today pick using server edges, without changing ranks.
 * Repeated sport/event IDs keep the first supplied observation.
 */
export function selectTodayEdge(slates, now = Date.now()) {
  const current = validDate(now);
  if (!current) return null;
  const today = centralDay(current);
  const observed = new Map();
  for (const slate of Array.isArray(slates) ? slates : []) {
    for (const game of Array.isArray(slate?.games) ? slate.games : []) {
      if (!game || game.id == null) continue;
      const sport = game.sport || slate.sport;
      if (!sport) continue;
      const key = `${sport}:${game.id}`;
      if (!observed.has(key)) observed.set(key, game.sport ? game : {...game, sport});
    }
  }
  const candidates = [...observed.values()].filter(game => {
    const kickoff = validDate(game.startTime);
    return finite(game.edge) && game.edge > 0
      && (game.side === 'home' || game.side === 'away')
      && finite(game.rank) && game.rank > 0
      && !game.stale && !game.lowEvidence
      && game.status === 'scheduled' && !game.completed
      && game.paperWager?.kind !== 'synthetic-winner-even'
      && kickoff && kickoff.getTime() > current.getTime()
      && centralDay(kickoff) === today;
  });
  candidates.sort((a, b) => b.edge - a.edge
    || Date.parse(a.startTime) - Date.parse(b.startTime)
    || String(a.sport).localeCompare(String(b.sport))
    || String(a.id).localeCompare(String(b.id)));
  return candidates[0] || null;
}

const shortName = team => typeof team === 'string' ? team : team?.abbreviation || team?.name || 'Team';
const fullName = team => typeof team === 'string' ? team : team?.name || shortName(team);
const perspective = (value, side) => {
  if (!finite(value)) return null;
  const line = side === 'away' ? -value : value;
  return line === 0 ? 0 : line;
};

/** Both numbers describe the selected team; no selection uses home perspective.
 * An explicit null side stays unpicked, and no edge is recalculated here.
 */
export function displayLines(game = {}) {
  const decision = spreadDecision(game);
  const synthetic = game.paperWager?.kind === 'synthetic-winner-even';
  const side = !synthetic && game.side !== null
    && (decision.side === 'home' || decision.side === 'away') ? decision.side : null;
  const team = game[side || 'home'];
  const teamName = fullName(team);
  const teamShort = shortName(team);
  const homeMarket = synthetic ? null
    : game.paperWager?.kind === 'archived-opening-spread' ? game.paperWager.homeSpread
      : game.marketHomeSpread ?? game.market?.homeSpread;
  const margin = game.predictedMargin ?? game.projection?.predictedHomeMargin;
  const homeFair = finite(game.projection?.fairHomeSpread) ? game.projection.fairHomeSpread
    : finite(margin) ? -margin : null;
  const marketLine = perspective(homeMarket, side);
  const fairLine = perspective(homeFair, side);
  const edge = !synthetic && finite(game.edge) ? game.edge : null;
  const pick = side && marketLine !== null && decision.pick
    ? `${teamShort} ${handicap(marketLine)}` : null;
  return {side, teamName, teamShort, marketLine, fairLine, edge, pick};
}
