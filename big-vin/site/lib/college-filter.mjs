/** College board filters. They only hide cards; ranks stay the full-board rank. */
export const COLLEGE_FILTERS = Object.freeze({all: 'All', top25: 'Top 25', major: 'Major Conferences'});
const MAJOR = new Set(['ACC', 'Big Ten', 'Big 12', 'SEC']);
const NOTRE_DAME = /^notre dame/i;
const majorSide = (conf, team) => MAJOR.has(conf) || NOTRE_DAME.test(team?.name || '');
const COLLEGE = new Set(['cfb', 'cbb']);
/** Only college cards are filtered; pro games always pass. */
export function filterCollege(games, mode) {
  if (mode !== 'top25' && mode !== 'major') return games;
  const pass = mode === 'top25' ? g => g.homeApRank || g.awayApRank : g => majorSide(g.homeConference, g.home) || majorSide(g.awayConference, g.away);
  return games.filter(g => (g.sport && !COLLEGE.has(g.sport)) || pass(g));
}
