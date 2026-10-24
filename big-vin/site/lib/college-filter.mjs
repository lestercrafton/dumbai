/** College board filters. Narrowed modes re-rank within the visible set. */
export const COLLEGE_FILTERS = Object.freeze({
  all: 'All college',
  fbs: 'FBS',
  fcs: 'FCS',
  top25: 'Top 25',
  major: 'Power conferences',
});
/** Short hint for the Power conferences chip (SEC/B1G/Big 12/ACC + ND). */
export const COLLEGE_FILTER_HINTS = Object.freeze({
  all: 'Every college game on this board',
  fbs: 'ESPN FBS (group 80)',
  fcs: 'ESPN FCS (group 81)',
  top25: 'Either side ranked in the AP Top 25',
  major: 'SEC, Big Ten, Big 12, ACC, and Notre Dame',
});
const MAJOR = new Set(['ACC', 'Big Ten', 'Big 12', 'SEC']);
const NOTRE_DAME = /^notre dame/i;
const COLLEGE = new Set(['cfb', 'cbb']);
const majorSide = (conf, team) => MAJOR.has(conf) || NOTRE_DAME.test(team?.name || '');

/** ESPN scoreboard group from a game's source URL (80 FBS, 81 FCS). */
export function espnCollegeGroup(game = {}) {
  const direct = game.sourceGroup != null ? String(game.sourceGroup) : null;
  if (direct === '80' || direct === '81') return direct;
  const url = String(game.sourceUrl || '');
  const m = url.match(/[?&]groups=(\d+)/);
  return m && (m[1] === '80' || m[1] === '81') ? m[1] : null;
}

/** Filters available for the current sport tab (FBS/FCS only on CFB/all). */
export function collegeFiltersFor(sport) {
  if (sport === 'cbb') {
    const {all, top25, major} = COLLEGE_FILTERS;
    return {all, top25, major};
  }
  if (sport === 'cfb' || sport === 'all') return {...COLLEGE_FILTERS};
  return {all: COLLEGE_FILTERS.all};
}

const passMode = {
  all: () => true,
  fbs: g => espnCollegeGroup(g) === '80',
  fcs: g => espnCollegeGroup(g) === '81',
  top25: g => !!(g.homeApRank || g.awayApRank),
  major: g => majorSide(g.homeConference, g.home) || majorSide(g.awayConference, g.away),
};

/** Only college cards are filtered; pro games always pass. */
export function filterCollege(games, mode) {
  const pass = passMode[mode];
  if (!pass || mode === 'all') return games;
  return games.filter(g => (g.sport && !COLLEGE.has(g.sport)) || pass(g));
}

/** Re-number ranks 1…n inside a narrowed college filter; keep full-board ranks on All. */
export function rankWithinCollegeFilter(games, mode = 'all') {
  const rows = filterCollege(games, mode);
  if (!mode || mode === 'all') return rows;
  const ordered = [...rows].sort((a, b) => {
    if (a.rank == null && b.rank == null) return 0;
    if (a.rank == null) return 1;
    if (b.rank == null) return -1;
    return a.rank - b.rank || String(a.id).localeCompare(String(b.id));
  });
  const next = new Map();
  let n = 0;
  for (const g of ordered) if (g.rank != null) next.set(g.id, ++n);
  return rows.map(g => next.has(g.id) ? {...g, boardRank: g.rank, rank: next.get(g.id)} : g);
}
