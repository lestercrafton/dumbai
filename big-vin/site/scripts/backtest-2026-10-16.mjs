/**
 * October 16, 2026 owner-directed season tuning (same policy as Sep 14):
 * per sport, search a bounded grid of rating weights against the sport's own
 * saved prospective forecasts at their original prices. Net units (1u per
 * eligible game) is the objective; MAE breaks ties. Hindsight results only —
 * any selected settings ship under a new version for future games only.
 * Usage: node scripts/backtest-2026-10-16.mjs [--apply]
 * Reads the private collector config; never prints or stores the token.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fitRatings, projectGame, projectCollegeGame, MODEL_CONFIGS} from '../lib/ratings.mjs';
import tuningSep14 from '../lib/tuning-2026-09-14.json' with {type: 'json'};

const apply = process.argv.includes('--apply');
const root = path.dirname(new URL(import.meta.url).pathname).replace('/scripts', '');
const config = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.config/big-vin/collector.json'), 'utf8'));
const get = async (route) => {
  const r = await fetch(config.url + route, {headers: {Authorization: `Bearer ${config.token}`}, signal: AbortSignal.timeout(60000)});
  const v = await r.json();
  if (!r.ok) throw new Error(v.error || `HTTP ${r.status}`);
  return v;
};
const seedGames = (sport) => {
  if (sport === 'nfl') return JSON.parse(fs.readFileSync(path.join(root, 'lib/feeds/nfl-history.json'), 'utf8')).games;
  if (sport === 'wnba') return JSON.parse(fs.readFileSync(path.join(root, 'lib/feeds/wnba-history.json'), 'utf8')).games;
  const all = JSON.parse(fs.readFileSync(path.join(root, 'lib/feeds/histories.json'), 'utf8'));
  return all[sport]?.games || [];
};
const sportKey = {cfb: 'ncaaf', cbb: 'ncaab'}; // fitRatings canonical keys
const baseParams = (sport) => {
  const tuned = tuningSep14[sport]?.parameters;
  if (tuned) return {...tuned};
  const cfg = MODEL_CONFIGS[sportKey[sport] || sport];
  const {validated: _validated, ...rest} = cfg;
  return {...rest};
};
const pnlAt = (odds, outcome) => outcome === 'push' ? 0 : outcome === 'loss' ? -1 : odds > 0 ? odds / 100 : 100 / -odds;

async function collectRecords(sport) {
  const overview = await get(`/api/results?sport=${sport}&cohort=live`);
  const byGame = new Map();
  for (const version of overview.versions.map(v => v.id)) {
    for (const week of overview.weeks.map(w => w.key)) {
      const data = await get(`/api/results?sport=${sport}&cohort=live&week=${encodeURIComponent(week)}&version=${encodeURIComponent(version)}`);
      for (const f of data.records || []) {
        if (f.result?.status !== 'completed' || !Number.isFinite(f.marketHomeSpread) || !Number.isFinite(f.odds) || Math.abs(f.odds) < 100) continue;
        const prev = byGame.get(f.gameId);
        if (!prev || (f.modelVersion === 'ridge-v1' && prev.modelVersion !== 'ridge-v1')) byGame.set(f.gameId, f);
      }
    }
  }
  return [...byGame.values()];
}

const reports = {};
for (const sport of ['nfl', 'cfb', 'nba', 'wnba', 'cbb', 'nhl', 'mlb']) {
  const records = await collectRecords(sport);
  if (records.length < 20) { reports[sport] = {sport, decision: 'retain', reason: `Only ${records.length} graded priced saved forecasts; too few to tune.`}; console.log(sport, reports[sport].reason); continue; }
  const base = baseParams(sport);
  // Training pool: seed history + finals from the saved records themselves.
  const pool = new Map();
  for (const g of seedGames(sport)) pool.set(`${g.homeId}|${g.awayId}|${(g.date || '').slice(0, 10)}`, {homeId: g.homeId, awayId: g.awayId, date: (g.date || '').slice(0, 10), homeScore: g.homeScore, awayScore: g.awayScore, neutral: !!g.neutral, restDiff: g.restDiff ?? 0});
  for (const f of records) pool.set(`${f.homeId}|${f.awayId}|${f.startTime.slice(0, 10)}`, {homeId: f.homeId, awayId: f.awayId, date: f.startTime.slice(0, 10), homeScore: f.result.homeScore, awayScore: f.result.awayScore, neutral: false, restDiff: 0});
  const training = [...pool.values()].filter(g => Number.isFinite(g.homeScore) && Number.isFinite(g.awayScore) && g.date);
  const cutoffs = [...new Set(records.map(f => f.trainingCutoff || f.startTime.slice(0, 10)))].sort((a, b) => a.localeCompare(b));
  const project = sport === 'cfb' ? projectCollegeGame : projectGame;
  const uniq = (xs) => [...new Set(xs)];
  const candidates = [];
  for (const halfLifeDays of uniq([base.halfLifeDays, 60, 120, 240, 480]))
    for (const ratingPenalty of uniq([base.ratingPenalty, 3, 6, 12, 24]))
      candidates.push({...base, halfLifeDays, ratingPenalty});
  const evaluate = (params) => {
    let games = 0, wins = 0, losses = 0, pushes = 0, net = 0, absErr = 0, sqErr = 0, errN = 0;
    const byCutoff = new Map(records.map(f => [f.trainingCutoff || f.startTime.slice(0, 10), null]));
    for (const cutoff of cutoffs) {
      let model;
      try { model = fitRatings(training, {sport, asOf: cutoff, parameters: params}); } catch { continue; }
      byCutoff.set(cutoff, model);
    }
    for (const f of records) {
      const model = byCutoff.get(f.trainingCutoff || f.startTime.slice(0, 10));
      if (!model) continue;
      const p = project({homeId: f.homeId, awayId: f.awayId, neutral: false, restDiff: 0, marketHomeSpread: f.marketHomeSpread}, model);
      if (p.predictedHomeMargin === null || p.predictedHomeMargin === undefined) continue;
      const actual = f.result.actualMargin ?? (f.result.homeScore - f.result.awayScore);
      const edge = p.predictedHomeMargin + f.marketHomeSpread;
      games++;
      absErr += Math.abs(actual - p.predictedHomeMargin); sqErr += (actual - p.predictedHomeMargin) ** 2; errN++;
      if (Math.abs(edge) < 1e-9) { pushes++; continue; }
      const cover = edge > 0 ? actual + f.marketHomeSpread : -(actual + f.marketHomeSpread);
      const outcome = Math.abs(cover) < 1e-9 ? 'push' : cover > 0 ? 'win' : 'loss';
      if (outcome === 'win') wins++; else if (outcome === 'loss') losses++; else pushes++;
      net += pnlAt(f.odds, outcome);
    }
    return {games, wins, losses, pushes, netUnits: net, roi: games ? net / games : null, winRate: wins + losses ? wins / (wins + losses) : null, mae: errN ? absErr / errN : null, rmse: errN ? Math.sqrt(sqErr / errN) : null};
  };
  const baseline = evaluate(base);
  let best = {params: base, ...baseline};
  for (const params of candidates) {
    const r = evaluate(params);
    if (r.games < baseline.games * 0.9) continue;
    if (r.netUnits > best.netUnits + 1e-9 || (Math.abs(r.netUnits - best.netUnits) <= 1e-9 && (r.mae ?? 1e9) < (best.mae ?? 1e9))) best = {params, ...r};
  }
  const changed = JSON.stringify(best.params) !== JSON.stringify(base) && best.netUnits > baseline.netUnits + 1e-9;
  reports[sport] = {
    sport, decision: changed ? 'activate-new-version' : 'retain-current',
    sample: `${baseline.games} graded priced saved forecasts · ${records[0]?.startTime?.slice(0, 10) || ''} to ${records.at(-1)?.startTime?.slice(0, 10) || ''}`,
    candidates: candidates.length, baselineParams: base, baseline: {games: baseline.games, wins: baseline.wins, losses: baseline.losses, pushes: baseline.pushes, netUnits: baseline.netUnits, roi: baseline.roi, mae: baseline.mae, rmse: baseline.rmse},
    selectedParams: best.params, selected: {games: best.games, wins: best.wins, losses: best.losses, pushes: best.pushes, netUnits: best.netUnits, roi: best.roi, mae: best.mae, rmse: best.rmse},
    sigma: baseline.rmse,
    method: 'Refit at each saved trainingCutoff on seed history plus finals from saved records before that cutoff (fitRatings only uses pre-cutoff games). Candidate side graded at the original saved price; opposite-side prices were not saved. Neutral-site flags and NFL rest differences for target games were unavailable in saved records and treated as home/0. Hindsight selection: future games are the test.',
  };
  console.log(sport, reports[sport].decision, `n=${baseline.games} base net ${baseline.netUnits.toFixed(2)}u MAE ${baseline.mae?.toFixed(2)} -> best net ${best.netUnits.toFixed(2)}u MAE ${best.mae?.toFixed(2)}`, changed ? JSON.stringify(best.params) : '');
}
const outDir = path.join(root, 'public/research/tuning-2026-10-16');
fs.mkdirSync(outDir, {recursive: true});
fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify({generatedAt: new Date().toISOString(), reports}, null, 2));
if (apply) {
  const tuning = {};
  for (const [sport, r] of Object.entries(reports)) {
    if (r.decision !== 'activate-new-version') continue;
    tuning[sport] = {
      id: `${sport}-season-tuned-2026-10-16`, label: 'Season-tuned · October 16',
      activatedAt: new Date().toISOString(), startDate: '2026-10-16', startWeekKey: sport === 'nfl' ? '2026-W07' : '2026-10-12',
      parameters: r.selectedParams,
      objective: 'Net units at original saved prices, one unit per eligible game; MAE tiebreak',
      sampleLabel: r.sample, candidates: r.candidates,
      baseline: r.baseline, selected: r.selected, sigma: r.sigma,
      scopeNote: 'Selected in hindsight on saved season forecasts (see summary.json). Applies only to games captured after activation; no earlier pick, price or rank changes.',
      reportUrl: '/research/tuning-2026-10-16/summary.json',
    };
  }
  fs.writeFileSync(path.join(root, 'lib/tuning-2026-10-16.json'), JSON.stringify(tuning, null, 2));
  console.log('APPLIED', Object.keys(tuning));
}
console.log('wrote', path.join(outDir, 'summary.json'));
