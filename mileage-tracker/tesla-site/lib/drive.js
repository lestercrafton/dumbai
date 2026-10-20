// Google Drive log: one CSV per user per month, rewritten in full on every change (idempotent).
// Auth: a Google service account (JWT signed locally, no SDK). The folder should be in a Shared Drive that the
// service account is a member of (service accounts have no My Drive storage of their own).
// Env: GOOGLE_SA_EMAIL, GOOGLE_SA_PRIVATE_KEY (PEM, \n escaped is fine), DRIVE_FOLDER_ID
const crypto = require('crypto');
const { withRetry, HttpError, transient } = require('./retry');
const { ymd, hm } = require('./gpsmail');
const b64 = o => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');

function logCsv(trips, vehicles, rateOf) {
  const esc = v => '"' + String(v ?? '').replace(/"/g, '""') + '"', ll = l => l && l.lat != null ? `${l.lat.toFixed(5)}, ${l.lon.toFixed(5)}` : (l && l.name) || '';
  const head = ['Date', 'Start (Central)', 'End (Central)', 'Driver', 'Vehicle', 'Ownership', 'Source', 'Category', 'Status', 'Miles', 'Start odometer', 'End odometer', 'Start point', 'End point', 'Purpose', 'Rate', 'Amount', 'Queued at', 'Sent at', 'Superseded by'];
  const rows = [head.map(esc).join(',')];
  for (const t of [...trips].sort((a, b) => a.startTime.localeCompare(b.startTime))) {
    const v = vehicles.find(x => x.id === t.vehicleId) || {}, s = rateOf(t);
    rows.push([ymd(t.startTime), hm(t.startTime), hm(t.endTime), t.driver, v.name || t.vehicleId, v.ownership || 'personal', t.source, t.category || 'untagged', s.status,
      t.miles, t.startOdo ?? '', t.endOdo ?? '', ll(t.startLoc), ll(t.endLoc), t.purpose, s.rate ?? '', s.amount != null ? s.amount.toFixed(2) : '', t.queuedAt || '', t.reimbursedAt || '', t.supersededBy || ''].map(esc).join(','));
  }
  return rows.join('\n');
}

class Drive {
  constructor({ env = process.env, fetch: f = globalThis.fetch, now = () => new Date(), retryBaseMs = 1000 } = {}) { Object.assign(this, { env, fetch: f, now, retryBaseMs }); }
  get configured() { return !!(this.env.GOOGLE_SA_EMAIL && this.env.GOOGLE_SA_PRIVATE_KEY && this.env.DRIVE_FOLDER_ID); }
  async token() {
    if (this._tok && this._tok.exp > Date.now() + 60000) return this._tok.value;
    const iat = Math.floor(this.now().getTime() / 1000), head = b64({ alg: 'RS256', typ: 'JWT' });
    const claim = b64({ iss: this.env.GOOGLE_SA_EMAIL, scope: 'https://www.googleapis.com/auth/drive', aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600 });
    const key = this.env.GOOGLE_SA_PRIVATE_KEY.replace(/\\n/g, '\n');
    const sig = crypto.createSign('RSA-SHA256').update(head + '.' + claim).sign(key).toString('base64url');
    const r = await this.fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: head + '.' + claim + '.' + sig }) });
    if (!r.ok) throw new HttpError(r.status, 'Drive auth failed ' + r.status);
    const j = await r.json(); this._tok = { value: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 }; return j.access_token;
  }
  async call(url, opts = {}) {
    return withRetry(async () => { const r = await this.fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + await this.token(), ...(opts.headers || {}) } });
      if (!r.ok) throw new HttpError(r.status, 'Drive ' + r.status + ' ' + (await r.text().catch(() => ''))); return r.json(); },
      { tries: 3, baseMs: this.retryBaseMs, retryable: transient });
  }
  // Create or replace the CSV named `name` in the log folder. fileId cache avoids a search on every write.
  async upsertCsv(name, csv, fileId) {
    const q = 'supportsAllDrives=true';
    if (!fileId) {
      const s = await this.call(`https://www.googleapis.com/drive/v3/files?${q}&includeItemsFromAllDrives=true&corpora=allDrives&fields=files(id)&q=` +
        encodeURIComponent(`name = '${name.replace(/'/g, "\\'")}' and '${this.env.DRIVE_FOLDER_ID}' in parents and trashed = false`));
      fileId = s.files && s.files[0] && s.files[0].id;
    }
    if (fileId) { await this.call(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&${q}`, { method: 'PATCH', headers: { 'Content-Type': 'text/csv' }, body: csv }); return fileId; }
    const boundary = 'mtlog' + crypto.randomBytes(8).toString('hex');
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [this.env.DRIVE_FOLDER_ID], mimeType: 'text/csv' })}\r\n--${boundary}\r\nContent-Type: text/csv\r\n\r\n${csv}\r\n--${boundary}--`;
    const r = await this.call(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&${q}&fields=id`, { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body });
    return r.id;
  }
}
module.exports = { Drive, logCsv };
