// Phone (iPhone) trips on top of WebService: per-user car list tagged personal/business/Tesla, trip intake from the
// app, Tesla dedup, reimbursement only for business trips in personal cars, email sent through the Gmail API as the
// signed-in Google user (SMTP only as a fallback), GPS-mode email, and a monthly log CSV in the user's own Drive.
const C = require('./core');
const { WebService, K } = require('./service');
const { withRetry, HttpError } = require('./retry');
const { gpsEmail, ymd } = require('./gpsmail');
const { supersedeReason, overlaps, reimbursable, isTeslaTrip } = require('./dedup');
const { logCsv } = require('./log');
const { Google } = require('./google');

const validEmail = e => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length < 200;
const round = (n, p) => Math.round(n * 10 ** p) / 10 ** p;
const OWN = ['personal', 'business'];
const isIso = s => typeof s === 'string' && !Number.isNaN(Date.parse(s));
const cleanLoc = l => l && Number.isFinite(+l.lat) && Number.isFinite(+l.lon) ? { lat: +(+l.lat).toFixed(6), lon: +(+l.lon).toFixed(6), ...(l.name ? { name: String(l.name).slice(0, 200) } : {}) } : null;

// Fallback only (when a user hasn't granted gmail.send): SMTP password per user, keyed by the address before @,
// upper-cased, non-alphanumerics -> _, e.g. SMTP_PASS_LESTER for lester@ovanova.co.
const smtpKey = email => 'SMTP_PASS_' + email.split('@')[0].toUpperCase().replace(/[^A-Z0-9]/g, '_');
function gmailTransportFor(env, email) {
  const pass = env[smtpKey(email)]; if (!pass) return null;
  return require('nodemailer').createTransport({ host: env.SMTP_HOST || 'smtp.gmail.com', port: Number(env.SMTP_PORT || 587), secure: env.SMTP_SECURE === 'true', auth: { user: email, pass } });
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
  async setRecipient(email, { to, cc }) {
    if (to != null && !validEmail(String(to).trim())) throw new HttpError(400, 'Recipient must be an email address');
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
  async cars(email) { return (await this.vehicles(email)).map(v => ({ ...v, ownership: v.ownership || 'personal', isTesla: !!(v.isTesla || v.vin && /tesla/i.test(v.model || '')) })); }
  async saveCars(email, list) {
    if (!Array.isArray(list) || list.length > 50) throw new HttpError(400, 'cars must be a list');
    const cur = await this.vehicles(email), out = [];
    for (const c of list) {
      const id = String(c.id || '').slice(0, 64) || 'car' + Date.now().toString(36) + out.length; if (!c.name) throw new HttpError(400, 'Each car needs a name');
      const old = cur.find(v => v.id === id) || {};
      out.push({ ...old, id, name: String(c.name).slice(0, 60), model: String(c.model ?? old.model ?? '').slice(0, 80), vin: String(c.vin ?? old.vin ?? '').slice(0, 20),
        ownership: OWN.includes(c.ownership) ? c.ownership : 'personal', isTesla: !!c.isTesla, owner: old.owner || (await this.user(email)).name.split(' ')[0], ownerEmail: email });
    }
    for (const v of cur) if (v.teslaId && !out.some(x => x.id === v.id)) out.push(v); // never drop a connected Tesla
    await this.db.set(K.veh(email), out); return this.cars(email);
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
        const sup = supersedeReason(t, trips, vehicles); if (sup) Object.assign(t, sup); else { delete t.supersededBy; delete t.reason; }
        if (t.category !== 'business' || t.supersededBy || t.logOnly) delete t.queuedAt;
      }
      const ok = reimbursable(t, vehicles) && !t.reimbursedAt;
      if (ok && p.action === 'send') toSend.push(t.id); else if (ok && p.action === 'batch' && !t.queuedAt) toQueue.push(t.id);
      results.push({ clientId: cid, id, status: this.status(t, vehicles).status, supersededBy: t.supersededBy });
    }
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

  // A Tesla trip arriving after a phone trip supersedes the overlapping phone trip (unless it was already sent).
  async onTripEnd(email, vehicle, trip) {
    const t = await super.onTripEnd(email, vehicle, trip); if (!t) return t;
    const trips = await this.trips(email); let changed = false;
    for (const p of trips) if (p.source === 'phone-gps' && !p.supersededBy && overlaps(p, t)) {
      if (p.reimbursedAt) p.teslaConflict = t.id; else { p.supersededBy = t.id; p.reason = 'Overlaps a Tesla trip'; delete p.queuedAt; }
      changed = true; }
    if (changed) await this.db.set(K.trips(email), trips);
    return t;
  }
  async queue(email, ids) { const vs = await this.cars(email), ok = (await this.trips(email)).filter(t => ids.includes(t.id) && (isTeslaTrip(t) || reimbursable({ ...t, category: 'business' }, vs))).map(t => t.id);
    return super.queue(email, ok); }

  async build(email, list) {
    if (list.every(t => t.startOdo != null)) return super.build(email, list); // all-Tesla batches keep the odometer email
    const s = await this.settings(email), u = await this.user(email), vs = await this.vehicles(email);
    const m = gpsEmail(list, vs, u, { rate: s.rate, signature: s.signature || undefined, ...(list.length > 1 ? { title: 'Weekly Business' } : {}) });
    return { ...m, s, u };
  }
  // Same guarantees as WebService.send (per-account lock, only unsent reimbursable trips, marked once SMTP accepts),
  // but sent from the user's own Gmail.
  async send(email, ids, reason = 'manual') {
    if (!(await this.db.setnx(K.lock(email), 1, 120))) throw new HttpError(409, 'A send is already in progress');
    let result;
    try {
      const s = await this.settings(email); if (!s.sugar.to) throw new HttpError(400, 'Set the Sugar recipient in Settings');
      const tr = await this.transportFor(email);
      if (!tr) throw new HttpError(503, `Email is not set up for ${email}: sign in with Google again and allow sending email`);
      const transport = tr.t, own = tr.own;
      const vs = await this.cars(email);
      const list = (await this.trips(email)).filter(t => ids.includes(t.id) && !t.reimbursedAt && (isTeslaTrip(t) ? t.category === 'business' : reimbursable(t, vs)));
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
  // Friday batch for every user (called by the Vercel cron).
  async tickAll() { const out = [];
    for (const email of await this.db.smembers(K.users)) { try { const r = await this.tick(email); if (r.length) out.push({ email, sent: r }); } catch (e) { out.push({ email, error: e.message }); } }
    return out; }

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
module.exports = { PhoneService, smtpKey, gmailTransportFor, validEmail };
