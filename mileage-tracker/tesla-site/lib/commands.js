// Vehicle commands for the Commands tab: phrase parsing, validation, per-user authorization, signed send via api/vcmd.go.
const crypto = require('crypto');
const { HttpError } = require('./retry');
const CMDS = {
  'wake': { label: 'Wake up' }, 'windows-vent': { label: 'Vent windows' }, 'windows-close': { label: 'Close windows' },
  'climate-on': { label: 'Climate on' }, 'climate-off': { label: 'Climate off' }, 'set-temp': { label: 'Set temperature', arg: [59, 82], unit: '°F' },
  'charge-start': { label: 'Start charging' }, 'charge-stop': { label: 'Stop charging' }, 'charge-limit': { label: 'Set charge limit', arg: [50, 100], unit: '%' },
  'charge-amps': { label: 'Set charging amps', arg: [5, 48], unit: 'A' }, 'lock': { label: 'Lock' }, 'unlock': { label: 'Unlock', confirm: true },
  'honk': { label: 'Honk horn' }, 'flash': { label: 'Flash lights' },
};
const RULES = [
  [/\b(vent|crack|roll\s*down|open)\b.*\bwindows?\b|\bwindows?\b.*\b(vent|down|open)\b/, 'windows-vent'],
  [/\b(close|shut|roll\s*up)\b.*\bwindows?\b|\bwindows?\b.*\b(close|shut|up)\b/, 'windows-close'],
  [/\b(temp|temperature|thermostat|heat|cool)\w*\b.*?(\d{2}(?:\.\d)?)|\b(\d{2}(?:\.\d)?)\s*(°|degrees?|f\b)/, 'set-temp'],
  [/\b(charge|charging)\s*limit\b.*?(\d{2,3})|\blimit\b.*?(\d{2,3})\s*%?|\b(\d{2,3})\s*%/, 'charge-limit'],
  [/\b(amps?|amperage|current)\b.*?(\d{1,2})|\b(\d{1,2})\s*(amps?|a)\b/, 'charge-amps'],
  [/\b(stop|end|pause)\b.*\bcharg/, 'charge-stop'], [/\b(start|begin|resume)\b.*\bcharg|^charge( now)?$/, 'charge-start'],
  [/\b(climate|ac|a\/c|air|hvac|heater|heat|defrost)\b.*\boff\b|\bturn off\b.*\b(climate|ac|air|heat)/, 'climate-off'],
  [/\b(climate|ac|a\/c|air|hvac|heater|heat|precondition|warm|cool)\b/, 'climate-on'],
  [/\bunlock\b/, 'unlock'], [/\block\b/, 'lock'], [/\b(honk|horn|beep)\b/, 'honk'], [/\b(flash|blink)\b.*\blights?\b|\blights?\b/, 'flash'], [/\bwake\b/, 'wake'],
];
function parse(text) {
  const t = String(text || '').toLowerCase().replace(/[.,!?]/g, ' ').replace(/\s+/g, ' ').trim();
  for (const [re, cmd] of RULES) { const m = t.match(re); if (!m) continue;
    const n = m.slice(1).find(x => x && /^\d/.test(x)); return CMDS[cmd].arg ? { cmd, arg: n == null ? null : Number(n) } : { cmd }; }
  return null;
}
function validate(cmd, arg) {
  const c = CMDS[cmd]; if (!c) throw new HttpError(400, 'Unknown command');
  if (!c.arg) return null;
  const n = arg == null || arg === "" ? NaN : Number(arg); if (!Number.isFinite(n)) throw new HttpError(400, `${c.label} needs a number`);
  if (n < c.arg[0] || n > c.arg[1]) throw new HttpError(400, `${c.label} must be ${c.arg[0]}–${c.arg[1]}${c.unit}`);
  return cmd === 'set-temp' ? Math.round(n * 2) / 2 : Math.round(n);
}
function jwtScopes(tok) { try { const p = JSON.parse(Buffer.from(String(tok).split('.')[1], 'base64url').toString()); return [].concat(p.scp || p.scope || []).flatMap(s => String(s).split(' ')); } catch { return []; } }
const canCommand = tok => { const s = jwtScopes(tok); return s.includes('vehicle_cmds') && s.includes('vehicle_charging_cmds'); };
const sign = (body, secret) => crypto.createHmac('sha256', secret).update(body).digest('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// svc: WebService (db, tesla, env, fetch). Ownership = the VIN is listed by the user's OWN Tesla token right now.
async function ownedCars(svc, email) {
  let login = await svc.db.get('tesla:' + email); if (!login || !login.refreshToken) return { login: null, cars: [] };
  const r = await svc.tesla.call(login, '/api/1/vehicles');
  if (r.login.refreshed) { login = { ...r.login }; delete login.refreshed; delete login.error; await svc.db.set('tesla:' + email, login); } else login = r.login;
  return { login, cars: (r.data || []).map(c => ({ vin: c.vin, name: c.display_name || 'Tesla', state: c.state })) };
}
async function status(svc, email) {
  const { login, cars } = await ownedCars(svc, email);
  return { connected: !!login, approved: !!login && canCommand(login.accessToken), cars, commands: CMDS,
    approveUrl: '/auth/tesla/commands', pairUrl: 'https://tesla.com/_ak/' + new URL(svc.baseUrl).host };
}
async function wake(svc, login, vin, now = Date.now) {
  const st = async () => { const r = await svc.tesla.call(login, '/api/1/vehicles/' + vin); return r.data && r.data.state; };
  if (await st() === 'online') return false;
  const post = () => svc.fetch(svc.tesla.base + `/api/1/vehicles/${vin}/wake_up`, { method: 'POST', headers: { Authorization: 'Bearer ' + login.accessToken }, signal: AbortSignal.timeout(15000) });
  const r = await post(); if (r.status === 401) throw new HttpError(401, 'Tesla sign-in expired: reconnect your Tesla');
  if (r.status === 402 || r.status === 429) throw new HttpError(r.status, 'Tesla API limit reached (' + r.status + ')');
  const end = now() + (svc.wakeMs ?? 40000);
  while (now() < end) { await sleep(svc.wakePollMs ?? 3000); if (await st() === 'online') return true; }
  throw new HttpError(504, "The car didn't wake up in time. Try again in a minute.");
}
async function run(svc, email, { vin, cmd, arg, text, confirmed }) {
  if (text && !cmd) { const p = parse(text); if (!p) throw new HttpError(400, `Didn't understand "${String(text).slice(0, 80)}". Try "vent windows", "set temp 72", "charge limit 80", "amps 20".`); ({ cmd, arg } = p); }
  const a = validate(cmd, arg);
  if (CMDS[cmd].confirm && confirmed !== true) return { needsConfirm: true, cmd, arg: a, label: CMDS[cmd].label };
  vin = String(vin || ''); if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) throw new HttpError(400, 'Pick a car');
  const { login, cars } = await ownedCars(svc, email);
  if (!login) throw new HttpError(403, 'Connect your Tesla first');
  if (!cars.some(c => c.vin === vin)) throw new HttpError(403, "That car isn't on your Tesla account");
  if (!canCommand(login.accessToken)) throw new HttpError(403, 'Command access not approved yet');
  const secret = svc.env.CRON_SECRET; if (!secret) throw new HttpError(503, 'Server not configured');
  const woke = await wake(svc, login, vin);
  if (cmd === 'wake') return { ok: true, cmd, woke, done: woke ? 'Car is awake' : 'Car was already awake' };
  const body = JSON.stringify({ vin, token: login.accessToken, cmd, arg: a ?? 0, ts: Date.now() });
  const r = await svc.fetch(svc.baseUrl + '/api/vcmd', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sig': sign(body, secret),
    ...(svc.env.VERCEL_AUTOMATION_BYPASS_SECRET ? { 'x-vercel-protection-bypass': svc.env.VERCEL_AUTOMATION_BYPASS_SECRET } : {}) }, body, signal: AbortSignal.timeout(55000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new HttpError(r.status >= 400 ? r.status : 502, 'Car said: ' + (j.error || r.status));
  return { ok: true, cmd, arg: a, woke, done: CMDS[cmd].label + (a != null ? ' ' + a + CMDS[cmd].unit : '') + ' — sent' };
}
module.exports = { CMDS, parse, validate, jwtScopes, canCommand, sign, status, run, ownedCars };
