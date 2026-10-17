import {SPORT_PATHS, SPORT_LABELS} from './feeds/adapter.mjs';

/** Display helpers only. API ranking, prices, picks, and model math stay untouched. */
export const SUPPORTED_SPORTS = Object.freeze(Object.keys(SPORT_PATHS));
export const sportLabel = sport => SPORT_LABELS[sport] || sport.toUpperCase();
export function centralDay(value = Date.now()) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = key => parts.find(value => value.type === key)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function centralTime(value, includeDate = true) {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) return 'Time TBA';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', ...(includeDate ? { month: 'short', day: 'numeric' } : {}), hour: 'numeric', minute: '2-digit',
  }).format(date) + ' CT';
}
const startsFirst = (a, b) => Date.parse(a.startTime) - Date.parse(b.startTime) || String(a.sport).localeCompare(String(b.sport)) || String(a.id).localeCompare(String(b.id));
/** Each sport keeps its authoritative API rank. Never compare the magnitude of
 * a football/basketball point edge with a baseball run or hockey goal edge.
 * Among league leaders, start time determines presentation order only. */
export function featuredLeaders(slates, now = Date.now()) {
  const today = centralDay(now);
  const eligible = slates.flatMap(slate => (slate?.games || []).map(game => ({...game, sport: game.sport || slate.sport, boardOffline: !!slate.offlineSnapshot})))
    .filter(game => SUPPORTED_SPORTS.includes(game.sport) && game.status === 'scheduled' && !game.completed && Date.parse(game.startTime) > now
      && centralDay(game.startTime) === today && Number.isFinite(game.rank) && game.rank > 0 && Number.isFinite(game.edge) && game.edge > 0
      && ['home', 'away'].includes(game.side) && !game.stale && !game.lowEvidence && game.paperWager?.kind !== 'synthetic-winner-even');
  return SUPPORTED_SPORTS.flatMap(sport => {
    const leader = eligible.filter(game => game.sport === sport).sort((a, b) => a.rank - b.rank || startsFirst(a, b))[0];
    return leader ? [leader] : [];
  }).sort(startsFirst);
}
/** @param {Array<any>} slates @param {number} now @param {string|null} selectedSport */
export function featuredGame(slates, now = Date.now(), selectedSport = null) {
  const leaders = featuredLeaders(slates, now);
  return leaders.find(game => game.sport === selectedSport) || leaders[0] || null;
}
/** Keep each checked league separate. Empty leagues are hidden only after a
 * successful check; failed leagues remain explicit rather than looking empty. */
export function dailySportAvailability(slates, failedSports = []) {
  return SUPPORTED_SPORTS.map(sport => {
    const slate = slates.find(value => value?.sport === sport);
    return {sport, label: sportLabel(sport), count: slate?.games?.length ?? null,
      failed: failedSports.includes(sport), partial: !!(slate?.offlineSnapshot || slate?.partialLiveCoverage)};
  });
}
/** Outcome wording only: never infer settlement from a live scoreboard. */
export function visibleOutcome(decision, synthetic = false) {
  if (synthetic) return 'No ATS result · paper winner contract';
  return ({win:'Big Vin Wins.', loss:'Loss · Learn', push:'Push', void:'Void', pending:'Pending', 'no-line':'Ungraded · no spread', 'no-pick':'Ungraded · no pick'})[decision.outcome] || 'Ungraded';
}
export function validBoardDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
