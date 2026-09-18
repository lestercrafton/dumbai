/**
 * Keyless ESPN presentation API + SportsDataverse archive adapters.
 * ESPN is undocumented and best effort: no published service contract or quota.
 * Cache on the server, identify source and retrieval time, and preserve nulls.
 */
export const SPORT_PATHS = Object.freeze({
  nfl: 'football/nfl', cfb: 'football/college-football',
  nba: 'basketball/nba', wnba: 'basketball/wnba', cbb: 'basketball/mens-college-basketball',
  nhl: 'hockey/nhl', mlb: 'baseball/mlb',
});
export const SPORT_LABELS = { nfl: 'NFL', cfb: 'College football', nba: 'NBA', wnba: 'WNBA', cbb: "Men's college basketball", nhl: 'NHL', mlb: 'MLB' };
const num = x => {
  if (!['number', 'string'].includes(typeof x) || typeof x === 'string' && !x.trim()) return null;
  const n = Number(x); return Number.isFinite(n) ? n : null;
};
const score = x => { const n = num(x); return n !== null && n >= 0 ? n : null; };
const isoDate = x => {
  if (!x) return null;
  const date = new Date(x);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};
function normalizedStatus(status = {}) {
  const label = `${status.name ?? ''} ${status.description ?? ''}`;
  if (/cancel/i.test(label)) return 'cancelled';
  if (/postpon/i.test(label)) return 'postponed';
  if (/suspend/i.test(label)) return 'suspended';
  if (/delay/i.test(label)) return 'delayed';
  if (status.state === 'in') return 'live';
  if (status.completed === true && status.state !== 'pre') return 'completed';
  return 'scheduled';
}
const line = x => {
  if (typeof x === 'number') return num(x);
  if (typeof x !== 'string') return null;
  const text = x.trim().replace(/^([ou])(?=[+-]?\d)/i, '');
  if (/^(pk|pick|pickem|even)$/i.test(text)) return 0;
  return /^[+-]?\d+(\.\d+)?$/.test(text) ? num(text) : null;
};
const price = x => {
  if (typeof x === 'string' && /^even$/i.test(x.trim())) return 100;
  const n = num(x);
  return n !== null && Number.isInteger(n) && Math.abs(n) >= 100 ? n : null;
};
export function canonicalTeamKey(sport, abbreviation, id = '') {
  const aliases = {
    nfl: { LA: 'LAR', OAK: 'LV', SD: 'LAC', STL: 'LAR' },
    mlb: { AZ: 'ARI', CHW: 'CWS', KCR: 'KC', SDP: 'SD', SFG: 'SF', TBR: 'TB', WSN: 'WSH', OAK: 'ATH' },
    nba: { GSW: 'GS', NYK: 'NY', NOP: 'NO', SAS: 'SA', UTA: 'UTAH', WAS: 'WSH' },
    nhl: { LAK: 'LA', NJD: 'NJ', SJS: 'SJ', TBL: 'TB', WSH: 'WSH' },
  };
  // College abbreviations are not unique. ESPN IDs are shared by hoopR.
  if (sport === 'cfb' || sport === 'cbb') return `${sport}:espn:${id}`;
  const abbr = String(abbreviation ?? '').toUpperCase();
  return `${sport}:${aliases[sport]?.[abbr] ?? (abbr || id)}`;
}
const team = (x, sport) => ({ id: String(x?.id ?? ''), key: canonicalTeamKey(sport, x?.abbreviation, x?.id), abbreviation: x?.abbreviation ?? null, name: x?.displayName ?? x?.shortDisplayName ?? x?.name ?? null });

/** @param {string} sport @param {{startDate?:string,endDate?:string,limit?:number,group?:number}} options */
export function scoreboardUrl(sport, { startDate, endDate, limit = 1000, group = 80 } = {}) {
  if (!SPORT_PATHS[sport]) throw new Error(`Unsupported sport: ${sport}`);
  if (sport === 'cbb' && startDate && endDate && startDate !== endDate) {
    throw new Error('ESPN CBB date ranges returned empty in live verification. Use one date or hoopR season archives.');
  }
  const url = new URL(`https://site.api.espn.com/apis/site/v2/sports/${SPORT_PATHS[sport]}/scoreboard`);
  url.searchParams.set('limit', String(limit));
  if (startDate) {
    const compact = value => String(value).slice(0, 10).replaceAll('-', '');
    // CFB single-date requests returned only 25 of 80 games on September 12, 2026.
    // An explicit same-day range returned the complete verified FBS card.
    url.searchParams.set('dates', sport==='cfb' ? `${compact(startDate)}-${compact(endDate||startDate)}` : endDate && endDate !== startDate ? `${compact(startDate)}-${compact(endDate)}` : compact(startDate));
  }
  if (sport === 'cfb') url.searchParams.set('groups', String(group)); // FBS (80) or FCS (81), deduplicated by event ID
  if (sport === 'cbb') url.searchParams.set('groups', '50'); // All Division I, not only ranked teams
  return url.toString();
}

function normalizeOdds(o, completed, retrievedAt) {
  let homeSpread = line(o?.pointSpread?.home?.close?.line);
  let awaySpread = line(o?.pointSpread?.away?.close?.line);
  let spreadMethod = homeSpread !== null ? 'explicit-home-point-spread' : null;
  const spreadConflict = homeSpread !== null && awaySpread !== null && Math.abs(homeSpread + awaySpread) > 1e-9;
  if (spreadConflict) { homeSpread = null; awaySpread = null; spreadMethod = 'conflicting-explicit-point-spreads'; }
  if (homeSpread === null && awaySpread !== null) { homeSpread = -awaySpread; spreadMethod = 'opposite-explicit-away-point-spread'; }
  // The legacy generic spread does not reliably specify the side. Only use a
  // numeric magnitude when favorite flags identify which team gives points.
  if (!spreadConflict && homeSpread === null && num(o?.spread) !== null) {
    if (num(o.spread) === 0) { homeSpread = 0; spreadMethod = 'explicit-pick'; }
    else if (o?.homeTeamOdds?.favorite === true && o?.awayTeamOdds?.favorite !== true) { homeSpread = -Math.abs(num(o.spread)); spreadMethod = 'legacy-home-favorite'; }
    else if (o?.awayTeamOdds?.favorite === true && o?.homeTeamOdds?.favorite !== true) { homeSpread = Math.abs(num(o.spread)); spreadMethod = 'legacy-away-favorite'; }
  }
  if (awaySpread === null && homeSpread !== null) awaySpread = -homeSpread;
  const overTotal = line(o?.total?.over?.close?.line), underTotal = line(o?.total?.under?.close?.line);
  const totalConflict = overTotal !== null && underTotal !== null && Math.abs(overTotal - underTotal) > 1e-9;
  const candidateTotal = totalConflict ? null : overTotal ?? underTotal ?? num(o?.overUnder);
  const total = candidateTotal !== null && candidateTotal > 0 ? candidateTotal : null;
  const market = {
    provider: o?.provider?.displayName ?? o?.provider?.name ?? 'ESPN odds provider',
    providerId: String(o?.provider?.id ?? ''),
    observedAt: retrievedAt,
    providerUpdatedAt: o?.lastUpdated ?? o?.lastUpdate ?? null,
    timing: completed ? 'historical-display-time-unverified' : 'current-displayed-snapshot',
    homeSpread, awaySpread, homeExpectedMargin: homeSpread === null ? null : -homeSpread,
    spreadMethod, totalMethod: totalConflict ? 'conflicting-explicit-totals' : total !== null ? 'provider-total' : null,
    homeSpreadPrice: price(o?.pointSpread?.home?.close?.odds),
    awaySpreadPrice: price(o?.pointSpread?.away?.close?.odds),
    total, overPrice: price(o?.total?.over?.close?.odds), underPrice: price(o?.total?.under?.close?.odds),
    homeMoneyline: price(o?.moneyline?.home?.close?.odds) ?? price(o?.homeTeamOdds?.moneyLine),
    awayMoneyline: price(o?.moneyline?.away?.close?.odds) ?? price(o?.awayTeamOdds?.moneyLine),
    openHomeSpread: line(o?.pointSpread?.home?.open?.line),
    openTotal: line(o?.total?.over?.open?.line),
  };
  return market.homeSpread !== null || market.total !== null || market.homeMoneyline !== null || market.awayMoneyline !== null ? market : null;
}

export function normalizeScoreboard(payload, sport, { retrievedAt = new Date().toISOString(), sourceUrl = scoreboardUrl(sport), requestedLimit = 1000 } = {}) {
  const warnings = ['ESPN is an undocumented presentation API; completeness and availability are not guaranteed.'];
  const rawEvents = Array.isArray(payload?.events) ? payload.events : [];
  if (rawEvents.length >= requestedLimit) warnings.push('Response reached requested limit; range may be truncated.');
  if (sport === 'cfb' || sport === 'cbb') warnings.push('College group filtering and provider caps can omit games; a below-limit result alone does not prove full coverage.');
  const games = rawEvents.flatMap(event => {
    const competition = event?.competitions?.[0];
    const home = competition?.competitors?.find(x => x.homeAway === 'home');
    const away = competition?.competitors?.find(x => x.homeAway === 'away');
    if (!home?.team || !away?.team) return [];
    const startTime = isoDate(event.date);
    if (event.date && startTime === null) { warnings.push(`Quarantined event ${event.id ?? 'unknown'} with an invalid start date.`); return []; }
    const status = {...competition.status?.type, ...event.status?.type};
    const gameStatus = normalizedStatus(status);
    const completed = gameStatus === 'completed';
    const seasonType=event.season?.type ?? payload.season?.type ?? null;
    const exhibition=sport==='wnba'&&(seasonType===1||seasonType===4||/ALLSTAR|EXHIBITION/i.test(competition.type?.abbreviation||'')||/all[ -]?star|team (?:usa|wnba)/i.test([event.name,event.shortName,home.team.displayName,away.team.displayName].join(' ')));
    const standaloneCup=sport==='wnba'&&/Commissioner.*Cup Championship/i.test((competition.notes||[]).map(n=>n.headline||'').join(' '));
    const modelExcludedReason=exhibition?'Exhibition excluded':standaloneCup?'Standalone Cup final excluded':null;
    // ESPN supplies zero placeholders for future events. Never train on these.
    const homeScore = completed ? score(home.score) : null;
    const awayScore = completed ? score(away.score) : null;
    const markets = (Array.isArray(competition.odds) ? competition.odds : []).map(o => normalizeOdds(o, completed, retrievedAt)).filter(Boolean);
    return [{
      id: String(event.id), sport, sportLabel: SPORT_LABELS[sport],
      season: event.season?.year ?? payload.season?.year ?? payload.leagues?.[0]?.season?.year ?? null,
      seasonType, exhibition, modelExcludedReason,
      week: event.week?.number ?? payload.week?.number ?? null,
      startTime,
      status: gameStatus,
      statusDescription: status.description ?? status.detail ?? null,
      completed, home: team(home.team, sport), away: team(away.team, sport),
      liveHomeScore: gameStatus==='live'?score(home.score):null, liveAwayScore: gameStatus==='live'?score(away.score):null,
      homeScore, awayScore,
      homeMargin: homeScore !== null && awayScore !== null ? homeScore - awayScore : null,
      totalScore: homeScore !== null && awayScore !== null ? homeScore + awayScore : null,
      neutralSite: typeof competition.neutralSite === 'boolean' ? competition.neutralSite : null,
      venue: competition.venue?.fullName ?? null,
      markets, market: markets[0] ?? null,
      source: 'ESPN scoreboard', sourceUrl, retrievedAt,
    }];
  });
  return { sport, retrievedAt, sourceUrl, rawEventCount: rawEvents.length, gameCount: games.length, completeness: 'unverified', warnings, games };
}

export async function fetchScoreboard(sport, options = {}, fetchImpl = globalThis.fetch) {
  const sourceUrls = scoreboardUrls(sport, options);
  const boards = await Promise.all(sourceUrls.map(async sourceUrl=>{
    const response=await fetchImpl(sourceUrl,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error(`ESPN ${sport} HTTP ${response.status}`);
    return normalizeScoreboard(await response.json(),sport,{sourceUrl,requestedLimit:options.limit??1000});
  }));
  const games=[...new Map(boards.flatMap(b=>b.games).map(g=>[g.id,g])).values()];
  return {...boards[0],sourceUrls,games,gameCount:games.length,warnings:[...new Set(boards.flatMap(b=>b.warnings))]};
}

export function hooprArchiveUrl(sport, season) {
  if (!['nba', 'cbb'].includes(sport)) throw new Error('hoopR schedules cover NBA and men’s college basketball');
  if (!Number.isInteger(season) || season < 2002) throw new Error('Use a season END year >= 2002');
  const prefix = sport === 'nba' ? 'nba' : 'mbb';
  const release = sport === 'nba' ? 'espn_nba_schedules' : 'espn_mens_college_basketball_schedules';
  return `https://github.com/sportsdataverse/sportsdataverse-data/releases/download/${release}/${prefix}_schedule_${season}.csv`;
}

// RFC-style CSV reader: quoted commas, line breaks and doubled quotes preserved.
export function parseCsv(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (c === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); if (row.some(Boolean)) rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (quoted) throw new Error('Truncated CSV: unterminated quote');
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const header = rows.shift() ?? [];
  return rows.map(values => Object.fromEntries(header.map((key, index) => [key.replace(/^\uFEFF/, ''), values[index] ?? ''])));
}

export function normalizeHooprCsv(text, sport, season, { retrievedAt = new Date().toISOString() } = {}) {
  const sourceUrl = hooprArchiveUrl(sport, season);
  const bool = x => x === true || String(x).toLowerCase() === 'true';
  const warnings = ['Schedule archives contain scores and venues; no historical odds are manufactured. Season denotes ending year.'];
  const games = parseCsv(text).flatMap(row => {
    const startTime = isoDate(row.date);
    if (row.date && startTime === null) { warnings.push(`Quarantined archive event ${row.id || row.game_id || 'unknown'} with an invalid start date.`); return []; }
    const gameStatus = normalizedStatus({completed:bool(row.status_type_completed),state:row.status_type_state,name:row.status_type_name,description:row.status_type_description});
    const completed = gameStatus === 'completed';
    const homeScore = completed ? score(row.home_score) : null;
    const awayScore = completed ? score(row.away_score) : null;
    return [{
      id: String(row.id || row.game_id), sport, sportLabel: SPORT_LABELS[sport],
      season: num(row.season) ?? season, seasonType: num(row.season_type), week: null,
      startTime,
      status: gameStatus,
      statusDescription: row.status_type_description || null, completed,
      home: { id: row.home_id, key: canonicalTeamKey(sport, row.home_abbreviation, row.home_id), abbreviation: row.home_abbreviation || null, name: row.home_display_name || row.home_name || null },
      away: { id: row.away_id, key: canonicalTeamKey(sport, row.away_abbreviation, row.away_id), abbreviation: row.away_abbreviation || null, name: row.away_display_name || row.away_name || null },
      homeScore, awayScore,
      homeMargin: homeScore !== null && awayScore !== null ? homeScore - awayScore : null,
      totalScore: homeScore !== null && awayScore !== null ? homeScore + awayScore : null,
      neutralSite: row.neutral_site ? bool(row.neutral_site) : null,
      venue: row.venue_full_name || null, markets: [], market: null,
      source: 'SportsDataverse hoopR ESPN schedule archive', sourceUrl, retrievedAt,
    }];
  });
  return { sport, season, retrievedAt, sourceUrl, gameCount: games.length, completeness: 'provider-season-archive', warnings, games };
}

export function mlbScheduleUrl(startDate, endDate) {
  const url = new URL('https://statsapi.mlb.com/api/v1/schedule');
  url.searchParams.set('sportId', '1');
  url.searchParams.set('startDate', startDate);
  url.searchParams.set('endDate', endDate);
  url.searchParams.set('hydrate', 'team');
  return url.toString();
}

export function normalizeMlbSchedule(payload, { retrievedAt = new Date().toISOString(), sourceUrl = null } = {}) {
  const warnings = ['MLB StatsAPI is a public league endpoint; no historical market odds are supplied. Team IDs differ from ESPN; join using team.key.'];
  const games = (payload.dates ?? []).flatMap(date => (date.games ?? []).flatMap(game => {
    const startTime = isoDate(game.gameDate);
    if (game.gameDate && startTime === null) { warnings.push(`Quarantined MLB game ${game.gamePk ?? 'unknown'} with an invalid start date.`); return []; }
    const gameStatus = normalizedStatus({
      completed:game.status?.abstractGameState === 'Final',
      state:game.status?.abstractGameState === 'Live' ? 'in' : game.status?.abstractGameState === 'Final' ? 'post' : 'pre',
      description:game.status?.detailedState,
    });
    const completed = gameStatus === 'completed';
    const homeScore = completed ? score(game.teams?.home?.score) : null;
    const awayScore = completed ? score(game.teams?.away?.score) : null;
    return [{
      id: `mlb:${game.gamePk}`, sport: 'mlb', sportLabel: 'MLB', season: num(game.season),
      seasonType: game.gameType, week: null, startTime,
      status: gameStatus,
      statusDescription: game.status?.detailedState ?? null, completed,
      home: team(game.teams?.home?.team, 'mlb'), away: team(game.teams?.away?.team, 'mlb'),
      homeScore, awayScore, homeMargin: homeScore !== null && awayScore !== null ? homeScore - awayScore : null,
      totalScore: homeScore !== null && awayScore !== null ? homeScore + awayScore : null,
      neutralSite: typeof game.neutralSite === 'boolean' ? game.neutralSite : null,
      venue: game.venue?.name ?? null, markets: [], market: null,
      source: 'MLB StatsAPI schedule', sourceUrl, retrievedAt,
    }];
  }));
  return { sport: 'mlb', retrievedAt, sourceUrl, gameCount: games.length, reportedTotal: payload.totalGames ?? null, completeness: games.length === payload.totalGames ? 'reported-count-matched' : 'unverified', warnings, games };
}

export function scoreboardUrls(sport,options={}){
 if(sport==='wnba'&&options.startDate&&options.endDate&&options.startDate!==options.endDate){
  const start=Date.parse(options.startDate+'T00:00:00Z'),end=Date.parse(options.endDate+'T00:00:00Z');
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<start||end-start>30*86400000)throw new Error('WNBA scoreboard windows must be at most 31 days.');
  return Array.from({length:(end-start)/86400000+1},(_,i)=>scoreboardUrl(sport,{...options,startDate:new Date(start+i*86400000).toISOString().slice(0,10),endDate:undefined}));
 }
 return sport==='cfb'?[80,81].map(group=>scoreboardUrl(sport,{...options,group})):[scoreboardUrl(sport,options)];
}
