/** Board ordering and conference filtering. Rank numbers are assigned by the
  * server from the model chance to win and never change with these views;
 * sorting only changes the order games are listed in. */
const startMs = (g) => {
  const ms = Date.parse(g.startTime || '');
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
};
const byTime = (a, b) => startMs(a) - startMs(b) || String(a.id).localeCompare(String(b.id));
const byRank = (a, b) => (a.rank ?? Number.POSITIVE_INFINITY) - (b.rank ?? Number.POSITIVE_INFINITY) || byTime(a, b);
export const SORT_MODES = Object.freeze({
  rank: 'Rank order',
  time: 'Kickoff time',
  'rank-time': 'Rank, then time',
});
export function sortBoard(games, mode = 'rank') {
  const rows = [...games];
  if (mode === 'time') return rows.sort(byTime);
  if (mode === 'rank-time') return rows.sort((a, b) => (a.rank ? 0 : 1) - (b.rank ? 0 : 1) || byRank(a, b));
  return rows.sort(byRank);
}
export function boardConferences(games) {
  return [...new Set(games.flatMap((g) => g.conferences || []))].sort((a, b) => a.localeCompare(b));
}
export function filterByConference(games, conference) {
  if (!conference || conference === 'all') return games;
  return games.filter((g) => (g.conferences || []).includes(conference));
}
