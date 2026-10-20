// Account-scoped data + trip/notification/sending logic. No Electron imports, so it is testable in plain Node.
const fs = require('fs'), path = require('path');
const C = require('./core');
const { withRetry, HttpError } = require('./retry');

class Store {
  constructor(dir) { this.dir = dir; fs.mkdirSync(dir, { recursive: true }); }
  load(n, d) { try { return JSON.parse(fs.readFileSync(path.join(this.dir, n), 'utf8')); } catch { return d; } }
  save(n, v) { const f = path.join(this.dir, n); fs.writeFileSync(f + '.tmp', JSON.stringify(v, null, 2)); fs.renameSync(f + '.tmp', f); }
}

const DEFAULT_SETTINGS = {
  rate: null, signature: '',
  sugar: { enabled: true, to: '', cc: '' },            // "Send mileage to Sugar" destination (email); recipient prefilled from app-config
  weekEnd: { day: 5, time: '17:00' },                  // queued trips go out Friday 17:00 local by default
  autoSchedule: 'off',                                 // off | weekly | monthly: send all unsent business trips of the period (opt-in)
  smtp: { host: '', port: 587, secure: false, user: '', pass: '', from: '' },
  ntfy: { server: 'https://ntfy.sh', topic: '' },        // optional phone push via ntfy (free, self-hostable); topic per owner
};

class AccountService {
  constructor({ dir, user, appConfig = {}, notify = () => {}, renderPdf, transport, env = process.env, now = () => new Date(), fetch: f = globalThis.fetch, retryBaseMs }) {
    this.fetch = f; this.retryBaseMs = retryBaseMs;
    this.store = new Store(dir); this.user = user; this.appConfig = appConfig; this.notify = notify;
    this.renderPdf = renderPdf; this.transport = transport; this.env = env; this.now = now; this.sending = false;
    if (!this.store.load('vehicles.json', null)) this.store.save('vehicles.json', this.defaultVehicles());
  }
  defaultVehicles() { // vehicles bundled in app-config for this account's email (e.g. Lester's Model Y "micro")
    return (this.appConfig.defaultVehicles || []).filter(v => !v.ownerEmail || v.ownerEmail.toLowerCase() === (this.user.email || '').toLowerCase())
      .map((v, i) => ({ id: v.id || 'v' + (i + 1), name: v.name, owner: v.owner || this.user.name, ownerEmail: v.ownerEmail || this.user.email,
        model: v.model || 'Tesla', vin: v.vin || '', source: v.source || 'fleet', teslaLogin: null, isDefault: i === 0 }));
  }
  settings() { const s = this.store.load('settings.json', {}), d = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    const m = { ...d, ...s, sugar: { ...d.sugar, ...(s.sugar || {}) }, ntfy: { ...d.ntfy, ...(s.ntfy || {}) }, weekEnd: { ...d.weekEnd, ...(s.weekEnd || {}) }, smtp: { ...d.smtp, ...(s.smtp || {}) } };
    if (!m.sugar.to) m.sugar.to = (this.appConfig.sugar && this.appConfig.sugar.to) || '';
    const e = this.env; // env overrides for secrets
    m.smtp = { ...m.smtp, host: e.SMTP_HOST || m.smtp.host, port: Number(e.SMTP_PORT || m.smtp.port), user: e.SMTP_USER || m.smtp.user,
      pass: e.SMTP_PASS || m.smtp.pass, from: e.SMTP_FROM || m.smtp.from, secure: e.SMTP_SECURE ? e.SMTP_SECURE === 'true' : m.smtp.secure };
    return m; }
  saveSettings(s) { const cur = this.store.load('settings.json', {}); if (s.smtp && s.smtp.pass === '••••') delete s.smtp.pass;
    this.store.save('settings.json', { ...cur, ...s, smtp: { ...(cur.smtp || {}), ...(s.smtp || {}) }, sugar: { ...(cur.sugar || {}), ...(s.sugar || {}) }, weekEnd: { ...(cur.weekEnd || {}), ...(s.weekEnd || {}) }, ntfy: { ...(cur.ntfy || {}), ...(s.ntfy || {}) } }); }
  vehicles() { return this.store.load('vehicles.json', []); }
  saveVehicles(v) { this.store.save('vehicles.json', v); }
  trips() { return this.store.load('trips.json', []); }
  saveTrips(t) { this.store.save('trips.json', t); }

  // Called for every completed trip from any vehicle: store it and notify the car's owner exactly once.
  onTripEnd(vehicle, trip) {
    const trips = this.trips();
    trip = { ...trip, id: vehicle.id + ':' + trip.id, vehicleId: vehicle.id, driver: vehicle.owner || this.user.name };
    if (trips.some(t => t.id === trip.id)) return null;
    trip.notifiedAt = this.now().toISOString(); trips.push(trip); this.saveTrips(trips);
    this.notify({ to: { name: vehicle.owner, email: vehicle.ownerEmail }, vehicle, trip });
    this.pushNtfy(vehicle, trip).catch(e => { this.lastPushError = e.message; });
    return trip;
  }
  async pushNtfy(vehicle, trip) { // phone push to the car owner's ntfy topic (vehicle.ntfyTopic or account default)
    const n = this.settings().ntfy, topic = vehicle.ntfyTopic || n.topic; if (!topic || !this.fetch) return false;
    await withRetry(async () => { const r = await this.fetch(n.server.replace(/\/$/, '') + '/' + encodeURIComponent(topic), { method: 'POST',
        headers: { Title: `${vehicle.name}: trip ended (${trip.miles} mi)`, Tags: 'car', Actions: 'view, Open Mileage Tracker, mileage://trip' },
        body: `${vehicle.owner || ''}, was this a business trip? Open the app: Send now or Wait till end of week.` });
      if (!r.ok) throw new HttpError(r.status, 'ntfy ' + r.status); }, { tries: 3, baseMs: this.retryBaseMs ?? 2000, retryable: e => !(e instanceof HttpError) || e.status === 429 || e.status >= 500 });
    return true;
  }
  tag(id, category, purpose, route) { const trips = this.trips(), t = trips.find(x => x.id === id); if (!t) throw new Error('No such trip');
    t.category = category; if (purpose != null) t.purpose = purpose; if (route) t.route = route; this.saveTrips(trips); return t; }
  queue(ids) { const trips = this.trips(); let n = 0;
    for (const t of trips) if (ids.includes(t.id) && !t.reimbursedAt) { t.category = 'business'; t.queuedAt = t.queuedAt || this.now().toISOString(); n++; }
    this.saveTrips(trips); return n; }
  unqueue(ids) { const trips = this.trips(); trips.forEach(t => { if (ids.includes(t.id)) delete t.queuedAt; }); this.saveTrips(trips); }

  async build(tripList, opts = {}) {
    const s = this.settings(), mail = C.sugarEmail(tripList, this.vehicles(), this.user, { rate: s.rate, signature: s.signature || undefined, ...opts });
    const from = tripList.map(t => t.startTime).sort()[0].slice(0, 10), to = tripList.map(t => t.endTime).sort().pop().slice(0, 10);
    const rep = C.buildReport(tripList, from, to, s.rate, true);
    const attachments = [{ filename: `odometer-captures-${from}_${to}.pdf`, content: await this.renderPdf(mail.captureHtml + C.reportHtml(rep)), contentType: 'application/pdf' },
      { filename: `mileage-report-${from}_${to}.csv`, content: C.reportCsv(rep), contentType: 'text/csv' }];
    return { ...mail, attachments, recipients: s.sugar.to, cc: s.sugar.cc, from: s.smtp.from || s.smtp.user };
  }
  // Double-submit guard: only business trips not yet reimbursed, one send at a time, marked right after the SMTP server accepts.
  async send(ids, reason) {
    if (this.sending) throw new Error('A send is already in progress'); this.sending = true;
    try {
      const s = this.settings(); if (!s.sugar.to) throw new Error('Set the Sugar recipient in Settings');
      if (!s.smtp.host) throw new Error('Set up SMTP in Settings (or SMTP_* env vars)');
      const list = this.trips().filter(t => ids.includes(t.id) && t.category === 'business' && !t.reimbursedAt);
      if (!list.length) throw new Error('Nothing to send: these trips were already submitted or are not business trips');
      const m = await this.build(list, reason === 'week' ? { title: 'Weekly Business' } : {});
      const info = await withRetry(() => this.transport(s.smtp).sendMail({ from: m.from, to: m.recipients, cc: m.cc || undefined, subject: m.subject, text: m.text, html: m.html, attachments: m.attachments }),
        { tries: 3, baseMs: this.retryBaseMs ?? 2000, retryable: e => e.code !== 'EAUTH' && !(e.responseCode >= 500) }) // retry network errors and 4xx temporary failures only
        .catch(e => { throw new Error(e.code === 'EAUTH' ? 'SMTP login failed: check user / app password' : 'Email not sent: ' + e.message); });
      const sentAt = this.now().toISOString(), all = this.trips();
      for (const t of all) if (list.some(x => x.id === t.id)) { t.reimbursedAt = sentAt; t.sentMessageId = info.messageId; delete t.queuedAt; }
      this.saveTrips(all);
      const log = this.store.load('sent.json', []); log.push({ sentAt, reason, to: m.recipients, subject: m.subject, tripIds: list.map(t => t.id), messageId: info.messageId });
      this.store.save('sent.json', log);
      return { count: list.length, to: m.recipients, subject: m.subject, miles: m.miles, amount: m.amount };
    } finally { this.sending = false; }
  }
  unsentBusiness(from, to) { return this.trips().filter(t => t.category === 'business' && !t.reimbursedAt && (!from || t.startTime.slice(0, 10) >= from) && (!to || t.startTime.slice(0, 10) <= to)); }

  // Called every minute. Sends the end-of-week queue once per week, and the optional auto schedule once per period.
  async tick() {
    const s = this.settings(), now = this.now(), st = this.store.load('schedule.json', {}), out = [];
    const [hh, mm] = s.weekEnd.time.split(':').map(Number);
    const due = new Date(now); due.setDate(due.getDate() - ((now.getDay() - s.weekEnd.day + 7) % 7)); due.setHours(hh, mm, 0, 0);
    if (due > now) due.setDate(due.getDate() - 7);           // most recent scheduled moment
    const queued = this.trips().filter(t => t.queuedAt && !t.reimbursedAt && new Date(t.queuedAt) <= due);
    if (queued.length && (!st.lastWeekEnd || st.lastWeekEnd < due.toISOString())) {
      out.push(await this.send(queued.map(t => t.id), 'week')); st.lastWeekEnd = due.toISOString(); this.store.save('schedule.json', st);
    }
    const p = C.duePeriod(s.autoSchedule, st.lastAutoPeriodEnd, now);
    if (p) { const list = this.unsentBusiness(p.from, p.to); if (list.length) out.push(await this.send(list.map(t => t.id), s.autoSchedule));
      st.lastAutoPeriodEnd = p.to; this.store.save('schedule.json', st); }
    return out;
  }
}
module.exports = { AccountService, DEFAULT_SETTINGS };
