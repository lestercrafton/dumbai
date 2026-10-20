#!/usr/bin/env node
// tesla-cmd: send signed Tesla Fleet API commands to a vehicle.
// Signing is done by Tesla's official `tesla-control` (github.com/teslamotors/vehicle-command).
// Commands are DRY-RUN by default; pass --live to actually send.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const CFG = {
  clientId: process.env.TESLA_CLIENT_ID || '9ec7fcaa-133f-48ee-9474-3ff87197c843',
  redirectUri: process.env.TESLA_REDIRECT_URI || 'http://localhost:8765/callback',
  vin: process.env.TESLA_VIN || '7SAYGDEE4RA246655',
  secretsDir: process.env.TESLA_SECRETS_DIR || '/workspace/mileage-tracker-secrets',
  fleetBase: process.env.TESLA_FLEET_BASE || 'https://fleet-api.prd.na.vn.cloud.tesla.com',
  authUrl: 'https://auth.tesla.com/oauth2/v3/authorize',
  tokenUrl: 'https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token',
  partnerDomain: 'ovanova-mileage-tesla.vercel.app',
  scopes: 'openid offline_access vehicle_device_data vehicle_location vehicle_cmds vehicle_charging_cmds',
  teslaControl: process.env.TESLA_CONTROL_BIN || '/workspace/bin/tesla-control',
};
const tokenFile = () => path.join(CFG.secretsDir, 'tesla-user-tokens.json');
const accessFile = () => path.join(CFG.secretsDir, 'tesla-access-token');
const keyFile = () => path.join(CFG.secretsDir, 'private.pem');

// name -> { args: (userArgs) => tesla-control argv, help }
const num = (v, lo, hi, name) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < lo || n > hi) throw new Error(`${name} must be a number ${lo}-${hi}`);
  return String(n);
};
const hhmm = (v) => { if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(v || '')) throw new Error(`time must be HH:MM, got ${v}`); return v; };
const onoff = (v) => { if (!['on', 'off'].includes(v)) throw new Error('expected on|off'); return v; };
const COMMANDS = {
  'wake': { a: () => ['wake'], h: 'wake the car' },
  'lock': { a: () => ['lock'], h: 'lock doors' },
  'unlock': { a: () => ['unlock'], h: 'unlock doors' },
  'windows-vent': { a: () => ['windows-vent'], h: 'vent all windows' },
  'windows-close': { a: () => ['windows-close'], h: 'close all windows' },
  'climate-on': { a: () => ['climate-on'], h: 'start HVAC' },
  'climate-off': { a: () => ['climate-off'], h: 'stop HVAC' },
  'climate-set-temp': { a: ([t]) => ['climate-set-temp', /[cf]$/i.test(t || '') ? t : num(t, 15, 85, 'temp') + 'F'], h: '<temp>[F|C] set cabin temp (default F)' },
  'charging-start': { a: () => ['charging-start'], h: 'start charging' },
  'charging-stop': { a: () => ['charging-stop'], h: 'stop charging' },
  'charging-set-limit': { a: ([p]) => ['charging-set-limit', num(p, 50, 100, 'percent')], h: '<50-100> charge limit %' },
  'charging-set-amps': { a: ([a]) => ['charging-set-amps', num(a, 1, 48, 'amps')], h: '<1-48> charge current' },
  'charging-schedule': { a: ([t]) => ['charging-schedule', hhmm(t)], h: '<HH:MM> scheduled charge start' },
  'charging-schedule-cancel': { a: () => ['charging-schedule-cancel'], h: 'cancel scheduled charging' },
  'charge-port-open': { a: () => ['charge-port-open'], h: 'open charge port' },
  'charge-port-close': { a: () => ['charge-port-close'], h: 'close charge port' },
  'sentry-mode': { a: ([v]) => ['sentry-mode', onoff(v)], h: '<on|off>' },
  'honk': { a: () => ['honk'], h: 'honk horn' },
  'flash-lights': { a: () => ['flash-lights'], h: 'flash lights' },
  'trunk-open': { a: () => ['trunk-open'], h: 'open rear trunk' },
  'trunk-close': { a: () => ['trunk-close'], h: 'close rear trunk' },
  'frunk-open': { a: () => ['frunk-open'], h: 'open frunk' },
  'seat-heater': { a: ([s, l]) => ['seat-heater', s, l], h: '<front-left|front-right|...> <off|low|medium|high>' },
  'steering-wheel-heater': { a: ([v]) => ['steering-wheel-heater', onoff(v)], h: '<on|off>' },
  'auto-seat-and-climate': { a: (r) => ['auto-seat-and-climate', ...r], h: '<L|R|LR> [on|off]' },
};

function buildArgv(cmd, args) {
  const c = COMMANDS[cmd];
  if (!c) throw new Error(`unknown command: ${cmd}`);
  return ['-vin', CFG.vin, '-key-file', keyFile(), '-token-file', accessFile(), ...c.a(args)];
}

function authorizeUrl(state = Math.random().toString(36).slice(2)) {
  const q = new URLSearchParams({ response_type: 'code', client_id: CFG.clientId, redirect_uri: CFG.redirectUri, scope: CFG.scopes, state, prompt_missing_scopes: 'true' });
  return `${CFG.authUrl}?${q}`;
}
const pairingUrl = () => `https://tesla.com/_ak/${CFG.partnerDomain}`;

function writePrivate(file, data) {
  fs.writeFileSync(file, data, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

async function tokenRequest(params) {
  const secret = process.env.TESLA_CLIENT_SECRET;
  if (!secret) throw new Error('TESLA_CLIENT_SECRET not set');
  const body = new URLSearchParams({ client_id: CFG.clientId, client_secret: secret, ...params }); // encodes '+' correctly
  const r = await fetch(CFG.tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`token endpoint ${r.status}: ${j.error || ''} ${j.error_description || ''}`);
  const tok = { ...j, obtained_at: Date.now(), expires_at: Date.now() + (j.expires_in || 0) * 1000 };
  const old = fs.existsSync(tokenFile()) ? JSON.parse(fs.readFileSync(tokenFile(), 'utf8')) : {};
  if (!tok.refresh_token) tok.refresh_token = old.refresh_token;
  writePrivate(tokenFile(), JSON.stringify(tok, null, 2));
  writePrivate(accessFile(), tok.access_token);
  return tok;
}

function extractCode(input) {
  if (/^https?:/.test(input)) { const u = new URL(input); const c = u.searchParams.get('code'); if (!c) throw new Error('no code in URL'); return c; }
  return input;
}
const exchangeCode = (input) => tokenRequest({ grant_type: 'authorization_code', code: extractCode(input), redirect_uri: CFG.redirectUri, audience: CFG.fleetBase });

// Preferred: fetch a fresh token from the web app (tokens come from /auth/tesla/commands), authenticated with CRON_SECRET.
async function accessTokenFromSite() {
  const r = await fetch(`https://${CFG.partnerDomain}/api/admin/tesla-token?vin=${CFG.vin}`, { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`site token endpoint ${r.status}: ${j.error || ''}`);
  if (!/vehicle_cmds/.test(j.scope || '')) console.error('warning: token lacks vehicle_cmds; open https://ovanova-mileage-tesla.vercel.app/auth/tesla/commands');
  writePrivate(accessFile(), j.accessToken);
  return j.accessToken;
}

async function accessToken() {
  if (process.env.CRON_SECRET) return accessTokenFromSite();
  if (!fs.existsSync(tokenFile())) throw new Error('not authorized yet: run `tesla-cmd auth-url`, then `tesla-cmd auth-exchange <redirect URL>`');
  const t = JSON.parse(fs.readFileSync(tokenFile(), 'utf8'));
  if (t.expires_at - Date.now() > 5 * 60 * 1000) { writePrivate(accessFile(), t.access_token); return t.access_token; }
  return (await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh_token })).access_token;
}

async function vehicleData() {
  const tok = await accessToken();
  const ep = 'charge_state;climate_state;closures_state;drive_state;location_data;vehicle_state';
  const r = await fetch(`${CFG.fleetBase}/api/1/vehicles/${CFG.vin}/vehicle_data?endpoints=${encodeURIComponent(ep)}`, { headers: { Authorization: `Bearer ${tok}` } });
  const j = await r.json().catch(() => ({}));
  if (r.status === 408) throw new Error('vehicle asleep/offline (408); try `tesla-cmd wake --live`');
  if (!r.ok) throw new Error(`vehicle_data ${r.status}: ${JSON.stringify(j)}`);
  return j.response;
}

function usage() {
  const lines = Object.entries(COMMANDS).map(([k, v]) => `  ${k.padEnd(26)} ${v.h}`);
  return `usage: tesla-cmd <command> [args] [--live]\n\nsetup:\n  (tokens come from the web app; set CRON_SECRET via web.env)\n  auth-url / auth-exchange   legacy localhost OAuth fallback\n  refresh                    force token refresh\n  pairing-link               virtual key pairing link\n  vehicle-data               read car state (read-only)\n\ncommands (dry-run unless --live):\n${lines.join('\n')}\n`;
}

async function main(argv) {
  const live = argv.includes('--live');
  const [cmd, ...args] = argv.filter((a) => a !== '--live' && a !== '--dry-run');
  switch (cmd) {
    case undefined: case 'help': case '--help': return console.log(usage());
    case 'auth-url': return console.log(authorizeUrl());
    case 'auth-exchange': { const t = await exchangeCode(args[0]); return console.log(`stored tokens; scopes: ${t.scope || '?'}`); }
    case 'refresh': { const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: JSON.parse(fs.readFileSync(tokenFile(), 'utf8')).refresh_token }); return console.log(`refreshed; expires ${new Date(t.expires_at).toISOString()}`); }
    case 'pairing-link': return console.log(pairingUrl());
    case 'vehicle-data': return console.log(JSON.stringify(await vehicleData(), null, 2));
  }
  const tcArgv = buildArgv(cmd, args);
  if (!live) return console.log(`[dry-run] ${CFG.teslaControl} ${tcArgv.join(' ')}`);
  await accessToken();
  if (!fs.existsSync(CFG.teslaControl)) throw new Error('tesla-control not installed at ' + CFG.teslaControl);
  execFileSync(CFG.teslaControl, tcArgv, { stdio: 'inherit' });
}

module.exports = { COMMANDS, buildArgv, authorizeUrl, pairingUrl, extractCode, CFG };
if (require.main === module) main(process.argv.slice(2)).catch((e) => { console.error(`error: ${e.message}`); process.exit(1); });
