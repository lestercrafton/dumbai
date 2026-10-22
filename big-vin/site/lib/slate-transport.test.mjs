import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {build} from 'esbuild';
import {reportingWeek} from './results.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
let moduleId = 0;
// Bundle the real TypeScript entry point, injecting only its outside services.
// These tests execute request construction and route/service behavior rather
// than checking implementation strings or making real feed/database requests.
async function loadModule(entry, mocks = {}, services = {}) {
  const key = `__bigVinTransportTest${++moduleId}`;
  globalThis[key] = services;
  const result = await build({
    entryPoints: [entry], absWorkingDir: root, bundle: true, write: false,
    platform: 'node', format: 'esm', logLevel: 'silent',
    plugins: [{name: 'test-services', setup(builder) {
      builder.onResolve({filter: /.*/}, args => Object.hasOwn(mocks, args.path)
        ? {path: args.path, namespace: 'test-service'} : undefined);
      builder.onLoad({filter: /.*/, namespace: 'test-service'}, args => ({
        contents: `const services=__vinTransportServices;\n${mocks[args.path]}`, loader: 'js',
      }));
    }}],
  });
  const directory = mkdtempSync(join(tmpdir(), 'big-vin-transport-test-'));
  const file = join(directory, 'bundled.mjs');
  try {
    writeFileSync(file, `const __vinTransportServices=globalThis[${JSON.stringify(key)}];\n${result.outputFiles[0].text}`);
    return await import(pathToFileURL(file).href);
  } finally {
    delete globalThis[key];
    rmSync(directory, {recursive: true, force: true});
  }
}
const jsonResponse = payload => new Response(JSON.stringify(payload), {headers: {'Content-Type': 'application/json'}});
const dateParam = url => new URL(url).searchParams.get('dates');
const requestUrl = input => typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

test('browser fallback sends exactly Friday through Sunday for days=3, retaining one-day and week behavior', async t => {
  const {fetchSlate} = await loadModule('lib/board-client.ts');
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = previousFetch; });
  const requests = [], posted = [];
  globalThis.fetch = async (url, options) => {
    if (requestUrl(url).startsWith('/api/slate?')) throw new Error('Server unavailable');
    if (requestUrl(url).startsWith('/api/slate')) {
      const body = JSON.parse(options.body); posted.push(body);
      return jsonResponse({date: body.date, days: body.days});
    }
    requests.push(requestUrl(url));
    return jsonResponse({events: []});
  };
  assert.deepEqual(await fetchSlate('cbb', '2026-10-30', 3), {date: '2026-10-30', days: 3});
  assert.deepEqual(requests.map(dateParam), ['20261030', '20261031', '20261101']);
  assert.equal(posted[0].payload.partialLiveCoverage, false);
  requests.length = 0;
  await fetchSlate('cbb', '2026-11-03');
  assert.deepEqual(requests.map(dateParam), ['20261103']);
  assert.equal(posted.at(-1).days, 1);
  requests.length = 0;
  await fetchSlate('cbb', '2026-12-29', 7);
  assert.deepEqual(requests.map(dateParam), ['20261229', '20261230', '20261231', '20270101', '20270102', '20270103', '20270104']);
});

test('server is authoritative first; browser fallback keeps partial college coverage explicit', async t => {
  const {fetchSlate} = await loadModule('lib/board-client.ts');
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = previousFetch; });
  const requests = [];
  globalThis.fetch = async url => {
    requests.push(requestUrl(url));
    if (requestUrl(url).startsWith('/api/slate')) return jsonResponse({offlineSnapshot: true, games: []});
    throw new Error('Feed unavailable');
  };
  assert.deepEqual(await fetchSlate('cbb', '2026-10-30', 3), {offlineSnapshot: true, games: []});
  assert.deepEqual(requests, ['/api/slate?sport=cbb&date=2026-10-30&days=3']);
  const compactRequests = [];
  let body;
  globalThis.fetch = async (url, options) => {
    if (requestUrl(url).startsWith('/api/slate?')) throw new Error('Server unavailable');
    if (requestUrl(url).startsWith('/api/slate')) {body = JSON.parse(options.body); return jsonResponse({partialLiveCoverage: body.payload.partialLiveCoverage});}
    const parsed = new URL(url), dates = parsed.searchParams.get('dates');
    if (dates.includes('-')) throw new Error('Range unavailable');
    compactRequests.push([dates, parsed.searchParams.get('groups')]);
    if (dates === '20261031' && parsed.searchParams.get('groups') === '81') throw new Error('One group unavailable');
    return jsonResponse({events: [{id: `${dates}-${parsed.searchParams.get('groups')}`}]});
  };
  assert.deepEqual(await fetchSlate('cfb', '2026-10-30', 3), {partialLiveCoverage: true});
  assert.equal(body.days, 3);
  assert.equal(body.payload.events.length, 5);
  assert.deepEqual(compactRequests, [['20261030', '80'], ['20261030', '81'], ['20261031', '80'], ['20261031', '81'], ['20261101', '80'], ['20261101', '81']]);
});

test('cached browser events retain their original score observation until a real network refresh', async t => {
  const {browserBoard} = await loadModule('lib/board-client.ts');
  const previousFetch = globalThis.fetch, previousNow = Date.now;
  t.after(() => { globalThis.fetch = previousFetch; Date.now = previousNow; });
  let now = Date.parse('2026-10-17T12:00:00Z'), fetches = 0;
  Date.now = () => now;
  globalThis.fetch = async () => {fetches++; return jsonResponse({season: {year: 2026}, events: [{id: 'live', liveHomeScore: 7, scoreObservedAt: 'untrusted provider timestamp'}]});};
  const first = await browserBoard('nfl', '2026-10-17', '2026-10-17');
  assert.equal(first.events[0].scoreObservedAt, '2026-10-17T12:00:00.000Z');
  assert.deepEqual(first.events[0].season, {year: 2026});
  now += 59000;
  const cached = await browserBoard('nfl', '2026-10-17', '2026-10-17');
  assert.equal(cached.events[0].scoreObservedAt, first.events[0].scoreObservedAt);
  assert.equal(fetches, 1);
  now += 1000;
  const refreshed = await browserBoard('nfl', '2026-10-17', '2026-10-17');
  assert.equal(refreshed.events[0].scoreObservedAt, '2026-10-17T12:01:00.000Z');
  assert.equal(fetches, 2);
  assert.equal(first.events[0].scoreObservedAt, '2026-10-17T12:00:00.000Z');
});

test('GET and public POST routes pass the three-day window without changing API defaults or writing finals', async () => {
  const calls = [];
  const services = {getSlate: async (...args) => {calls.push(args); return {sport: args[0], date: args[1], days: args[3]};}};
  const {GET, POST} = await loadModule('app/api/slate/route.ts', {
    '@/lib/feeds/service': 'export const getSlate=(...args)=>services.getSlate(...args); export const persistFinals=()=>{throw new Error("Public request must not persist finals");};',
    '@/lib/db': 'export const sameOrigin=()=>true;',
    '@/lib/admin': 'export const authorizedCollector=async()=>false;',
  }, services);
  for (const [suffix, expected] of [['&days=3', 3], ['&days=1', 1], ['&days=7', 7], ['', 7], ['&days=2', 7]]) {
    const response = await GET(new Request(`https://test.invalid/api/slate?sport=cfb&date=2026-10-30${suffix}`));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).days, expected);
  }
  const post = await POST(new Request('https://test.invalid/api/slate', {method: 'POST', body: JSON.stringify({sport: 'cfb', date: '2026-10-30', days: 3, payload: {events: [], partialLiveCoverage: true}})}));
  assert.equal(post.status, 200);
  assert.equal((await post.json()).days, 3);
  const board = calls.at(-1)[2];
  assert.equal(new URL(board.sourceUrl).searchParams.get('dates'), '20261030');
  assert.equal(board.partialLiveCoverage, true);
  assert.ok(board.warnings.some(warning => /incomplete/.test(warning)));
  assert.deepEqual(board.games, []);
  const healthy = await POST(new Request('https://test.invalid/api/slate', {method: 'POST', body: JSON.stringify({sport: 'cfb', date: '2026-10-30', days: 3, payload: {events: [], partialLiveCoverage: false}})}));
  assert.equal(healthy.status, 200);
  assert.equal(calls.at(-1)[2].partialLiveCoverage, false);
  assert.ok(!calls.at(-1)[2].warnings.some(warning => /coverage may be incomplete/.test(warning)));
  const invalid = await GET(new Request('https://test.invalid/api/slate?date=2026-02-30&days=3'));
  assert.equal(invalid.status, 400);
});

test('browser weekend transport retains successful empty dates and marks missing dates for every league', async t => {
  const {browserBoard} = await loadModule('lib/board-client.ts');
  const previousFetch = globalThis.fetch;
  t.after(() => {globalThis.fetch = previousFetch;});
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(requestUrl(url));
    if (dateParam(url) === '20261017') throw new Error('Saturday unavailable');
    return jsonResponse({events: []});
  };
  for (const sport of ['nfl', 'cfb', 'nba', 'wnba', 'cbb', 'nhl', 'mlb']) {
    calls.length = 0;
    const board = await browserBoard(sport, '2026-10-16', '2026-10-18');
    assert.equal(board.partialLiveCoverage, true, sport);
    assert.deepEqual(board.events, []);
    assert.deepEqual([...new Set(calls.map(dateParam))], ['20261016', '20261017', '20261018']);
    assert.ok(board.sourceUrls.every(url => dateParam(url) !== '20261017'));
  }
  globalThis.fetch = async () => {throw new Error('Every date unavailable');};
  await assert.rejects(() => browserBoard('mlb', '2026-10-23', '2026-10-25'), /Every date unavailable/);
});

test('weekend POST preserves league partial flags and allowlists actual daily date/group provenance', async () => {
  const calls = [];
  const {POST} = await loadModule('app/api/slate/route.ts', {
    '@/lib/feeds/service': 'export const getSlate=async(...args)=>{services.calls.push(args);return {games:args[2].games};}; export const persistFinals=()=>{throw new Error("No public writes");};',
    '@/lib/db': 'export const sameOrigin=()=>true;',
    '@/lib/admin': 'export const authorizedCollector=async()=>false;',
  }, {calls});
  const {scoreboardUrls} = await import('./feeds/adapter.mjs');
  for (const sport of ['nfl', 'cfb', 'nba', 'wnba', 'cbb', 'nhl', 'mlb']) {
    const urls = scoreboardUrls(sport, {startDate: '2026-10-16', endDate: '2026-10-18', weekendDaily: true});
    const group = sport === 'cfb' ? '81' : null;
    const source = {id: sport, date: '2026-10-17T18:00:00Z', scoreboardSourceDate: '20261017', scoreboardSourceGroup: group,
      competitions: [{status: {type: {state: 'pre'}}, competitors: [{homeAway: 'home', team: {id: '1', displayName: 'Home'}}, {homeAway: 'away', team: {id: '2', displayName: 'Away'}}]}]};
    const response = await POST(new Request('https://test.invalid/api/slate', {method: 'POST', body: JSON.stringify({sport, date: '2026-10-16', days: 3, payload: {events: [source], partialLiveCoverage: true, sourceUrls: [...urls, 'https://evil.invalid/feed']}})}));
    assert.equal(response.status, 200, sport);
    const board = calls.at(-1)[2];
    assert.equal(board.partialLiveCoverage, true, sport);
    assert.deepEqual(board.sourceUrls, urls);
    const actual = new URL(board.games[0].sourceUrl);
    assert.equal(actual.searchParams.get('dates'), '20261017');
    if (sport === 'cfb') assert.equal(actual.searchParams.get('groups'), '81');
    else assert.ok(!board.warnings.some(warning => /capped at 25|college-football/i.test(warning)), sport);
  }
});

test('service includes only the three ET sports dates across DST and preserves saved finals, ranking and coverage', async () => {
  const start = '2026-10-30';
  const team = id => ({id, key: `cfb:espn:${id}`, name: `Team ${id}`});
  const row = (id, startTime) => ({id, sport: 'cfb', startTime, season: 2026, seasonType: 2, home: team('1'), away: team('2'), status: 'scheduled', completed: false});
  const games = [row('before', '2026-10-30T03:59:59Z'), row('fri', '2026-10-30T04:00:00Z'), row('sun', '2026-11-02T04:59:59Z'), row('after', '2026-11-02T05:00:00Z')];
  const finals = {status: 'completed', homeScore: 24, awayScore: 17, outcome: 'win', sourceUrl: 'saved-final'};
  const forecasts = [...games, row('saved', '2026-11-02T04:00:00Z')].map((game, index) => ({
    id: `forecast-${game.id}`, gameId: game.id, sport: 'cfb', cohort: 'live', origin: 'collector', modelVersion: 'ridge-v1',
    capturedAt: '2026-10-29T12:00:00Z', marketObservedAt: '2026-10-29T11:59:00Z', weekKey: reportingWeek(game),
    startTime: game.startTime, season: 2026, home: 'Home', away: 'Away', homeId: '1', awayId: '2',
    predictedMargin: {before: 100, fri: 8, sun: 5, after: 99, saved: 3}[game.id],
    marketHomeSpread: 0, rank: index + 11, side: 'home', result: game.id === 'saved' ? finals : null,
  }));
  const services = {forecasts, cutoffs: [], histories: {cfb: {games: [], warnings: [], sourceUrl: 'saved-history'}}};
  const {getSlate} = await loadModule('lib/feeds/service.ts', {
    '../live-results': 'export const refreshLiveResults=async()=>{};',
    '../bankroll.mjs': 'export const replayBankroll=()=>({plays:{}});',
    '../db': 'export const cached=(_key,_seconds,loader)=>loader(); export const db=()=>({prepare:()=>({bind:()=>({all:async()=>({results:[]})})})});',
    '../ratings.mjs': 'export const fitRatings=(_games,options)=>{services.cutoffs.push(options.asOf);return {asOf:options.asOf};}; export const projectGame=()=>{throw new Error("Saved forecast must not be recomputed");}; export const projectCollegeGame=projectGame;',
    '../result-store': 'export const readForecastRecords=async()=>services.forecasts; export const saveForecasts=async()=>{throw new Error("Browser data must not save forecasts");};',
    '../pick-revision-store': 'export const pickStates=async()=>new Map(); export const capturePickRevisions=async()=>{throw new Error("Browser data must not write revisions");};',
    '../model-versions': 'export const modelSpec=()=>({id:"ridge-v1",label:"Original",parameters:null}); export const modelLabel=()=>"Original"; export const eligibleForModel=()=>true; export const historicalModelSpecs=()=>[];',
    './histories.json': 'export default services.histories;',
  }, services);
  const board = {games, retrievedAt: '2026-10-17T12:00:00Z', warnings: ['Saved observations'], offlineSnapshot: true, partialLiveCoverage: true};
  const before = structuredClone({board, forecasts});
  const weekend = await getSlate('cfb', start, board, 3);
  assert.equal(weekend.endDate, '2026-11-01');
  assert.deepEqual(weekend.games.map(game => [game.id, game.rank, game.originalRank]), [['fri', null, 12], ['saved', 1, 15], ['sun', null, 13]]);
  const saved = weekend.games.find(game => game.id === 'saved');
  assert.equal(saved.status, 'completed');
  assert.equal(saved.homeScore, 24);
  assert.equal(saved.awayScore, 17);
  assert.equal(saved.result.outcome, 'win');
  assert.deepEqual(saved.result, finals);
  assert.equal(saved.forecastOrigin, 'collector');
  assert.equal(saved.historyCardRank, 4);
  assert.equal(saved.rank, 1);
  assert.equal(saved.home.name, 'Home');
  assert.equal(saved.home.abbreviation, undefined);
  assert.equal(weekend.offlineSnapshot, true);
  assert.equal(weekend.partialLiveCoverage, true);
  assert.ok(weekend.warnings.includes('Saved observations'));
  const daily = await getSlate('cfb', start, board, 1);
  assert.equal(daily.endDate, start);
  assert.deepEqual(daily.games.map(game => game.id), ['fri']);
  const weekly = await getSlate('cfb', start, board);
  assert.equal(weekly.endDate, '2026-11-05');
  assert.deepEqual(weekly.games.map(game => game.id), ['fri', 'saved', 'sun', 'after']);
  assert.ok(services.cutoffs.every(cutoff => cutoff === weekend.asOf));
  assert.deepEqual({board, forecasts}, before);
  services.forecasts = [];
  const empty = await getSlate('cfb', start, {...board, games: []}, 3);
  assert.deepEqual(empty.games, []);
  assert.equal(empty.partialLiveCoverage, true);
});


test('healthy CFB browser weekend checks request 200 and do not manufacture partial coverage',async t=>{
 const {browserBoard}=await loadModule('lib/board-client.ts');
 const previousFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=previousFetch;});
 let requests=0;
 globalThis.fetch=async url=>{
  requests++;const q=new URL(url).searchParams;assert.equal(q.get('limit'),'200');
  return jsonResponse({events:Array.from({length:52},(_,i)=>({id:q.get('dates')+'-'+q.get('groups')+'-'+i}))});
 };
 const board=await browserBoard('cfb','2026-10-16','2026-10-18');
 assert.equal(requests,6);assert.equal(board.events.length,312);assert.equal(board.partialLiveCoverage,false);
});
