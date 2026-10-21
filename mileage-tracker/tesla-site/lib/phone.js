// Phone (iPhone) trips on top of WebService: per-user car list tagged personal/business, trip intake from the
// app (the phone counts every mile it records; it never consults Tesla data), reimbursement only for business trips in personal cars, email sent through the Gmail API as the
// signed-in Google user (SMTP only as a fallback), GPS-mode email, and a monthly log CSV in the user's own Drive.
const C = require('./core');
const { WebService, K } = require('./service');
const { withRetry, HttpError } = require('./retry');
const { gpsEmail, ymd } = require('./gpsmail');
const { reimbursable } = require('./dedup');
const { logCsv } = require('./log');
const { Google } = require('./google');

const validEmail = e => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length < 200;
const round = (n, p) => Math.round(n * 10 ** p) / 10 ** p;
const OWN = ['personal', 'business'];
const SUGAR = 'sugar@ovanova.co', isOvanova = e => /@ovanova\.co$/i.test(String(e || '').trim());
const isIso = s => typeof s === 'string' && !Number.isNaN(Date.parse(s));
const cleanLoc = l => l && Number.isFinite(+l.lat) && Number.isFinite(+l.lon) ? { lat: +(+l.lat).toFixed(6), lon: +(+l.lon).toFixed(6), ...(l.name ? { name: String(l.name).slice(0, 200) } : {}) } : null;

// Fallback only (when a user hasn't granted gmail.send): SMTP password per user, keyed by the address before @,
// upper-cased, non-alphanumerics -> _, e.g. SMTP_PASS_LESTER for lester@ovanova.co.
const smtpKey = email => 'SMTP_PASS_' + email.split('@')[0].toUpperCase().replace(/[^A-Z0-9]/g, '_');
function gmailTransportFor(env, email) {
  const pass = env[smtpKey(email)]; if (!pass) return null;
  return require('nodemailer').createTransport({ host: env.SMTP_HOST || 'smtp.gmail.com', port: Number(env.SMTP_PORT || 587), secure: env.SMTP_SECURE === 'true', auth: { user: email, pass } });
}

const TZ = 'America/Chicago';
const q = v => { const x = String(v ?? ''); return /[",\n]/.test(x) || /^[=+\-@]/.test(x) ? '"' + (/^[=+\-@]/.test(x) ? "'" : '') + x.replace(/"/g, '""') + '"' : x; };
const place = l => !l ? '' : l.name || `${l.lat}, ${l.lon}`;
const STATUS_LABEL = { sent: 'Sent', queued: 'Batched (Friday)', 'log only': 'Logged', reimbursable: 'Not sent yet', personal: 'Personal', untagged: 'Needs review', superseded: 'Logged' };
// Rows for the Google Sheet export, with a totals row (formulas so edits in the sheet keep adding up).
function sheetCsv(trips, vehicles, statusOf) {
  const head = ['Date', 'Start time', 'Start place', 'End place', 'Miles', 'Duration (min)', 'Business/Personal', 'Car', 'Car type', 'Reimbursable amount', 'Status'];
  const out = [head.join(',')];
  for (const t of trips) {
    const st = statusOf(t), car = vehicles.find(v => v.id === t.vehicleId), [a, b] = (t.route || '').split(' → ');
    const d = new Date(t.startTime), date = d.toLocaleDateString('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }), time = d.toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
    const amount = ['sent', 'queued', 'reimbursable'].includes(st.status) && st.amount != null ? st.amount.toFixed(2) : '0.00';
    out.push([date, time, a && b ? a : place(t.startLoc), a && b ? b : place(t.endLoc), (+t.miles).toFixed(1), Math.round((Date.parse(t.endTime) - Date.parse(t.startTime)) / 60000),
      t.category === 'business' ? 'Business' : t.category === 'personal' ? 'Personal' : 'Not answered', car ? car.name : '', car ? (car.ownership === 'business' ? 'Company' : 'Personal') : '',
      amount, STATUS_LABEL[st.status] || st.status].map(q).join(','));
  }
  const n = trips.length + 1;
  out.push(['Total', '', '', '', n > 1 ? `=SUM(E2:E${n})` : 0, n > 1 ? `=SUM(F2:F${n})` : 0, '', '', '', n > 1 ? `=SUM(J2:J${n})` : 0, ''].join(','));
  return out.join('\n') + '\n';
}

class PhoneService extends WebService {
  constructor(o) { super(o); this.userTransport = o.userTransport || (email => gmailTransportFor(this.env, email));
    this.google = o.google || new Google({ env: this.env, db: this.db, fetch: this.fetch, now: this.now, retryBaseMs: this.retryBaseMs }); }

  // Any verified Google account can use the phone app (not only @ovanova.co).
  async ensureUser(email, name, sub) {
    email = String(email || '').toLowerCase(); if (!validEmail(email)) throw new HttpError(400, 'bad email');
    const u = (await this.user(email)) || { email, createdAt: this.now().toISOString(), settings: {} };
    Object.assign(u, { name: name || u.name || email.split('@')[0], ...(sub ? { sub } : {}), lastLoginAt: this.now().toISOString() });
    await this.db.set(K.user(email), u); await this.db.sadd(K.users, email);
    if (!(await this.db.get(K.veh(email)))) await this.db.set(K.veh(email), []);
    return email;
  }
  // Recipient rules: @ovanova.co accounts default to Sugar and may only send to @ovanova.co addresses.
  // Everyone else has no default (blank until they enter one) and is never sent to Sugar implicitly.
  async settings(email) { const st = await super.settings(email), u = await this.user(email), stored = u && u.settings && u.settings.sugar && u.settings.sugar.to;
    if (!isOvanova(email)) st.sugar.to = stored && stored.toLowerCase() !== SUGAR ? stored : '';
    else if (!stored || !isOvanova(stored)) st.sugar.to = SUGAR;
    return st; }
  async setRecipient(email, { to, cc }) {
    if (to != null && String(to).trim() === '' && !isOvanova(email)) to = '';
    else if (to != null && !validEmail(String(to).trim())) throw new HttpError(400, 'Recipient must be an email address');
    else if (to != null && isOvanova(email) && !isOvanova(String(to).trim())) throw new HttpError(400, 'Ovanova accounts send reimbursements to an @ovanova.co address');
    if (to != null && !isOvanova(email) && String(to).trim().toLowerCase() === SUGAR) throw new HttpError(400, 'Enter the address that handles your reimbursements');
    const ccs = cc == null ? null : String(cc).split(',').map(x => x.trim()).filter(Boolean);
    if (ccs && ccs.some(x => !validEmail(x))) throw new HttpError(400, 'CC must be email addresses');
    return this.saveSettings(email, { sugar: { ...(to != null ? { to: String(to).trim() } : {}), ...(ccs ? { cc: ccs.join(', ') } : {}) } });
  }
  // Gmail API as the user when they granted gmail.send; otherwise per-user SMTP; otherwise the server's SMTP.
  async transportFor(email) {
    if (this.google && this.google.configured && await this.google.hasScope(email, 'gmail.send')) return { t: this.google.gmailTransport(email), own: true };
    const u = this.userTransport(email); if (u) return { t: u, own: true };
    return this.transport ? { t: this.transport, own: false } : null;
  }
  // ---- cars
  // Cars as the phone sees them: plain personal/company cars. Cars the driver removed in the app stay hidden.
  async cars(email) { return (await this.vehicles(email)).filter(v => !v.phoneHidden).map(({ isTesla, ...v }) => ({ ...v, ownership: v.ownership || 'personal' })); }
  async saveCars(email, list) {
    if (!Array.isArray(list) || list.length > 50) throw new HttpError(400, 'cars must be a list');
    const cur = await this.vehicles(email), out = [], remap = {};
    const keyOf = c => [c.name, c.model || ''].map(x => String(x).trim().toLowerCase().replace(/\s+/g, ' ')).join('|');
    for (const c of list) {
      const id = String(c.id || '').slice(0, 64) || 'car' + Date.now().toString(36) + out.length; if (!c.name || !String(c.name).trim()) throw new HttpError(400, 'Each car needs a name');
      const dup = out.find(x => keyOf(x) === keyOf(c)); if (dup) { if (dup.id !== id) remap[id] = dup.id; continue; } // same name + model saved twice
      const old = cur.find(v => v.id === id) || {}; const { isTesla, phoneHidden, ...keep } = old;
      out.push({ ...keep, id, name: String(c.name).trim().slice(0, 60), model: String(c.model ?? old.model ?? '').trim().slice(0, 80), vin: String(c.vin ?? old.vin ?? '').slice(0, 20),
        ownership: OWN.includes(c.ownership) ? c.ownership : 'personal', owner: old.owner || (await this.user(email)).name.split(' ')[0], ownerEmail: email });
    }
    // Cars linked to the separate Tesla tool keep their record for that tool, just hidden from the phone.
    for (const v of cur) if (v.teslaId && !out.some(x => x.id === v.id)) out.push({ ...v, phoneHidden: true });
    await this.db.set(K.veh(email), out);
    if (Object.keys(remap).length) { const trips = await this.trips(email); let ch = false;
      for (const t of trips) if (remap[t.vehicleId]) { t.vehicleId = remap[t.vehicleId]; ch = true; }
      if (ch) await this.db.set(K.trips(email), trips); }
    return this.cars(email);
  }

  // ---- intake from the phone. Idempotent per clientId; resubmits only update tags of unsent trips.
  async receive(email, list) {
    if (!Array.isArray(list) || list.length > 200) throw new HttpError(400, 'trips must be a list');
    const vehicles = await this.cars(email), trips = await this.trips(email), u = await this.user(email), results = [], toSend = [], toQueue = [];
    for (const p of list) {
      const cid = String(p.clientId || '').slice(0, 80), miles = Number(p.miles);
      if (!cid || !isIso(p.startTime) || !isIso(p.endTime) || !(miles >= 0 && miles < 2000) || Date.parse(p.endTime) < Date.parse(p.startTime)) { results.push({ clientId: cid, error: 'invalid trip' }); continue; }
      if (p.carId && !vehicles.some(v => v.id === p.carId)) { results.push({ clientId: cid, error: 'unknown car' }); continue; }
      const id = 'phone:' + cid; let t = trips.find(x => x.id === id);
      if (!t) { t = { id, source: 'phone-gps', startTime: new Date(p.startTime).toISOString(), endTime: new Date(p.endTime).toISOString(), miles: round(miles, 1), startOdo: null, endOdo: null,
        startLoc: cleanLoc(p.startLoc), endLoc: cleanLoc(p.endLoc), driver: (u.name || email).split(' ')[0], category: null, purpose: '', receivedAt: this.now().toISOString() }; trips.push(t); }
      if (!t.reimbursedAt) {
        if (p.carId) t.vehicleId = p.carId;
        if (['business', 'personal', null].includes(p.category)) t.category = p.category;
        if (p.purpose != null) t.purpose = String(p.purpose).slice(0, 300);
        if (p.route) t.route = String(p.route).slice(0, 300);
        const car = vehicles.find(v => v.id === t.vehicleId);
        t.logOnly = !!(car && car.ownership === 'business');
        delete t.supersededBy; delete t.reason; delete t.teslaConflict; // phone miles always count
        if (t.category !== 'business' || t.logOnly) delete t.queuedAt;
      }
      const ok = reimbursable(t, vehicles) && !t.reimbursedAt;
      if (ok && p.action === 'send') toSend.push(t.id); else if (ok && p.action === 'batch' && !t.queuedAt) toQueue.push(t.id);
      results.push({ clientId: cid, id, status: this.status(t, vehicles).status });
    }
    // One-time cleanup: phone trips once marked "Counted by Tesla" count again (unsent ones only).
    for (const t of trips) if (t.source === 'phone-gps' && t.supersededBy && !t.reimbursedAt) { delete t.supersededBy; delete t.reason; }
    await this.db.set(K.trips(email), trips);
    if (toQueue.length) await this.queue(email, toQueue);
    let sent = null, sendError = null;
    if (toSend.length) { try { sent = await this.send(email, toSend, 'phone'); } catch (e) { sendError = e.message; } }
    const all = await this.trips(email);
    for (const r of results) { const t = all.find(x => x.id === r.id); if (t) r.status = this.status(t, vehicles).status; }
    const drive = await this.logToDrive(email, list.map(p => p.startTime).filter(isIso));
    return { results, sent, sendError, drive };
  }
  status(t, vehicles) {
    const rate = C.irsRate(ymd(t.startTime)), amount = round(t.miles * rate, 2);
    if (t.supersededBy) return { status: 'superseded' };
    if (t.category === 'personal') return { status: 'personal' };
    if (t.category !== 'business') return { status: 'untagged' };
    if (t.logOnly || !reimbursable(t, vehicles)) return { status: 'log only' };
    if (t.reimbursedAt) return { status: 'sent', rate, amount };
    if (t.queuedAt) return { status: 'queued', rate, amount };
    return { status: 'reimbursable', rate, amount };
  }

  async queue(email, ids) { const vs = await this.cars(email), ok = (await this.trips(email)).filter(t => ids.includes(t.id) && t.category !== 'personal' && reimbursable({ ...t, category: 'business' }, vs)).map(t => t.id);
    return super.queue(email, ok); }

  async build(email, list) {
    if (list.every(t => t.startOdo != null)) return super.build(email, list); // legacy Tesla-tool trips keep the odometer email; phone trips never carry odometers
    const s = await this.settings(email), u = await this.user(email), vs = await this.vehicles(email);
    const m = gpsEmail(list, vs, u, { ...(s.sugar.to.toLowerCase() === SUGAR ? {} : { greeting: 'Hello' }), rate: s.rate, signature: s.signature || undefined, ...(list.length > 1 ? { title: 'Weekly Business' } : {}) });
    return { ...m, s, u };
  }
  // Same guarantees as WebService.send (per-account lock, only unsent reimbursable trips, marked once SMTP accepts),
  // but sent from the user's own Gmail.
  async send(email, ids, reason = 'manual') {
    if (!(await this.db.setnx(K.lock(email), 1, 120))) throw new HttpError(409, 'A send is already in progress');
    let result;
    try {
      const s = await this.settings(email); if (!s.sugar.to) throw new HttpError(400, 'Add the address your reimbursements go to in Settings');
      const tr = await this.transportFor(email);
      if (!tr) throw new HttpError(503, `Email is not set up for ${email}: sign in with Google again and allow sending email`);
      const transport = tr.t, own = tr.own;
      const vs = await this.cars(email);
      const list = (await this.trips(email)).filter(t => ids.includes(t.id) && !t.reimbursedAt && reimbursable(t, vs)); // only business trips in a personally owned car
      if (!list.length) throw new HttpError(400, 'No unsent reimbursable trips selected');
      const m = await this.build(email, list), u = m.u, fromAddr = own ? email : (this.env.SMTP_FROM || this.env.SMTP_USER);
      const info = await withRetry(() => transport.sendMail({ from: `${u.name} <${fromAddr}>`, replyTo: own ? undefined : email, to: s.sugar.to,
        cc: [s.sugar.cc, own ? '' : email].filter(Boolean).join(', ') || undefined, subject: m.subject, text: m.text, html: m.html, attachments: m.attachments }),
        { tries: 3, baseMs: this.retryBaseMs, retryable: e => !(e.responseCode >= 500 || /auth|Invalid login/i.test(e.message)) });
      const sentAt = this.now().toISOString(), all = await this.trips(email);
      for (const t of all) if (list.some(x => x.id === t.id)) { t.reimbursedAt = sentAt; t.sentMessageId = info.messageId; delete t.queuedAt; }
      await this.db.set(K.trips(email), all);
      const log = (await this.db.get(K.sent(email))) || []; log.push({ sentAt, reason, to: s.sugar.to, subject: m.subject, tripIds: list.map(t => t.id), messageId: info.messageId });
      await this.db.set(K.sent(email), log.slice(-200));
      result = { count: list.length, to: s.sugar.to, subject: m.subject, miles: m.miles, amount: m.amount, months: list.map(t => t.startTime) };
    } finally { await this.db.del(K.lock(email)); }
    result.drive = await this.logToDrive(email, result.months); delete result.months;
    return result;
  }
  // Trips waiting for the Friday batch that would actually be reimbursed (business, personal car, unsent).
  async pendingBatch(email) { const vs = await this.cars(email);
    const list = (await this.trips(email)).filter(t => t.queuedAt && !t.reimbursedAt && reimbursable(t, vs));
    return { ids: list.map(t => t.id), count: list.length, miles: round(list.reduce((a, t) => a + t.miles, 0), 1) }; }
  // "Send now" from Settings: send the whole pending batch immediately instead of waiting for Friday.
  async sendBatch(email) { const p = await this.pendingBatch(email); if (!p.count) throw new HttpError(400, 'Nothing is waiting in the Friday batch');
    return this.send(email, p.ids, 'manual-batch'); }
  // Friday batch for every user (called by the Vercel cron).
  async tickAll() { const out = [];
    for (const email of await this.db.smembers(K.users)) { try { if (!(await this.settings(email)).sugar.to) continue; const r = await this.tick(email); if (r.length) out.push({ email, sent: r }); } catch (e) { out.push({ email, error: e.message }); } }
    return out; }

  // Export a date range (inclusive, YYYY-MM-DD in Central time) to a new Google Sheet in the user's own Drive.
  async exportSheet(email, from, to) {
    const D = /^\d{4}-\d{2}-\d{2}$/; if (!D.test(from || '') || !D.test(to || '') || from > to) throw new HttpError(400, 'Pick a start and end date');
    if (!this.google || !this.google.configured || !(await this.google.hasScope(email, 'drive.file'))) throw new HttpError(403, 'Google Drive permission missing: sign out and sign in with Google again');
    const vs = await this.cars(email), all = await this.vehicles(email);
    const rows = (await this.trips(email)).filter(t => ymd(t.startTime) >= from && ymd(t.startTime) <= to).sort((a, b) => a.startTime.localeCompare(b.startTime));
    const csv = sheetCsv(rows, all, t => this.status(t, vs));
    return this.google.createSheet(email, `Ovanova Moves ${from} to ${to}`, csv);
  }

  async logToDrive(email, dates) {
    if (!dates || !dates.length || !this.google || !this.google.configured || !(await this.google.hasScope(email, 'drive.file'))) return { skipped: true };
    const months = [...new Set(dates.map(d => ymd(d).slice(0, 7)))], all = await this.trips(email), vs = await this.cars(email), out = [];
    for (const ym of months) {
      try {
        const rows = all.filter(t => ymd(t.startTime).startsWith(ym));
        const id = await this.google.upsertCsv(email, ym, `Mileage log ${ym}.csv`, logCsv(rows, vs, t => this.status(t, vs))); out.push({ month: ym, fileId: id });
      } catch (e) { out.push({ month: ym, error: e.message }); }
    }
    return { months: out };
  }
}
module.exports = { PhoneService, sheetCsv, smtpKey, gmailTransportFor, validEmail };
