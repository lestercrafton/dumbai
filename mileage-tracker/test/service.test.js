const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), nodemailer = require('nodemailer');
const { AccountService } = require('../src/service'), { Simulator, Poller, TripDetector } = { ...require('../src/tesla'), ...require('../src/core') }, { startCatcher } = require('./smtp-catcher');
const appConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'app-config.json')));
let passed = 0; const it = async (n, f) => { await f(); passed++; console.log('  ✓ ' + n); };
const mk = (extra = {}) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-')), notes = [];
  const svc = new AccountService({ dir, user: { sub: 'g1', email: 'lester@ovanova.co', name: 'Lester Crafton' }, appConfig, env: {}, retryBaseMs: 1, fetch: null,
    notify: n => notes.push(n), renderPdf: async html => Buffer.from('%PDF-stub ' + html.length), transport: s => nodemailer.createTransport({ host: s.host, port: s.port, secure: false }), ...extra });
  return { svc, notes }; };
(async () => {
  await it('micro pre-configured for Lester only', () => { const v = mk().svc.vehicles(); assert.equal(v[0].name, 'micro'); assert.equal(v[0].vin, '7SAYGDEE4RA246655'); assert.equal(v[0].owner, 'Lester'); });
  await it('10 simulated trips -> exactly 10 notifications, each to the car owner, no dedupe/min distance', async () => {
    const { svc, notes } = mk(); const cars = [{ id: 'micro', name: 'micro', owner: 'Lester' }, { id: 'c', name: 'Chris car', owner: 'Chris' }, { id: 'j', name: 'John car', owner: 'John' }];
    const ended = [], ps = cars.map((v, i) => { const p = new Poller(new Simulator(1000 * (i + 1), i === 2 ? 1 : 3), e => { if (e.event === 'end' && ended.length < 10) { ended.push(e); svc.onTripEnd(v, e.trip); } }, 2); p.fastMs = 2; return p; });
    ps.forEach(p => p.start()); await new Promise(r => { const i = setInterval(() => { if (ended.length >= 10) { clearInterval(i); r(); } }, 1); }); ps.forEach(p => p.stop());
    assert.equal(ended.length, 10); assert.equal(notes.length, 10); assert.equal(svc.trips().length, 10); assert.equal(new Set(notes.map(x => x.trip.id)).size, 10);
    for (const x of notes) assert.equal(x.to.name, cars.find(c => c.id === x.vehicle.id).owner);
    assert(notes.some(x => x.trip.miles === 1.5), 'short 1.5 mi trip notified');
    const before = notes.length; svc.onTripEnd(cars[0], { ...notes[0].trip, id: notes[0].trip.id.split(':')[1] }); assert.equal(notes.length, before, 'same trip never notified twice');
  });
  await it('missed short drive between parked polls is inferred, recorded and notified', () => {
    const { svc, notes } = mk(); const d = new TripDetector(), v = { id: 'micro', name: 'micro', owner: 'Lester' };
    for (const [s, o, i] of [['P', 500, 1], ['P', 500.3, 2]]) { const e = d.feed({ ts: `2026-10-0${i}T10:00:00Z`, odometer: o, shift_state: s }); if (e && e.event === 'end') svc.onTripEnd(v, e.trip); }
    assert.equal(notes.length, 1); assert.equal(notes[0].trip.miles, 0.3); assert(notes[0].trip.inferred); });
  const cat = await startCatcher(2526, fs.mkdtempSync(path.join(os.tmpdir(), 'mail-')));
  let now = new Date('2026-10-14T09:00:00'); const { svc } = mk({ now: () => now }); svc.saveSettings({ smtp: { host: '127.0.0.1', port: 2526, from: 'lester@ovanova.co' }, signature: 'Thanks,\nLester' });
  const v = svc.vehicles()[0], T = (i, d, so, eo, route) => svc.onTripEnd(v, { id: 'x' + i, source: 'tesla', startTime: d + 'T13:00:00.000Z', endTime: d + 'T17:00:00.000Z', startOdo: so, endOdo: eo, miles: eo - so, route });
  const a = T(1, '2026-10-08', 89005, 89310, '755 Mount Moriah Rd, Memphis, TN → Ovanova HQ, Dunlap, TN'), b = T(2, '2026-10-09', 89310, 89320, 'Ovanova HQ → Dunlap, TN → Ovanova HQ'), c = T(3, '2026-10-10', 89320, 89621, 'Ovanova HQ → 755 Mount Moriah Rd, Memphis, TN');
  svc.tag(a.id, 'business', 'Drive to HQ for the Friday team meeting'); svc.tag(b.id, 'business', 'Food pickup in Dunlap for the Friday meeting'); svc.tag(c.id, 'business', 'Return home after the trip');
  await it('Send now emails Sugar immediately with PDF + CSV, then marks reimbursed', async () => {
    const r = await svc.send([a.id], 'now'); assert.equal(r.count, 1); assert.equal(cat.got.length, 1); const m = cat.got[0];
    assert.equal(m.to, 'sugar@ovanova.co'); assert.equal(m.subject, 'Mileage Reimbursement Request – Oct 8, 2026 Drive to HQ for the Friday team meeting Trip (305 miles / $231.80)');
    assert(m.text.includes('Tesla Model Y Dual Motor · VIN 7SAYGDEE4RA246655') && m.text.includes('Thanks,\nLester'));
    assert.deepEqual(m.attachments.map(x => x.contentType).sort(), ['application/pdf', 'text/csv']); assert(svc.trips().find(t => t.id === a.id).reimbursedAt); });
  await it('double-submit guard: resend and re-queue of a sent trip are refused', async () => {
    await assert.rejects(svc.send([a.id], 'now'), /already submitted/); assert.equal(cat.got.length, 1); assert.equal(svc.queue([a.id, b.id, c.id]), 2); });
  await it('Friday 17:00 batch (fake clock): nothing before, one merged email after, once', async () => {
    assert.deepEqual(await svc.tick(), []); now = new Date('2026-10-16T16:59:00'); assert.deepEqual(await svc.tick(), []);
    now = new Date('2026-10-16T17:01:00'); const w = await svc.tick(); assert.equal(w.length, 1); assert.equal(w[0].count, 2); assert.equal(cat.got.length, 2);
    const m = cat.got[1]; assert.equal(m.subject, 'Mileage Reimbursement Request – Oct 9–10, 2026 Weekly Business Trips (311 miles / $236.36)');
    assert(m.text.includes('| 10/9/2026 | Ovanova HQ → Dunlap, TN → Ovanova HQ | Food pickup in Dunlap for the Friday meeting | 10 mi |'));
    assert(m.text.includes('| Ending odometer reading (Sat 10/10) | 89,621 |') && m.text.includes('| Starting odometer reading (Fri 10/9) | 89,310 |') && m.text.includes('| Total business miles | 311 |'));
    now = new Date('2026-10-16T17:30:00'); assert.deepEqual(await svc.tick(), []); fs.writeFileSync('/tmp/mt-sample-weekly-email.txt', m.subject + '\n\n' + m.text); });
  await it('configurable week-end (Sunday 09:00)', async () => { const { svc: s } = mk({ now: () => now }); s.saveSettings({ weekEnd: { day: 0, time: '09:00' }, smtp: { host: '127.0.0.1', port: 2526 } });
    const t = s.onTripEnd(s.vehicles()[0], { id: 'w', source: 'tesla', startTime: '2026-10-16T13:00:00Z', endTime: '2026-10-16T14:00:00Z', startOdo: 1, endOdo: 2, miles: 1 }); s.tag(t.id, 'business', 'x'); s.queue([t.id]);
    now = new Date('2026-10-18T08:59:00'); assert.deepEqual(await s.tick(), []); now = new Date('2026-10-18T09:00:30'); assert.equal((await s.tick())[0].count, 1); });
  await it('auto schedule off by default; monthly opt-in sends only unsent trips', async () => {
    const d = T(4, '2026-10-12', 89621, 89650, 'Client'); svc.tag(d.id, 'business', 'Client visit'); now = new Date('2026-11-01T09:00:00'); const n0 = cat.got.length;
    assert.deepEqual(await svc.tick(), []); svc.saveSettings({ autoSchedule: 'monthly' }); assert.equal((await svc.tick())[0].count, 1); assert.equal(cat.got.length, n0 + 1); });
  await cat.close(); console.log(`service tests: ${passed} passed, 0 failed (all mail to local catcher)`);
})().catch(e => { console.error(e); process.exit(1); });
