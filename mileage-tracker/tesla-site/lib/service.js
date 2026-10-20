// Web account logic: per-user vehicles/trips in KV storage, trip detection from shift_state polling, tagging,
// send-now vs end-of-week batch (Friday 17:00 America/Chicago), ntfy push with action buttons, Sugar email format.
const crypto = require('crypto');
const C = require('./core');
const { withRetry, HttpError } = require('./retry');
const { lastWeekly } = require('./tz');
const { sign } = require('./session');

const DEFAULT_SETTINGS = { rate: null, signature: '', sugar: { to: 'sugar@ovanova.co', cc: '' }, weekEnd: { day: 5, time: '17:00' }, ntfy: { server: 'https://ntfy.sh', topic: '' } };
const DEFAULT_VEHICLES = [{ id: 'micro', name: 'micro', owner: 'Lester', ownerEmail: 'lester@ovanova.co', model: 'Tesla Model Y Dual Motor', vin: '7SAYGDEE4RA246655' }];
const ALLOWED_DOMAIN = 'ovanova.co';
const allowedEmail = (email, verified) => verified !== false && typeof email === 'string' && email.toLowerCase().endsWith('@' + ALLOWED_DOMAIN) && !email.slice(0, -ALLOWED_DOMAIN.length - 1).includes('@');
const K = { users: 'users', user: e => 'user:' + e, tesla: e => 'tesla:' + e, veh: e => 'vehicles:' + e, trips: e => 'trips:' + e, det: (e, v) => `det:${e}:${v}`, sched: e => 'sched:' + e, sent: e => 'sent:' + e, lock: e => 'lock:send:' + e };
const merge = (d, s = {}) => ({ ...d, ...s, sugar: { ...d.sugar, ...(s.sugar || {}) }, weekEnd: { ...d.weekEnd, ...(s.weekEnd || {}) }, ntfy: { ...d.ntfy, ...(s.ntfy || {}) } });

class WebService {
  constructor({ db, env = process.env, transport, tesla, fetch: f = globalThis.fetch, now = () => new Date(), baseUrl, retryBaseMs = 1500 }) {
    Object.assign(this, { db, env, transport, tesla, fetch: f, now, retryBaseMs });
    this.baseUrl = (baseUrl || env.PUBLIC_URL || 'https://ovanova-mileage-tesla.vercel.app').replace(/\/$/, '');
  }
  // ---- accounts
  async signIn({ email, name, sub }) {
    email = email.toLowerCase(); if (!allowedEmail(email)) throw new HttpError(403, 'Only @ovanova.co Google accounts can sign in');
    const u = (await this.db.get(K.user(email))) || { email, createdAt: this.now().toISOString(), settings: {} };
    Object.assign(u, { name: name || u.name || email, sub, lastLoginAt: this.now().toISOString() });
    await this.db.set(K.user(email), u); await this.db.sadd(K.users, email);
    if (!(await this.db.get(K.veh(email)))) await this.db.set(K.veh(email), DEFAULT_VEHICLES.filter(v => v.ownerEmail === email).map(v => ({ ...v, connected: false })));
    return u;
  }
  async user(email) { return this.db.get(K.user(email)); }
  async settings(email) { const u = await this.user(email); return merge(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), u && u.settings); }
  async saveSettings(email, s) {
    const u = await this.user(email); const cur = (u && u.settings) || {}, out = {};
    if (s.signature != null) out.signature = String(s.signature).slice(0, 2000);
    if (s.rate !== undefined) out.rate = s.rate ? Number(s.rate) : null;
    if (s.sugar) out.sugar = { ...(cur.sugar || {}), ...(s.sugar.to != null ? { to: String(s.sugar.to).trim() } : {}), ...(s.sugar.cc != null ? { cc: String(s.sugar.cc).trim() } : {}) };
    if (s.weekEnd) out.weekEnd = { day: Math.max(0, Math.min(6, Number(s.weekEnd.day ?? 5))), time: /^\d\d:\d\d$/.test(s.weekEnd.time) ? s.weekEnd.time : '17:00' };
    if (s.ntfy) out.ntfy = { server: s.ntfy.server || 'https://ntfy.sh', topic: String(s.ntfy.topic || '').trim() };
    u.settings = { ...cur, ...out }; await this.db.set(K.user(email), u); return this.settings(email);
  }
  vehicles(email) { return this.db.get(K.veh(email)).then(v => v || []); }
  trips(email) { return this.db.get(K.trips(email)).then(t => t || []); }
  async state(email) {
    const [u, settings, vehicles, trips, tl] = await Promise.all([this.user(email), this.settings(email), this.vehicles(email), this.trips(email), this.db.get(K.tesla(email))]);
    return { user: { email, name: u && u.name }, settings, vehicles, teslaConnected: !!(tl && tl.refreshToken), teslaError: tl && tl.error,
      trips: trips.sort((a, b) => b.startTime.localeCompare(a.startTime)), nextBatch: this.nextBatch(settings).toISOString(), smtpConfigured: !!this.env.SMTP_HOST };
  }
  nextBatch(s) { const d = lastWeekly(this.now(), s.weekEnd.day, s.weekEnd.time); d.setTime(d.getTime() + 7 * 86400000);
    return lastWeekly(new Date(d.getTime() + 60000), s.weekEnd.day, s.weekEnd.time); }

  // ---- Tesla link
  async linkTesla(email, login) {
    await this.db.set(K.tesla(email), { ...login, linkedAt: this.now().toISOString() });
    const r = await this.tesla.call(login, '/api/1/vehicles'); if (r.login.refreshed) await this.db.set(K.tesla(email), r.login);
    const cars = r.data || [], vs = await this.vehicles(email);
    for (const c of cars) { const v = vs.find(x => x.vin === c.vin);
      if (v) Object.assign(v, { teslaId: c.id, connected: true, name: v.name || c.display_name });
      else vs.push({ id: 'v' + String(c.vin).slice(-6), name: c.display_name || 'Tesla', owner: (await this.user(email)).name.split(' ')[0], ownerEmail: email, model: 'Tesla', vin: c.vin, teslaId: c.id, connected: true }); }
    await this.db.set(K.veh(email), vs); return vs;
  }

  // Fresh access token for whichever signed-in user owns this VIN (refreshes and saves when near expiry).
  async accessTokenForVin(vin) {
    for (const e of await this.db.smembers(K.users)) {
      if (!(await this.vehicles(e)).some(v => v.vin === vin)) continue;
      let login = await this.db.get(K.tesla(e)); if (!login || !login.refreshToken) continue;
      const r = await this.tesla.call(login, '/api/1/vehicles/' + vin); // vehicle summary only; never wakes the car
      if (r.login.refreshed) { login = { ...r.login }; delete login.refreshed; delete login.error; await this.db.set(K.tesla(e), login); }
      return { vin, email: e, accessToken: r.login.accessToken, expiresAt: r.login.expiresAt, scope: login.scope || null, state: r.data && r.data.state };
    }
    throw new HttpError(404, 'no connected user for that VIN');
  }

  // ---- polling (called by the scheduler every few minutes)
  async pollAll() {
    const out = []; for (const email of await this.db.smembers(K.users)) {
      try { out.push({ email, ...(await this.pollUser(email)) }); } catch (e) { out.push({ email, error: e.message }); }
      try { const sent = await this.tick(email); if (sent.length) out.push({ email, sent }); } catch (e) { out.push({ email, sendError: e.message }); }
    } return out;
  }
  async pollUser(email) {
    let login = await this.db.get(K.tesla(email)); if (!login || !login.refreshToken) return { skipped: 'tesla not connected' };
    const ended = [], states = {};
    for (const v of (await this.vehicles(email)).filter(v => v.connected && v.vin)) {
      let r; try { r = await this.tesla.snapshot(login, v.vin, this.now()); }
      catch (e) { if (e.status === 401) await this.db.set(K.tesla(email), { ...login, error: e.message }); states[v.id] = 'error: ' + e.message; continue; }
      if (r.login !== login) { login = r.login; if (login.refreshed) { delete login.refreshed; delete login.error; await this.db.set(K.tesla(email), login); } }
      states[v.id] = r.state; if (!r.snap) continue;
      const st = (await this.db.get(K.det(email, v.id))) || {}, det = new C.TripDetector(); det.active = st.active || null; det.last = st.last || null;
      const ev = det.feed(r.snap);
      await this.db.set(K.det(email, v.id), { active: det.active, last: det.last });
      if (ev && ev.event === 'end') { const t = await this.onTripEnd(email, v, ev.trip); if (t) ended.push(t.id); }
    }
    return { ended, states };
  }
  async onTripEnd(email, vehicle, trip) {
    const trips = await this.trips(email);
    trip = { ...trip, id: vehicle.id + ':' + trip.id, vehicleId: vehicle.id, driver: vehicle.owner };
    if (trips.some(t => t.id === trip.id)) return null;
    trip.notifiedAt = this.now().toISOString(); trips.push(trip); await this.db.set(K.trips(email), trips);
    await this.pushNtfy(email, vehicle, trip).catch(e => { trip.pushError = e.message; });
    return trip;
  }
  actionUrl(email, tripId, a) { return `${this.baseUrl}/api/act?t=${encodeURIComponent(sign({ e: email, id: tripId, a }, this.env.SESSION_SECRET, 14 * 86400, this.now().getTime()))}`; }
  ntfyMessage(email, vehicle, trip) { // ntfy allows 3 action buttons: Yes-Send now, Yes-Batch (end of week), No (personal)
    return { headers: { Title: `${vehicle.name}: trip ended (${trip.miles} mi)`, Tags: 'car', Click: this.baseUrl + '/#trips',
      Actions: [`http, Yes - Send now, ${this.actionUrl(email, trip.id, 'send')}, method=POST, clear=true`,
        `http, Yes - Batch Friday, ${this.actionUrl(email, trip.id, 'batch')}, method=POST, clear=true`,
        `http, No - Personal, ${this.actionUrl(email, trip.id, 'personal')}, method=POST, clear=true`].join('; ') },
      body: `Business trip? ${C.routeOf(trip)}. Yes: send to Sugar now, or batch it for Friday 5 PM. No: personal.` };
  }
  async pushNtfy(email, vehicle, trip) {
    const n = (await this.settings(email)).ntfy, topic = vehicle.ntfyTopic || n.topic; if (!topic) return false;
    const m = this.ntfyMessage(email, vehicle, trip);
    await withRetry(async () => { const r = await this.fetch(n.server.replace(/\/$/, '') + '/' + encodeURIComponent(topic), { method: 'POST', headers: m.headers, body: m.body });
      if (!r.ok) throw new HttpError(r.status, 'ntfy ' + r.status); }, { tries: 3, baseMs: this.retryBaseMs, retryable: e => !(e instanceof HttpError) || e.status === 429 || e.status >= 500 });
    return true;
  }

  // ---- tagging / queue / send
  async tag(email, id, category, purpose, route) {
    if (!['business', 'personal', null].includes(category)) throw new HttpError(400, 'bad category');
    const trips = await this.trips(email), t = trips.find(x => x.id === id); if (!t) throw new HttpError(404, 'No such trip');
    if (t.reimbursedAt && category !== 'business') throw new HttpError(409, 'Already sent to Sugar');
    t.category = category; if (category !== 'business') delete t.queuedAt;
    if (purpose != null) t.purpose = String(purpose).slice(0, 300); if (route) t.route = String(route).slice(0, 300);
    await this.db.set(K.trips(email), trips); return t;
  }
  async queue(email, ids) { const trips = await this.trips(email); let n = 0;
    for (const t of trips) if (ids.includes(t.id) && !t.reimbursedAt) { t.category = 'business'; t.queuedAt = t.queuedAt || this.now().toISOString(); n++; }
    await this.db.set(K.trips(email), trips); return n; }
  async unqueue(email, ids) { const trips = await this.trips(email); trips.forEach(t => { if (ids.includes(t.id)) delete t.queuedAt; }); await this.db.set(K.trips(email), trips); }
  async addManual(email, { date, miles, purpose, route, vehicleId }) {
    const m = Number(miles); if (!(m > 0 && m < 2000) || !/^\d{4}-\d\d-\d\d$/.test(date || '')) throw new HttpError(400, 'Enter a date and miles');
    const trips = await this.trips(email), ts = new Date(date + 'T12:00:00Z').toISOString();
    const t = { id: 'manual:' + crypto.randomBytes(6).toString('hex'), source: 'manual', vehicleId: vehicleId || null, startTime: ts, endTime: ts, startOdo: null, endOdo: null,
      miles: Math.round(m * 10) / 10, startLoc: null, endLoc: null, route: route || undefined, category: 'business', purpose: purpose || '' };
    trips.push(t); await this.db.set(K.trips(email), trips); return t;
  }
  async build(email, list) {
    const s = await this.settings(email), u = await this.user(email), vs = await this.vehicles(email);
    const mail = C.sugarEmail(list, vs, u, { rate: s.rate, signature: s.signature || undefined });
    const from = list.map(t => t.startTime).sort()[0].slice(0, 10), to = list.map(t => t.endTime).sort().pop().slice(0, 10);
    const rep = C.buildReport(list, from, to, s.rate, true);
    const doc = `<!doctype html><meta charset="utf-8"><title>${mail.subject.replace(/</g, '&lt;')}</title><body style="font-family:Arial,sans-serif">${mail.captureHtml}${C.reportHtml(rep)}</body>`;
    return { ...mail, s, u, attachments: [{ filename: `odometer-captures-${from}_${to}.html`, content: doc, contentType: 'text/html' },
      { filename: `mileage-report-${from}_${to}.csv`, content: C.reportCsv(rep), contentType: 'text/csv' }] };
  }
  async preview(email, ids) { const list = (await this.trips(email)).filter(t => ids.includes(t.id) && t.category === 'business');
    if (!list.length) throw new HttpError(400, 'Pick at least one business trip'); const m = await this.build(email, list); return { subject: m.subject, text: m.text, to: m.s.sugar.to }; }
  // Double-submit guard: storage lock per account; only unsent business trips; marked right after SMTP accepts.
  async send(email, ids, reason = 'manual') {
    if (!(await this.db.setnx(K.lock(email), 1, 120))) throw new HttpError(409, 'A send is already in progress');
    try {
      const s = await this.settings(email); if (!s.sugar.to) throw new HttpError(400, 'Set the Sugar recipient in Settings');
      if (!this.transport) throw new HttpError(503, 'Email is not configured on the server (SMTP_* env)');
      const list = (await this.trips(email)).filter(t => ids.includes(t.id) && t.category === 'business' && !t.reimbursedAt);
      if (!list.length) throw new HttpError(400, 'No unsent business trips selected');
      const m = await this.build(email, list), u = m.u, fromAddr = this.env.SMTP_FROM || this.env.SMTP_USER;
      const self = u.email.toLowerCase() === String(fromAddr).toLowerCase();
      const info = await withRetry(() => this.transport.sendMail({ from: self ? `${u.name} <${fromAddr}>` : `${u.name} via Mileage Tracker <${fromAddr}>`,
        replyTo: self ? undefined : u.email, to: s.sugar.to, cc: [s.sugar.cc, self ? '' : u.email].filter(Boolean).join(', ') || undefined,
        subject: m.subject, text: m.text, html: m.html, attachments: m.attachments }),
        { tries: 3, baseMs: this.retryBaseMs, retryable: e => !(e.responseCode >= 500 || /auth|Invalid login/i.test(e.message)) });
      const sentAt = this.now().toISOString(), all = await this.trips(email);
      for (const t of all) if (list.some(x => x.id === t.id)) { t.reimbursedAt = sentAt; t.sentMessageId = info.messageId; delete t.queuedAt; }
      await this.db.set(K.trips(email), all);
      const log = (await this.db.get(K.sent(email))) || []; log.push({ sentAt, reason, to: s.sugar.to, subject: m.subject, tripIds: list.map(t => t.id), messageId: info.messageId });
      await this.db.set(K.sent(email), log.slice(-200));
      return { count: list.length, to: s.sugar.to, subject: m.subject, miles: m.miles, amount: m.amount };
    } finally { await this.db.del(K.lock(email)); }
  }
  // End-of-week batch: once per scheduled moment (default Friday 17:00 Central); catches up if the scheduler was late.
  async tick(email) {
    const s = await this.settings(email), now = this.now(), st = (await this.db.get(K.sched(email))) || {};
    const due = lastWeekly(now, s.weekEnd.day, s.weekEnd.time);
    const queued = (await this.trips(email)).filter(t => t.queuedAt && !t.reimbursedAt && new Date(t.queuedAt) <= due);
    if (!queued.length || (st.lastWeekEnd && st.lastWeekEnd >= due.toISOString())) return [];
    const r = await this.send(email, queued.map(t => t.id), 'week'); st.lastWeekEnd = due.toISOString(); await this.db.set(K.sched(email), st); return [r];
  }
  async act(email, id, a) { // from ntfy buttons / emailed links
    if (a === 'personal') return { trip: await this.tag(email, id, 'personal'), done: 'Marked personal' };
    await this.tag(email, id, 'business');
    if (a === 'batch') { await this.queue(email, [id]); return { done: 'Queued for the end-of-week email' }; }
    if (a === 'send') return { done: 'Sent to Sugar', result: await this.send(email, [id], 'push') };
    throw new HttpError(400, 'bad action');
  }
}
module.exports = { WebService, allowedEmail, DEFAULT_SETTINGS, K };
