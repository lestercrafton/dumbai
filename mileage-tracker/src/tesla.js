// Main-process vehicle data sources: Fleet API, TeslaMate (Postgres), and a simulator.
const { TripDetector, fromTeslaMate } = require('./core');
const { withRetry, HttpError, transient } = require('./retry');

const FLEET_BASE = { na: 'https://fleet-api.prd.na.vn.cloud.tesla.com', eu: 'https://fleet-api.prd.eu.vn.cloud.tesla.com' };
const AUTH = 'https://auth.tesla.com/oauth2/v3';

// One shared Fleet API app (bundled app-config: client id, region, redirect, token broker URL). The client secret never ships:
// code/refresh exchanges go through the admin's token broker (tools/tesla-token-broker.js), which adds it server-side.
class FleetApi {
  constructor(appCfg, login, saveLogin, env = process.env) { this.app = appCfg; this.login = login || {}; this.saveLogin = saveLogin; this.env = env; }
  get base() { return FLEET_BASE[this.app.region || 'na']; }
  static pkce() { const c = require('crypto'), verifier = c.randomBytes(32).toString('base64url');
    return { verifier, challenge: c.createHash('sha256').update(verifier).digest('base64url') }; }
  authorizeUrl(state, challenge) {
    const p = new URLSearchParams({ response_type: 'code', client_id: this.app.clientId, redirect_uri: this.app.redirectUri, prompt_missing_scopes: 'true',
      scope: 'openid offline_access vehicle_device_data vehicle_location', state, code_challenge: challenge, code_challenge_method: 'S256' });
    return `${AUTH}/authorize?${p}`;
  }
  async token(body) {
    return withRetry(() => this._token(body), { tries: 3, baseMs: this.retryBaseMs ?? 2000, retryable: transient });
  }
  async _token(body) {
    let r;
    if (this.app.tokenBroker) r = await fetch(this.app.tokenBroker.replace(/\/$/, '') + '/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    else { const secret = this.env.TESLA_CLIENT_SECRET; if (!secret) throw new Error('No token broker configured (app-config tesla.tokenBroker) and no TESLA_CLIENT_SECRET');
      r = await fetch(`${AUTH}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: this.app.clientId, client_secret: secret, audience: this.base, ...body }) }); }
    if (!r.ok) throw new HttpError(r.status, 'Tesla token error ' + r.status + ' ' + (await r.text()).slice(0, 200));
    const j = await r.json();
    Object.assign(this.login, { accessToken: j.access_token, refreshToken: j.refresh_token || this.login.refreshToken, expiresAt: Date.now() + j.expires_in * 1000 });
    this.saveLogin(this.login); return j;
  }
  exchangeCode(code, verifier) { return this.token({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: this.app.redirectUri }); }
  async call(path) {
    if (this.login.refreshToken && (!this.login.accessToken || Date.now() > (this.login.expiresAt || 0) - 60000))
      await this.token({ grant_type: 'refresh_token', refresh_token: this.login.refreshToken });
    if (!this.login.accessToken) throw new Error('Tesla account not connected');
    return withRetry(async () => {
      const r = await fetch(this.base + path, { headers: { Authorization: 'Bearer ' + this.login.accessToken }, signal: AbortSignal.timeout(20000) });
      if (r.status === 408) return null; // asleep/offline: do not wake it
      if (r.status === 401) throw new HttpError(401, 'Tesla sign-in expired: click Connect my Tesla again');
      if (!r.ok) throw new HttpError(r.status, 'Fleet API ' + r.status + ' ' + (await r.text()).slice(0, 200));
      return (await r.json()).response;
    }, { tries: 3, baseMs: this.retryBaseMs ?? 2000, retryable: transient });
  }
  vehicles() { return this.call('/api/1/vehicles'); }
  async snapshot(vin) {
    const v = await this.call(`/api/1/vehicles/${vin}/vehicle_data?endpoints=${encodeURIComponent('drive_state;vehicle_state;location_data')}`);
    if (!v) return null;
    return { ts: new Date().toISOString(), odometer: v.vehicle_state.odometer, shift_state: v.drive_state.shift_state || 'P',
      lat: v.drive_state.latitude, lon: v.drive_state.longitude, speed: v.drive_state.speed };
  }
}
class FleetSource { constructor(api, vin) { this.api = api; this.vin = vin; } snapshot() { return this.api.snapshot(this.vin); } }

class Simulator {
  constructor(odo = 12345.6, driveTicks = 6) { this.driveTicks = driveTicks; this.odo = odo; this.t = 0; this.lat = 41.88; this.lon = -87.63; }
  async snapshot() {
    // cycle: 3 ticks parked, 6 ticks driving (~1.5 mi/tick), repeat
    const ph = this.t++ % (3 + this.driveTicks), driving = ph >= 3;
    const snap = { ts: new Date().toISOString(), odometer: Math.round(this.odo * 10) / 10, shift_state: driving ? 'D' : 'P', lat: this.lat, lon: this.lon, speed: driving ? 35 : 0 };
    if (driving) { this.odo += 1.5; this.lat += 0.01; this.lon += 0.005; }
    return snap;
  }
}

class Poller {
  constructor(source, onEvent, intervalMs) { this.source = source; this.onEvent = onEvent; this.intervalMs = intervalMs; this.det = new TripDetector(); }
  start() { this.stop(); const tick = async () => {
      try { const s = await this.source.snapshot(); if (s) { this.onEvent({ event: 'snapshot', snapshot: s });
        const e = this.det.feed(s); if (e) this.onEvent(e); } this.errors = 0; } catch (err) { this.errors = (this.errors || 0) + 1; this.onEvent({ event: 'error', message: err.message, consecutive: this.errors }); }
      // poll fast while driving and for a few minutes after parking (catches back-to-back short drives); odometer jumps between
      // parked polls are turned into inferred trips by TripDetector, so drives shorter than the poll gap still get recorded.
      if (this.det.active) this.lastDrive = Date.now();
      const hot = this.det.active || Date.now() - (this.lastDrive || 0) < 5 * 60000;
      const base = hot ? Math.min(this.intervalMs, this.fastMs || 10000) : this.intervalMs;
      if (!this.stopped) this.timer = setTimeout(tick, this.errors ? Math.min(base * 2 ** this.errors, 15 * 60000) : base); };
    this.stopped = false;
    tick(); }
  stop() { this.stopped = true; clearTimeout(this.timer); }
}

async function importTeslaMate(connectionString, sinceIso) {
  const { Client } = require('pg');
  const c = new Client({ connectionString }); await c.connect();
  try {
    const q = await c.query(`SELECT d.id, d.start_date, d.end_date, d.start_km, d.end_km, d.distance,
        sa.display_name AS start_address, ea.display_name AS end_address
      FROM drives d LEFT JOIN addresses sa ON sa.id = d.start_address_id LEFT JOIN addresses ea ON ea.id = d.end_address_id
      WHERE d.end_date IS NOT NULL AND d.start_date >= $1 ORDER BY d.start_date`, [sinceIso || '1970-01-01']);
    return q.rows.map(fromTeslaMate);
  } finally { await c.end(); }
}
module.exports = { FleetSource, FleetApi, Simulator, Poller, importTeslaMate };
