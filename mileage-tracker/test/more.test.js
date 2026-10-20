// Sugar format vs Lester's two real emails, restart-resume queue, multi-user scoping, retry/backoff.
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), nodemailer = require('nodemailer');
const C = require('../src/core'), { AccountService } = require('../src/service'), { withRetry } = require('../src/retry'), { FleetApi } = require('../src/tesla');
const { startCatcher } = require('./smtp-catcher');
const appConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'app-config.json')));
const micro = { id: 'micro', name: 'micro', model: 'Tesla Model Y Dual Motor', vin: '7SAYGDEE4RA246655' }, lester = { name: 'Lester Crafton' };
let passed = 0; const it = async (n, f) => { await f(); passed++; console.log('  ✓ ' + n); };
const mk = (dir, user, extra = {}) => new AccountService({ dir, user, appConfig, env: {}, retryBaseMs: 1, renderPdf: async () => Buffer.from('%PDF-stub'),
  transport: s => nodemailer.createTransport({ host: s.host, port: s.port, secure: false }), ...extra });
(async () => {
  await it('Sugar format: Dunlap HQ example (Oct 8–10, 616 mi / $468.16)', () => {
    const t = { vehicleId: 'micro', startTime: '2026-10-08T14:00:00', endTime: '2026-10-10T20:00:00', startOdo: 89005, endOdo: 89621, miles: 616, purpose: 'Dunlap HQ',
      route: '755 Mount Moriah Rd, Memphis, TN → Ovanova HQ, 13650 State Route 8, Dunlap, TN (via I-840)' };
    const m = C.sugarEmail([t], [micro], lester, { signature: 'Thanks,\nLester' });
    assert.equal(m.subject, 'Mileage Reimbursement Request – Oct 8–10, 2026 Dunlap HQ Trip (616 miles / $468.16)');
    for (const l of ['Sugar,', '**Trip dates**', 'Departed 10/8/2026 · Returned 10/10/2026', '**Route and business purpose**', '**Vehicle**', 'Tesla Model Y Dual Motor · VIN 7SAYGDEE4RA246655',
      '**Odometer and calculation**', '| Ending odometer reading (Sat 10/10) | 89,621 |', '| Starting odometer reading (Thu 10/8) | 89,005 |', '| Total business miles | 616 |',
      '| IRS standard business mileage rate | × $0.76 |', '| Total reimbursement requested | $468.16 |', 'The $0.76/mile figure is the IRS standard business mileage rate in effect from July 1, 2026 through December 31, 2026',
      'Let me know if you need anything else to get this processed.', 'Thanks,\nLester']) assert(m.text.includes(l), 'missing: ' + l);
    const e = m.text.indexOf('Ending odometer'), s = m.text.indexOf('Starting odometer'); assert(e < s, 'ending listed before starting, as in the original');
  });
  await it('Sugar format: Sept 1–6 multi-stop example (1,725 mi / $1,311.00)', () => {
    const stops = ['Somerville, TN → Nashville, TN', 'Nashville, TN → McMinnville, TN', 'McMinnville, TN → Knoxville, TN', 'Knoxville, TN → Lewisburg, TN', 'Lewisburg, TN → Somerville, TN'];
    const miles = [345, 300, 400, 330, 350]; let odo = 84556;
    const trips = stops.map((r, i) => ({ vehicleId: 'micro', startTime: `2026-09-0${i + 1}T14:00:00`, endTime: `2026-09-0${i + 2}T01:00:00`, startOdo: odo, endOdo: odo += miles[i], miles: miles[i], route: r, purpose: 'meeting' }));
    const m = C.sugarEmail(trips, [micro], lester, { title: '' });
    assert.equal(m.subject, 'Mileage Reimbursement Request – Sept 1–6, 2026 Trip (1,725 miles / $1,311.00)');
    for (const l of ['Departed 9/1/2026 · Returned 9/6/2026', '| Ending odometer reading (Sun 9/6) | 86,281 |', '| Starting odometer reading (Tue 9/1) | 84,556 |', '| Total business miles | 1,725 |', '| Total reimbursement requested | $1,311.00 |'])
      assert(m.text.includes(l), 'missing: ' + l);
    assert.equal(m.text.split('\n').filter(l => /^\| 9\/\d\/2026 \| .* → /.test(l)).length, 5, 'one route row per stop');
    assert(m.captureHtml.split('<tr>').length - 2 === 10, 'odometer capture lists start+end of every trip');
  });
  await it('mixed H1/H2 2026 rates are itemised', () => {
    const m = C.sugarEmail([{ vehicleId: 'micro', startTime: '2026-06-30T10:00:00', endTime: '2026-06-30T11:00:00', startOdo: 1, endOdo: 11, miles: 10 },
      { vehicleId: 'micro', startTime: '2026-07-01T10:00:00', endTime: '2026-07-01T11:00:00', startOdo: 11, endOdo: 21, miles: 10 }], [micro], lester);
    assert(m.text.includes('| Miles at $0.725/mile | 10 |') && m.text.includes('| Miles at $0.76/mile | 10 |') && m.amount === 14.85); });

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-more-')), cat = await startCatcher(2527, path.join(root, 'mail'));
  await it('queue persists across restart and sends on next launch when Friday was missed', async () => {
    const dir = path.join(root, 'lester'), user = { sub: 'g1', email: 'lester@ovanova.co', name: 'Lester Crafton' };
    let a = mk(dir, user, { now: () => new Date('2026-10-14T10:00:00') }); a.saveSettings({ smtp: { host: '127.0.0.1', port: 2527, from: 'lester@ovanova.co' } });
    const t = a.onTripEnd(a.vehicles()[0], { id: 'r1', source: 'tesla', startTime: '2026-10-14T08:00:00Z', endTime: '2026-10-14T09:00:00Z', startOdo: 1, endOdo: 31, miles: 30 });
    a.tag(t.id, 'business', 'Client visit'); a.queue([t.id]); a = null;                         // app closed before Friday
    const b = mk(dir, user, { now: () => new Date('2026-10-19T08:00:00') });                    // relaunched Monday
    assert.equal(b.trips()[0].queuedAt != null, true, 'queue survived restart');
    const r = await b.tick(); assert.equal(r.length, 1); assert.equal(cat.got.length, 1); assert(b.trips()[0].reimbursedAt);
    assert.deepEqual(await mk(dir, user, { now: () => new Date('2026-10-19T09:00:00') }).tick(), [], 'not resent after another restart');
  });
  await it('multi-user scoping: Chris and John see only their own cars and trips; micro only in Lester\'s account', async () => {
    const chris = mk(path.join(root, 'chris'), { sub: 'g2', email: 'chris@ovanova.co', name: 'Chris' }), john = mk(path.join(root, 'john'), { sub: 'g3', email: 'john@ovanova.co', name: 'John' });
    assert.equal(chris.vehicles().length, 0); assert.equal(john.vehicles().length, 0);
    chris.saveVehicles([{ id: 'c1', name: "Chris's Tesla", owner: 'Chris', vin: 'VINC' }]);
    const n = []; const c2 = mk(path.join(root, 'chris'), { sub: 'g2', email: 'chris@ovanova.co', name: 'Chris' }, { notify: x => n.push(x) });
    c2.onTripEnd(c2.vehicles()[0], { id: 'z', source: 'tesla', startTime: '2026-10-19T08:00:00Z', endTime: '2026-10-19T08:10:00Z', startOdo: 5, endOdo: 6, miles: 1 });
    assert.equal(c2.trips().length, 1); assert.equal(john.trips().length, 0); assert.equal(n[0].to.name, 'Chris');
    assert.equal(mk(path.join(root, 'lester'), { sub: 'g1', email: 'lester@ovanova.co', name: 'Lester' }).trips().length, 1);
  });
  await it('ntfy push retries on 503 then succeeds; owner topic used', async () => {
    const calls = []; const s = mk(path.join(root, 'nt'), { sub: 'g4', email: 'x@y', name: 'X' }, { fetch: async (u, o) => { calls.push(u); return { ok: calls.length > 2, status: calls.length > 2 ? 200 : 503 }; } });
    s.saveSettings({ ntfy: { server: 'http://ntfy.local', topic: 'acct' } });
    assert.equal(await s.pushNtfy({ name: 'car', owner: 'John', ntfyTopic: 'john-car' }, { miles: 2 }), true); assert.equal(calls.length, 3); assert(calls[0].endsWith('/john-car'));
  });
  await it('SMTP: server down -> retried 3x then clear error, trips stay unsent', async () => {
    const s = mk(path.join(root, 'down'), { sub: 'g5', email: 'l@o', name: 'L' }); s.saveSettings({ smtp: { host: '127.0.0.1', port: 2599 }, sugar: { to: 'sugar@ovanova.co' } });
    s.saveVehicles([micro]); const t = s.onTripEnd(micro, { id: 'q', source: 'tesla', startTime: '2026-10-19T08:00:00Z', endTime: '2026-10-19T09:00:00Z', startOdo: 1, endOdo: 2, miles: 1 });
    s.tag(t.id, 'business', 'x'); await assert.rejects(s.send([t.id], 'now'), /Email not sent/); assert(!s.trips()[0].reimbursedAt);
  });
  await it('Tesla Fleet API: retries 503, does not retry 401, treats 408 as asleep', async () => {
    const seq = [503, 200]; let n = 0; const real = global.fetch;
    global.fetch = async () => { const st = seq[n++] ?? 200; return { ok: st === 200, status: st, text: async () => '', json: async () => ({ response: { vehicle_state: { odometer: 9 }, drive_state: { shift_state: null, latitude: 1, longitude: 2 } } }) }; };
    const api = new FleetApi({ region: 'na' }, { accessToken: 'a', expiresAt: Date.now() + 1e6 }, () => {}); api.retryBaseMs = 1;
    assert.equal((await api.snapshot('V')).odometer, 9); assert.equal(n, 2);
    n = 0; seq.splice(0, 9, 401, 200); await assert.rejects(api.snapshot('V'), /Connect my Tesla again/); assert.equal(n, 1);
    n = 0; seq.splice(0, 9, 408); assert.equal(await api.snapshot('V'), null); global.fetch = real;
  });
  await it('withRetry gives up after N tries', async () => { let k = 0; await assert.rejects(withRetry(() => { k++; throw new Error('x'); }, { tries: 4, baseMs: 1 })); assert.equal(k, 4); });
  await cat.close(); console.log(`more tests: ${passed} passed, 0 failed (emails only to local catcher)`);
})().catch(e => { console.error(e); process.exit(1); });
