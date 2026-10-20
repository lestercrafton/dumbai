// Server-side Tesla Fleet API (web): PKCE authorization-code flow with the client secret held in Vercel env.
const crypto = require('crypto');
const { withRetry, HttpError, transient } = require('./retry');
const FLEET = { na: 'https://fleet-api.prd.na.vn.cloud.tesla.com', eu: 'https://fleet-api.prd.eu.vn.cloud.tesla.com' };
const AUTH = 'https://auth.tesla.com/oauth2/v3';
const SCOPES = 'openid offline_access vehicle_device_data vehicle_location';
function pkce() { const verifier = crypto.randomBytes(32).toString('base64url');
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') }; }
class Tesla {
  constructor({ env = process.env, fetch: f = globalThis.fetch, retryBaseMs = 1500 } = {}) { this.env = env; this.fetch = f; this.retryBaseMs = retryBaseMs; }
  get clientId() { return this.env.TESLA_CLIENT_ID || '9ec7fcaa-133f-48ee-9474-3ff87197c843'; }
  get base() { return FLEET[this.env.TESLA_REGION || 'na'] || FLEET.na; }
  authorizeUrl(redirectUri, state, challenge) {
    return `${AUTH}/authorize?` + new URLSearchParams({ response_type: 'code', client_id: this.clientId, redirect_uri: redirectUri, prompt_missing_scopes: 'true',
      scope: SCOPES, state, code_challenge: challenge, code_challenge_method: 'S256' });
  }
  async token(body) {
    if (!this.env.TESLA_CLIENT_SECRET) throw new Error('TESLA_CLIENT_SECRET not set');
    return withRetry(async () => {
      const r = await this.fetch(`${AUTH}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: this.clientId, client_secret: this.env.TESLA_CLIENT_SECRET, audience: this.base, ...body }) });
      if (!r.ok) throw new HttpError(r.status, 'Tesla token error ' + r.status + ' ' + (await r.text()).slice(0, 200));
      const j = await r.json();
      return { accessToken: j.access_token, refreshToken: j.refresh_token, expiresAt: Date.now() + (j.expires_in || 28800) * 1000 };
    }, { tries: 3, baseMs: this.retryBaseMs, retryable: transient });
  }
  exchangeCode(code, verifier, redirectUri) { return this.token({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri }); }
  // login: {accessToken, refreshToken, expiresAt}; returns {data, login} (login possibly refreshed)
  async call(login, path) {
    if (!login || !login.refreshToken) throw new HttpError(401, 'Tesla account not connected');
    if (!login.accessToken || Date.now() > (login.expiresAt || 0) - 60000) {
      const t = await this.token({ grant_type: 'refresh_token', refresh_token: login.refreshToken });
      login = { ...login, ...t, refreshToken: t.refreshToken || login.refreshToken, refreshed: true };
    }
    const data = await withRetry(async () => {
      const r = await this.fetch(this.base + path, { headers: { Authorization: 'Bearer ' + login.accessToken }, signal: AbortSignal.timeout(20000) });
      if (r.status === 408) return null; // asleep/offline: never wake it
      if (r.status === 401) throw new HttpError(401, 'Tesla sign-in expired: click Connect my Tesla again');
      if (!r.ok) throw new HttpError(r.status, 'Fleet API ' + r.status + ' ' + (await r.text()).slice(0, 200));
      return (await r.json()).response;
    }, { tries: 3, baseMs: this.retryBaseMs, retryable: transient });
    return { data, login };
  }
  // Cheap state check first; only read vehicle_data when the car is already online (a sleeping car is never woken).
  async snapshot(login, vin, now = new Date()) {
    const s = await this.call(login, `/api/1/vehicles/${vin}`); login = s.login;
    if (!s.data || s.data.state !== 'online') return { snap: null, login, state: s.data ? s.data.state : 'offline' };
    const v = await this.call(login, `/api/1/vehicles/${vin}/vehicle_data?endpoints=${encodeURIComponent('drive_state;vehicle_state;location_data')}`);
    if (!v.data) return { snap: null, login: v.login, state: 'offline' };
    const d = v.data;
    return { login: v.login, state: 'online', snap: { ts: now.toISOString(), odometer: d.vehicle_state.odometer, shift_state: d.drive_state.shift_state || 'P',
      lat: d.drive_state.latitude, lon: d.drive_state.longitude, speed: d.drive_state.speed } };
  }
}
module.exports = { Tesla, pkce, SCOPES };
