const paths = Object.freeze({nfl:'nfl',cfb:'college-football',nba:'nba',wnba:'wnba',cbb:'mens-college-basketball',nhl:'nhl',mlb:'mlb'});
const espnSources = new Set(['ESPN scoreboard','SportsDataverse hoopR ESPN schedule archive']);

/** Keep the provider's exact matchup URL when supplied. Older ESPN rows may
 * use the same verified event route without its optional matchup slug.
 * IDs from MLB StatsAPI or nflverse are not ESPN event identities.
 */
export function espnGamecastUrl(game = {}, sport = game?.sport) {
  const path = paths[sport], id = String(game?.id ?? '');
  if (!path || !/^\d+$/.test(id)) return null;
  const prefix = `/${path}/game/_/gameId/${id}`;
  const validate = href => {
    try {
      const url = new URL(href);
      if (!['http:','https:'].includes(url.protocol) || !['www.espn.com','espn.com'].includes(url.hostname)
        || url.port || url.username || url.password || !(url.pathname === prefix || url.pathname.startsWith(prefix + '/'))) return null;
      url.protocol = 'https:';
      return url.href;
    } catch { return null; }
  };
  const preserved = validate(game?.gamecastUrl);
  if (preserved) return preserved;
  const links = (Array.isArray(game?.links) ? game.links : [])
    .filter(link => Array.isArray(link?.rel) && link.rel.includes('summary') && link.rel.includes('event'))
    .sort((a,b) => Number(b.rel.includes('desktop')) - Number(a.rel.includes('desktop')));
  for (const link of links) {
    const url = validate(link.href);
    if (url) return url;
  }
  return espnSources.has(game?.source) ? `https://www.espn.com${prefix}` : null;
}
