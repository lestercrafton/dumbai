/** Match Big Vin picks to open Kalshi sports markets (public Trade API). */

export const KALSHI_BASE = 'https://api.elections.kalshi.com/trade-api/v2';
export const KALSHI_SITE = 'https://kalshi.com/markets';

/** Sport → Kalshi series for game winner / spread / total. */
export const SERIES_BY_SPORT = Object.freeze({
  nfl: { game: 'KXNFLGAME', spread: 'KXNFLSPREAD', total: 'KXNFLTOTAL' },
  cfb: { game: 'KXNCAAFGAME', spread: 'KXNCAAFSPREAD', total: 'KXNCAAFTOTAL' },
  nba: { game: 'KXNBAGAME', spread: 'KXNBASPREAD', total: 'KXNBATOTAL' },
  wnba: { game: 'KXWNBAGAME', spread: 'KXWNBASPREAD', total: 'KXWNBATOTAL' },
  cbb: { game: 'KXNCAAMBGAME', spread: 'KXNCAAMBSPREAD', total: 'KXNCAAMBTOTAL' },
  nhl: { game: 'KXNHLGAME', spread: 'KXNHLSPREAD', total: 'KXNHLTOTAL' },
  mlb: { game: 'KXMLBGAME', spread: 'KXMLBSPREAD', total: 'KXMLBTOTAL' },
});

const MASCOT = /\b(buccaneers?|bulldogs?|tigers?|wildcats?|eagles?|hawks?|bears?|lions?|panthers?|warriors?|knights?|cardinals?|rebels?|raiders?|aggies?|gators?|huskies|cougars?|spartans?|trojans?|bruins?|buckeyes?|sooners?|longhorns?|volunteers?|commodores?|razorbacks?|hogs|midshipmen|quakers?|keydets?|seawolves|pirates?|rams?|foxes?|hornets?|skyhawks?|sharks?|danes?|camels?|monarchs?|hurricanes?|huskies|mean\s+green|crimson\s+tide|fighting\s+irish|yellow\s+jackets?|demon\s+deacons?|wolfpack|mountaineers?|black\s+knights?|black\s+bears?|big\s+green|red\s+hawks?|redhawks?|golden\s+hurricane|golden\s+eagles?|blue\s+devils?|tar\s+heels?|seminoles?|gators?|nittany\s+lions?)\b/gi;
const FILLER = /\b(university|univ|the|of|college|football|basketball|baseball|hockey|men'?s|women'?s)\b/gi;

export function normalizeTeam(name) {
  if (typeof name !== 'string') return '';
  let s = name.normalize('NFKD').replace(/\p{M}/gu, '');
  s = s.toLowerCase().replace(/&/g, ' and ').replace(/['’]/g, '');
  s = s.replace(/\./g, ' ').replace(/[^a-z0-9\s()-]/g, ' ');
  s = s.replace(MASCOT, ' ').replace(FILLER, ' ');
  s = s.replace(/\bst\b/g, 'state');
  s = s.replace(/\s+/g, ' ').trim();
  // Keep short school names intact (army, navy, penn, yale, vmi, lsu, …).
  return s;
}

export function teamScore(a, b) {
  const na = normalizeTeam(a);
  const nb = normalizeTeam(b);
  if (!na || !nb) return 0;
  if (na === nb) return 100;
  if (na.length >= 3 && nb.length >= 3 && (na.includes(nb) || nb.includes(na))) return 85;
  const ta = new Set(na.split(' ').filter(Boolean));
  const tb = new Set(nb.split(' ').filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  if (!inter) return 0;
  return Math.round((100 * inter) / Math.max(ta.size, tb.size));
}

export function marketUrl(seriesTicker, eventTicker) {
  if (!seriesTicker || !eventTicker) return null;
  return `${KALSHI_SITE}/${String(seriesTicker).toLowerCase()}/${String(eventTicker).toLowerCase()}`;
}

export function groupEvents(markets) {
  const events = new Map();
  for (const m of markets || []) {
    const et = m?.event_ticker;
    if (!et) continue;
    let row = events.get(et);
    if (!row) {
      row = { eventTicker: et, seriesTicker: null, markets: [], labels: [] };
      events.set(et, row);
    }
    row.markets.push(m);
    const label = m.yes_sub_title || m.title || '';
    if (label && !row.labels.includes(label)) row.labels.push(label);
    if (!row.seriesTicker && et.includes('-')) row.seriesTicker = et.slice(0, et.indexOf('-'));
  }
  return [...events.values()];
}

/** Best event for a Big Vin home/away pair among Kalshi game-winner events. */
export function matchGameEvent(home, away, events, { minPair = 140 } = {}) {
  const homeName = home?.name || home || '';
  const awayName = away?.name || away || '';
  const homeAbbr = home?.abbreviation || '';
  const awayAbbr = away?.abbreviation || '';
  let best = null;
  for (const ev of events || []) {
    const labels = ev.labels?.length ? ev.labels : (ev.markets || []).map((m) => m.yes_sub_title).filter(Boolean);
    if (labels.length < 2) continue;
    // Try every pair of distinct labels (usually exactly two).
    for (let i = 0; i < labels.length; i++) {
      for (let j = 0; j < labels.length; j++) {
        if (i === j) continue;
        const sh = Math.max(teamScore(homeName, labels[i]), teamScore(homeAbbr, labels[i]));
        const sa = Math.max(teamScore(awayName, labels[j]), teamScore(awayAbbr, labels[j]));
        const pair = sh + sa;
        if (sh < 50 || sa < 50) continue;
        if (!best || pair > best.pair) best = { pair, event: ev, homeLabel: labels[i], awayLabel: labels[j] };
      }
    }
    // Abbreviation codes glued in the event ticker (…ARMYTLSA).
    if (homeAbbr && awayAbbr && typeof ev.eventTicker === 'string') {
      const code = ev.eventTicker.split('-').pop() || '';
      const up = code.toUpperCase();
      const ha = homeAbbr.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const aa = awayAbbr.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (ha.length >= 2 && aa.length >= 2 && up.includes(ha) && up.includes(aa)) {
        const pair = 160;
        if (!best || pair > best.pair) best = { pair, event: ev, homeLabel: labels[0], awayLabel: labels[1], via: 'abbr' };
      }
    }
  }
  if (!best || best.pair < minPair) return null;
  return best;
}

function parseSpreadOver(title) {
  // "Army wins by over 22.5 points"
  const m = String(title || '').match(/(.+?)\s+wins by over\s+([0-9]+(?:\.[0-9]+)?)/i);
  if (!m) return null;
  return { team: m[1].trim(), line: Number(m[2]) };
}

function parseTotalOver(title) {
  const m = String(title || '').match(/over\s+([0-9]+(?:\.[0-9]+)?)\s+points/i);
  return m ? Number(m[1]) : null;
}

/** Map a Big Vin spread pick to a Kalshi spread market when the line is clear. */
export function matchSpreadMarket(pick, gameEvent, spreadEvents) {
  if (!gameEvent || !Number.isFinite(pick?.line)) return null;
  // Favorite covering: negative line → "Team wins by over |line|"
  const abs = Math.abs(pick.line);
  const wantOver = abs; // Kalshi uses X.5 style "over X.5"
  const pickTeam = pick.pickName || pick.team || '';
  // Prefer spread events that share the game code suffix.
  const gameCode = (gameEvent.event.eventTicker || '').split('-').pop();
  const candidates = (spreadEvents || []).filter((ev) => {
    if (!gameCode) return true;
    return (ev.eventTicker || '').endsWith(gameCode) || (ev.eventTicker || '').includes(gameCode);
  });
  const pool = candidates.length ? candidates : spreadEvents || [];
  let best = null;
  for (const ev of pool) {
    for (const m of ev.markets || []) {
      const parsed = parseSpreadOver(m.title || m.yes_sub_title || '');
      if (!parsed || !Number.isFinite(parsed.line)) continue;
      if (Math.abs(parsed.line - wantOver) > 0.01 && Math.abs(parsed.line - (wantOver - 0.5)) > 0.01 && Math.abs(parsed.line - (wantOver + 0.5)) > 0.01) continue;
      const teamOk = teamScore(pickTeam, parsed.team) >= 60 || teamScore(pick.pickAbbr || '', parsed.team) >= 60;
      // Favorite (negative line) → YES on "pick wins by over". Underdog → NO on opponent cover.
      if (pick.line < 0 && !teamOk) continue;
      if (pick.line > 0) {
        // Underdog: market is usually favorite "wins by over"; we want NO.
        const againstPick = teamScore(pickTeam, parsed.team) < 50;
        if (!againstPick && !teamOk) continue;
        const side = againstPick || teamScore(pickTeam, parsed.team) < 50 ? 'no' : 'yes';
        const dist = Math.abs(parsed.line - wantOver);
        if (!best || dist < best.dist) best = { market: m, event: ev, side, dist, kind: 'spread' };
        continue;
      }
      if (pick.line === 0) continue;
      const dist = Math.abs(parsed.line - wantOver);
      if (!best || dist < best.dist) best = { market: m, event: ev, side: 'yes', dist, kind: 'spread' };
    }
  }
  return best;
}

export function matchMoneylineMarket(pick, gameEvent) {
  if (!gameEvent?.event) return null;
  const pickTeam = pick.pickName || pick.team || '';
  const pickAbbr = pick.pickAbbr || '';
  let best = null;
  for (const m of gameEvent.event.markets || []) {
    const label = m.yes_sub_title || m.title || '';
    const s = Math.max(teamScore(pickTeam, label), teamScore(pickAbbr, label));
    if (s < 60) continue;
    if (!best || s > best.score) best = { market: m, event: gameEvent.event, side: 'yes', score: s, kind: 'moneyline' };
  }
  return best;
}

export function matchTotalMarket(pick, gameEvent, totalEvents) {
  if (!Number.isFinite(pick?.totalLine) || !pick?.totalSide) return null;
  const gameCode = gameEvent?.event?.eventTicker?.split('-').pop();
  const pool = (totalEvents || []).filter((ev) => !gameCode || (ev.eventTicker || '').includes(gameCode));
  let best = null;
  for (const ev of pool.length ? pool : totalEvents || []) {
    for (const m of ev.markets || []) {
      const over = parseTotalOver(m.title || m.yes_sub_title || '');
      if (!Number.isFinite(over)) continue;
      if (Math.abs(over - pick.totalLine) > 0.01 && Math.abs(over - (pick.totalLine - 0.5)) > 0.01) continue;
      const dist = Math.abs(over - pick.totalLine);
      const side = pick.totalSide === 'over' ? 'yes' : 'no';
      if (!best || dist < best.dist) best = { market: m, event: ev, side, dist, kind: 'total' };
    }
  }
  return best;
}

/**
 * @param {object} pick
 * @param {{ game: object[], spread: object[], total: object[] }} catalogs - grouped events per series kind
 */
export function matchPick(pick, catalogs) {
  const sport = pick?.sport;
  const series = SERIES_BY_SPORT[sport];
  if (!series) return { matched: false, reason: 'unsupported-sport' };
  const gameMatch = matchGameEvent(pick.home, pick.away, catalogs.game || []);
  if (!gameMatch) return { matched: false, reason: 'no-game' };

  const moneyline = sport === 'mlb' || pick.market === 'ml' || pick.line == null;
  let hit = null;
  if (moneyline) hit = matchMoneylineMarket(pick, gameMatch);
  else hit = matchSpreadMarket(pick, gameMatch, catalogs.spread || []) || matchMoneylineMarket(pick, gameMatch);

  // Always can deep-link the game event even without a precise contract.
  const fallbackUrl = marketUrl(gameMatch.event.seriesTicker || series.game, gameMatch.event.eventTicker);
  if (!hit) {
    return {
      matched: true,
      kind: 'game',
      side: null,
      eventTicker: gameMatch.event.eventTicker,
      marketTicker: null,
      title: `${gameMatch.homeLabel} vs ${gameMatch.awayLabel}`,
      url: fallbackUrl,
      placeable: false,
    };
  }
  const seriesTicker = hit.event.seriesTicker || (hit.market.event_ticker || '').split('-')[0] || series.game;
  return {
    matched: true,
    kind: hit.kind,
    side: hit.side,
    eventTicker: hit.event.eventTicker || hit.market.event_ticker,
    marketTicker: hit.market.ticker,
    title: hit.market.title || hit.market.yes_sub_title,
    url: marketUrl(seriesTicker, hit.event.eventTicker || hit.market.event_ticker),
    placeable: hit.side === 'yes' || hit.side === 'no',
    yesAsk: hit.market.yes_ask_dollars || hit.market.yes_ask || null,
    noAsk: hit.market.no_ask_dollars || hit.market.no_ask || null,
  };
}

export function matchPicks(picks, catalogsBySport) {
  const out = {};
  let matched = 0;
  for (const p of picks || []) {
    const cat = catalogsBySport[p.sport] || { game: [], spread: [], total: [] };
    const m = matchPick(p, cat);
    out[p.id] = m;
    if (m.matched) matched++;
  }
  return { matches: out, matched, total: (picks || []).length };
}
