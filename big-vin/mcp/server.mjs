#!/usr/bin/env node
// Read-only MCP server for Big Vin's public data. No dependencies, no secrets.
// stdio: node server.mjs    HTTP (Streamable HTTP, JSON responses): node server.mjs --http [port]
import http from 'node:http';
import readline from 'node:readline';

const SITE = process.env.BIG_VIN_SITE_URL || 'https://big-vin-grind-to-win.sunlightisfree.chatgpt.site';
const SPORTS = ['nfl', 'cfb', 'nba', 'wnba', 'cbb', 'nhl', 'mlb'];
const VERSION = '1.0.0';

async function api(path) {
  const r = await fetch(SITE + path, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`Big Vin API ${path} returned ${r.status}`);
  return r.json();
}
const ct = (iso) => iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' CT' : null;
const team = (t) => t && { abbreviation: t.abbreviation, name: t.name };
const slatePath = (sport, date) => `/api/slate?${new URLSearchParams(date ? { sport, date } : { sport })}`;
async function games(sport, date) {
  const d = await api(slatePath(sport, date));
  return { meta: { sport: d.sport, date: d.date, endDate: d.endDate, modelVersion: d.modelVersion, modelLabel: d.modelLabel, retrievedAt: d.retrievedAt, source: 'ESPN scoreboard (free, unofficial)', warnings: d.warnings }, games: d.games || [] };
}
const summary = (g) => ({ id: g.id, league: g.sportLabel, sport: g.sport, week: g.week, kickoffUtc: g.startTime, kickoffCt: ct(g.startTime), status: g.status, away: team(g.away), home: team(g.home), venue: g.venue, neutralSite: g.neutralSite });
const lines = (g) => ({
  firstSaved: g.market ? { ...g.market } : null,
  current: (g.markets || []).map((m) => ({ provider: m.provider, observedAt: m.observedAt, homeSpread: m.homeSpread, awaySpread: m.awaySpread, homeSpreadPrice: m.homeSpreadPrice, awaySpreadPrice: m.awaySpreadPrice, total: m.total, overPrice: m.overPrice, underPrice: m.underPrice, homeMoneyline: m.homeMoneyline, awayMoneyline: m.awayMoneyline, openHomeSpread: m.openHomeSpread, openTotal: m.openTotal })),
  source: g.source, sourceRetrievedAt: g.retrievedAt,
});
const ranked = (g) => ({ rank: g.rank, ...summary(g), side: g.side, pick: g.side ? team(g[g.side]) : null, edgePoints: g.edge != null ? +g.edge.toFixed(2) : null, marketHomeSpread: g.projection?.marketHomeSpread ?? null, fairHomeSpread: g.projection?.fairHomeSpread != null ? +g.projection.fairHomeSpread.toFixed(2) : null, lowEvidence: g.lowEvidence, stale: g.stale, modelVersion: g.modelVersion });

const sportProp = { type: 'string', enum: SPORTS, description: 'League: nfl, cfb (college football), nba, wnba, cbb (college hoops), nhl, mlb.' };
const dateProp = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Start date YYYY-MM-DD (Eastern). Omit for today; the board covers about a week ahead.' };
const ro = { readOnlyHint: true, openWorldHint: true };

const TOOLS = {
  get_slate: {
    description: 'List games on the Big Vin board for a league: kickoff in UTC and Central time, teams, venue, status.',
    inputSchema: { type: 'object', properties: { sport: sportProp, date: dateProp }, required: ['sport'] },
    run: async ({ sport, date }) => { const { meta, games: g } = await games(sport, date); return { ...meta, count: g.length, games: g.map(summary) }; },
  },
  get_lines: {
    description: 'Betting lines per game: the first-saved market the model is graded against, plus current sportsbook spread, total and moneyline with observation timestamps.',
    inputSchema: { type: 'object', properties: { sport: sportProp, date: dateProp, game_id: { type: 'string', description: 'Optional ESPN game id to return one game.' } }, required: ['sport'] },
    run: async ({ sport, date, game_id }) => { const { meta, games: g } = await games(sport, date); return { ...meta, games: g.filter((x) => !game_id || x.id === game_id).map((x) => ({ ...summary(x), lines: lines(x) })) }; },
  },
  get_rankings: {
    description: "Upcoming games ranked by edge: the gap in points between Big Vin's fair spread and the market spread, with the side the model favors. Edge measures disagreement with the market, not win probability.",
    inputSchema: { type: 'object', properties: { sport: { ...sportProp, description: sportProp.description + ' Omit to combine NFL and college football.' }, date: dateProp, limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 } } },
    run: async ({ sport, date, limit = 10 }) => {
      const list = sport ? [sport] : ['nfl', 'cfb'];
      const all = (await Promise.all(list.map((s) => games(s, date)))).flatMap((r) => r.games);
      const up = all.filter((g) => g.edge != null && g.rank != null && !g.completed).sort((a, b) => b.edge - a.edge);
      return { leagues: list, count: up.length, rankings: up.slice(0, limit).map((g, i) => ({ overallRank: i + 1, ...ranked(g) })) };
    },
  },
  get_game: {
    description: 'Full detail for one game: schedule, lines, projection, edge, pick, and result if graded.',
    inputSchema: { type: 'object', properties: { sport: sportProp, game_id: { type: 'string', description: 'ESPN game id (from get_slate or get_rankings).' }, date: dateProp }, required: ['sport', 'game_id'] },
    run: async ({ sport, game_id, date }) => { const { games: g } = await games(sport, date); const x = g.find((y) => y.id === game_id); if (!x) throw new Error(`Game ${game_id} not found on the ${sport} board for that window.`); return { ...ranked(x), lines: lines(x), projection: x.projection, result: x.result, scores: { home: x.homeScore, away: x.awayScore } }; },
  },
  get_model_inputs: {
    description: 'How the fair line is computed for a league: model version, tuning parameters, and per-game team ratings, home advantage and rest adjustments.',
    inputSchema: { type: 'object', properties: { sport: sportProp, game_id: { type: 'string', description: "Optional game id to return only that game's inputs." } }, required: ['sport'] },
    run: async ({ sport, game_id }) => { const d = await api(slatePath(sport)); return { modelVersion: d.modelVersion, modelLabel: d.modelLabel, tuning: d.tuning, model: d.model, historySource: d.historySource, historyRefreshedAt: d.historyRefreshedAt, games: (d.games || []).filter((g) => !game_id || g.id === game_id).map((g) => ({ id: g.id, away: g.away?.abbreviation, home: g.home?.abbreviation, projection: g.projection })) }; },
  },
  get_methodology: {
    description: 'Plain-language explanation of how Big Vin builds lines, defines edge, sources data and grades results.',
    inputSchema: { type: 'object', properties: {} },
    run: async () => ({
      fairLine: 'Each team gets a rating fitted from past final scores (recent games weigh more), plus home-field and rest adjustments. The predicted margin becomes a fair spread.',
      edge: 'Edge = fair spread minus market spread, in points. The model takes the side the market undervalues. Bigger edge means bigger disagreement, not a guaranteed win.',
      data: "Schedules, scores and DraftKings lines come from ESPN's free public scoreboard feed. Baseball research uses the free MLB Stats API and Statcast.",
      grading: 'Every pick is saved before kickoff with its original price and never rewritten. Each sport and model keeps a separate hypothetical $500 bankroll risking 2% per game. No real wagers are placed.',
      origin: 'Big Vin started tracking lines by hand with his boy Stan on March 22, 2021.',
      site: SITE,
    }),
  },
  get_track_record: {
    description: 'Graded results for saved pregame picks: wins, losses, units and bankroll by model version.',
    inputSchema: { type: 'object', properties: { sport: sportProp }, required: ['sport'] },
    run: async ({ sport }) => api(`/api/results?sport=${encodeURIComponent(sport)}`),
  },
};

async function handle({ id, method, params = {} }) {
  const ok = (result) => ({ jsonrpc: '2.0', id, result });
  if (method === 'initialize') return ok({ protocolVersion: params.protocolVersion || '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'big-vin', title: 'Big Vin - Grind to Win', version: VERSION }, instructions: "Read-only access to Big Vin's sports board: games, lines, edge rankings and graded results. Start with get_rankings." });
  if (method === 'ping') return ok({});
  if (method === 'tools/list') return ok({ tools: Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.description, inputSchema: t.inputSchema, annotations: ro })) });
  if (method === 'tools/call') {
    const t = TOOLS[params.name];
    if (!t) return { jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown tool ${params.name}` } };
    try { const data = await t.run(params.arguments || {}); return ok({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data }); }
    catch (e) { return ok({ content: [{ type: 'text', text: String(e.message || e) }], isError: true }); }
  }
  if (id === undefined) return null;
  return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
}
const dispatch = async (b) => Array.isArray(b) ? ((r) => r.length ? r : null)((await Promise.all(b.map(handle))).filter(Boolean)) : handle(b);

if (process.argv.includes('--http')) {
  const port = Number(process.argv[process.argv.indexOf('--http') + 1]) || Number(process.env.PORT) || 8787;
  http.createServer(async (req, res) => {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', 'content-type, mcp-session-id, mcp-protocol-version');
    if (req.method === 'OPTIONS') return res.writeHead(204).end();
    if (req.method === 'GET' && req.url === '/health') return res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
    if (req.url !== '/mcp') return res.writeHead(404).end();
    if (req.method !== 'POST') return res.writeHead(405, { allow: 'POST' }).end();
    let raw = ''; for await (const c of req) raw += c;
    let body; try { body = JSON.parse(raw); } catch { return res.writeHead(400, { 'content-type': 'application/json' }).end('{"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"Parse error"}}'); }
    const out = await dispatch(body);
    if (!out) return res.writeHead(202).end();
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
  }).listen(port, () => console.error(`Big Vin MCP listening on http://localhost:${port}/mcp`));
} else {
  readline.createInterface({ input: process.stdin }).on('line', async (line) => {
    let m; try { m = JSON.parse(line); } catch { return; }
    const out = await dispatch(m); if (out) process.stdout.write(JSON.stringify(out) + '\n');
  });
}
