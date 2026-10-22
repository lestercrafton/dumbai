/** College board filters. They only hide cards; ranks stay the full-board rank. */
export const COLLEGE_FILTERS = Object.freeze({all: 'All', top25: 'Top 25', major: 'Major Conferences'});
const MAJOR = new Set(['ACC', 'Big Ten', 'Big 12', 'SEC']);
const NOTRE_DAME = /^notre dame/i;
const majorSide = (conf, team) => MAJOR.has(conf) || NOTRE_DAME.test(team?.name || '');
export function filterCollege(games, mode) {
  if (mode === 'top25') return games.filter(g => g.homeApRank || g.awayApRank);
  if (mode === 'major') return games.filter(g => majorSide(g.homeConference, g.home) || majorSide(g.awayConference, g.away));
  return games;
}
