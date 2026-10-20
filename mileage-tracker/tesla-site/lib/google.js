// Per-user Google access for phone users: OAuth (server-side authorization code + PKCE), encrypted refresh tokens
// in storage, Gmail API sending as the signed-in user, and a mileage-log folder in the user's own Drive (drive.file).
// Env: GOOGLE_WEB_CLIENT_ID / GOOGLE_WEB_CLIENT_SECRET (a "Web application" OAuth client; GOOGLE_CLIENT_ID /
// GOOGLE_CLIENT_SECRET accepted as fallback names), TOKEN_ENC_KEY (optional; defaults to a key derived from SESSION_SECRET).
const crypto = require('crypto');
const { withRetry, HttpError, transient } = require('./retry');

const SCOPES = ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/drive.file'];
const KG = { tok: e => 'google:' + e, folder: e => 'drivefolder:' + e, file: (e, ym) => `drive:${e}:${ym}` };

const encKey = env => env.TOKEN_ENC_KEY ? crypto.createHash('sha256').update(env.TOKEN_ENC_KEY).digest()
  : Buffer.from(crypto.hkdfSync('sha256', env.SESSION_SECRET || '', 'mileage', 'refresh-token-encryption', 32));
function encrypt(env, text) { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', encKey(env), iv);
  const ct = Buffer.concat([c.update(text, 'utf8'), c.final()]); return [iv, c.getAuthTag(), ct].map(b => b.toString('base64url')).join('.'); }
function decrypt(env, blob) { const [iv, tag, ct] = String(blob).split('.').map(s => Buffer.from(s, 'base64url'));
  const d = crypto.createDecipheriv('aes-256-gcm', encKey(env), iv); d.setAuthTag(tag); return Buffer.concat([d.update(ct), d.final()]).toString('utf8'); }

class Google {
  constructor({ env = process.env, db, fetch: f = globalThis.fetch, now = () => new Date(), retryBaseMs = 1000 }) { Object.assign(this, { env, db, fetch: f, now, retryBaseMs }); this.cache = new Map(); }
  get clientId() { return this.env.GOOGLE_WEB_CLIENT_ID || this.env.GOOGLE_CLIENT_ID; }
  get clientSecret() { return this.env.GOOGLE_WEB_CLIENT_SECRET || this.env.GOOGLE_CLIENT_SECRET; }
  get configured() { return !!(this.clientId && this.clientSecret); }
  authUrl(redirectUri, state, challenge) {
    return 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({ client_id: this.clientId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPES.join(' '),
      access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state, code_challenge: challenge, code_challenge_method: 'S256' });
  }
  async exchange(code, verifier, redirectUri) {
    const r = await this.fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.clientId, client_secret: this.clientSecret, code, code_verifier: verifier, redirect_uri: redirectUri, grant_type: 'authorization_code' }) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new HttpError(502, 'Google sign-in failed: ' + (j.error_description || j.error || r.status));
    const idt = JSON.parse(Buffer.from(String(j.id_token).split('.')[1], 'base64url').toString()); // straight from Google's token endpoint over TLS
    if (idt.aud !== this.clientId || !/accounts\.google\.com$/.test(String(idt.iss)) || idt.exp * 1000 < this.now().getTime() || !idt.email_verified) throw new HttpError(400, 'Invalid Google sign-in');
    const scopes = String(j.scope || '').split(' ');
    const email = String(idt.email).toLowerCase();
    if (j.refresh_token) await this.db.set(KG.tok(email), { rt: encrypt(this.env, j.refresh_token), scopes, sub: idt.sub, at: this.now().toISOString() });
    else if (!(await this.db.get(KG.tok(email)))) throw new HttpError(400, 'Google did not grant offline access; please sign in again');
    this.cache.set(email, { value: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 });
    return { email, name: idt.name || email, sub: idt.sub, scopes };
  }
  async status(email) { const t = await this.db.get(KG.tok(email)); return t ? { linked: !t.error, error: t.error || null, gmail: t.scopes.some(s => s.endsWith('gmail.send')), drive: t.scopes.some(s => s.endsWith('drive.file')) } : { linked: false }; }
  async hasScope(email, suffix) { const t = await this.db.get(KG.tok(email)); return !!(t && !t.error && t.scopes.some(s => s.endsWith(suffix))); }
  async accessToken(email) {
    const c = this.cache.get(email); if (c && c.exp > Date.now() + 60000) return c.value;
    const t = await this.db.get(KG.tok(email)); if (!t || t.error) throw new HttpError(401, 'Sign in with Google again in the Mileage app');
    const r = await this.fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.clientId, client_secret: this.clientSecret, refresh_token: decrypt(this.env, t.rt), grant_type: 'refresh_token' }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { if (j.error === 'invalid_grant') { await this.db.set(KG.tok(email), { ...t, error: 'expired' }); throw new HttpError(401, 'Google access expired or was revoked. Sign in with Google again in the Mileage app'); }
      throw new HttpError(r.status >= 500 ? 503 : 502, 'Google token refresh failed: ' + (j.error || r.status)); }
    this.cache.set(email, { value: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 }); return j.access_token;
  }
  async revoke(email) { const t = await this.db.get(KG.tok(email)); if (!t) return;
    try { await this.fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(decrypt(this.env, t.rt)), { method: 'POST' }); } catch {}
    await this.db.del(KG.tok(email)); this.cache.delete(email); }
  async api(email, url, opts = {}) {
    return withRetry(async () => { const r = await this.fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + await this.accessToken(email), ...(opts.headers || {}) } });
      if (r.status === 401) this.cache.delete(email);
      if (!r.ok) throw new HttpError(r.status, 'Google API ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 300)); return r.json(); },
      { tries: 3, baseMs: this.retryBaseMs, retryable: transient });
  }
  // nodemailer-compatible transport that sends through the Gmail API as the user.
  gmailTransport(email) {
    return { kind: 'gmail', sendMail: async msg => {
      const MailComposer = require('nodemailer/lib/mail-composer');
      const raw = await new Promise((res, rej) => new MailComposer(msg).compile().build((e, b) => e ? rej(e) : res(b)));
      const j = await this.api(email, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: raw.toString('base64url') }) });
      return { messageId: j.id }; } };
  }
  // ---- Drive (drive.file: the app only sees files and folders it created in the user's My Drive)
  async folder(email) {
    const cached = await this.db.get(KG.folder(email)); if (cached) return cached;
    const j = await this.api(email, 'https://www.googleapis.com/drive/v3/files?fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Mileage logs', mimeType: 'application/vnd.google-apps.folder' }) });
    await this.db.set(KG.folder(email), j.id); return j.id;
  }
  async upsertCsv(email, ym, name, csv, retried = false) {
    const parent = await this.folder(email), cached = await this.db.get(KG.file(email, ym));
    if (cached) { try { await this.api(email, `https://www.googleapis.com/upload/drive/v3/files/${cached}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'text/csv' }, body: csv }); return cached; }
      catch (e) { if (e.status !== 404) throw e; } } // file was deleted by the user: create it again
    const boundary = 'mtlog' + crypto.randomBytes(8).toString('hex');
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [parent], mimeType: 'text/csv' })}\r\n--${boundary}\r\nContent-Type: text/csv\r\n\r\n${csv}\r\n--${boundary}--`;
    let j; try { j = await this.api(email, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body }); }
    catch (e) { if (e.status !== 404 || retried) throw e; await this.db.del(KG.folder(email)); return this.upsertCsv(email, ym, name, csv, true); } // folder deleted: recreate
    await this.db.set(KG.file(email, ym), j.id); return j.id;
  }
}
module.exports = { Google, SCOPES, encrypt, decrypt, KG };
