/** Kalshi Trade API helpers (public reads + signed portfolio calls). */
import {KALSHI_BASE, SERIES_BY_SPORT, groupEvents} from './kalshi-match.mjs';
import {signKalshiRequest, importKalshiPrivateKey} from './kalshi-crypto.mjs';

const UA = 'BigVin/1.0 (my-bankroll; entertainment)';
const cache = new Map(); // key → {at, value}
const CACHE_MS = 90_000;

async function publicGet(path) {
  const url = KALSHI_BASE + path;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA } });
  if (!res.ok) throw new Error(`kalshi ${res.status}`);
  const json = await res.json();
  cache.set(url, { at: Date.now(), value: json });
  return json;
}

/** Paginate open markets for a series ticker. */
export async function fetchOpenMarkets(seriesTicker, { maxPages = 6 } = {}) {
  if (!seriesTicker) return [];
  const markets = [];
  let cursor = '';
  for (let page = 0; page < maxPages; page++) {
    const q = `/markets?series_ticker=${encodeURIComponent(seriesTicker)}&status=open&limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const data = await publicGet(q);
    const batch = data.markets || [];
    markets.push(...batch);
    cursor = data.cursor || '';
    if (!cursor || !batch.length) break;
  }
  return markets;
}

export async function loadSportCatalog(sport) {
  const series = SERIES_BY_SPORT[sport];
  if (!series) return { game: [], spread: [], total: [] };
  const [gameM, spreadM, totalM] = await Promise.all([
    fetchOpenMarkets(series.game).catch(() => []),
    series.spread ? fetchOpenMarkets(series.spread).catch(() => []) : Promise.resolve([]),
    series.total ? fetchOpenMarkets(series.total).catch(() => []) : Promise.resolve([]),
  ]);
  return {
    game: groupEvents(gameM),
    spread: groupEvents(spreadM),
    total: groupEvents(totalM),
  };
}

export async function loadCatalogs(sports) {
  const out = {};
  await Promise.all((sports || []).map(async (sport) => {
    out[sport] = await loadSportCatalog(sport);
  }));
  return out;
}

async function signedFetch({ method, path, body, apiKeyId, privateKeyPem, base = KALSHI_BASE }) {
  const key = await importKalshiPrivateKey(privateKeyPem);
  const timestamp = String(Date.now());
  // Sign the full path from API root without query string.
  const signPath = path.split('?')[0];
  const fullSignPath = signPath.startsWith('/trade-api/') ? signPath : `/trade-api/v2${signPath.startsWith('/') ? '' : '/'}${signPath}`;
  const signature = await signKalshiRequest(key, timestamp, method, fullSignPath);
  const headers = {
    'KALSHI-ACCESS-KEY': apiKeyId,
    'KALSHI-ACCESS-TIMESTAMP': timestamp,
    'KALSHI-ACCESS-SIGNATURE': signature,
    Accept: 'application/json',
    'User-Agent': UA,
  };
  if (body != null) headers['Content-Type'] = 'application/json';
  const url = base + (path.startsWith('/') ? path : `/${path}`);
  const res = await fetch(url, { method, headers, body: body != null ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { ok: res.ok, status: res.status, json };
}

export async function testKalshiConnection({ apiKeyId, privateKeyPem }) {
  const r = await signedFetch({ method: 'GET', path: '/portfolio/balance', apiKeyId, privateKeyPem });
  if (!r.ok) return { ok: false, status: r.status, error: r.json?.error?.message || r.json?.message || `Kalshi ${r.status}` };
  const bal = r.json?.balance;
  return { ok: true, balance: typeof bal === 'number' ? bal / 100 : bal, raw: r.json };
}

/**
 * Place a recommended-size order on a matched Kalshi market.
 * Uses CreateOrder V2: bid for YES, ask for selling YES (≈ buy NO exposure when crossed).
 * For side=no we buy NO by bidding... V2 single-book: use bid at (1 - yesAsk) on complementary —
 * Practical approach: bid YES when side=yes; when side=no, bid on a sibling ticker if provided,
 * otherwise place ask (sell YES) is wrong for opening. Kalshi binary: buying NO = side "no" on legacy.
 * V2 BookSide is bid|ask only on the YES book — buying NO at price P equals bidding YES? No.
 * Docs quick-start buys YES with bid. For NO we use legacy-compatible workaround: place bid with
 * ticker of the opposing market when available; else return not-placeable.
 */
export async function placeKalshiOrder({ apiKeyId, privateKeyPem, ticker, side, wagerDollars, yesAskDollars, clientOrderId }) {
  if (!ticker || !Number.isFinite(wagerDollars) || wagerDollars <= 0) {
    return { ok: false, error: 'Missing ticker or wager.' };
  }
  if (side !== 'yes') {
    return { ok: false, error: 'Only YES-side Kalshi contracts are placeable in this build. Use Open on Kalshi for NO / underdog.' };
  }
  let price = Number(yesAskDollars);
  if (!Number.isFinite(price) || price <= 0 || price >= 1) price = 0.5;
  // Round to 4 decimal dollars (cents).
  price = Math.min(0.99, Math.max(0.01, Math.round(price * 10000) / 10000));
  const count = Math.max(1, Math.floor(wagerDollars / price));
  const body = {
    ticker,
    side: 'bid',
    count: String(count),
    price: price.toFixed(4),
    time_in_force: 'good_till_canceled',
    self_trade_prevention_type: 'taker_at_cross',
    client_order_id: clientOrderId || crypto.randomUUID(),
  };
  const r = await signedFetch({ method: 'POST', path: '/portfolio/events/orders', apiKeyId, privateKeyPem, body });
  if (!r.ok) {
    return { ok: false, status: r.status, error: r.json?.error?.message || r.json?.message || `Kalshi ${r.status}`, detail: r.json };
  }
  return { ok: true, order: r.json, submitted: body };
}
