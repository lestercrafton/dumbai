const test = require('node:test'), assert = require('node:assert');
const crypto = require('crypto');
const { memoryDb } = require('../lib/db');
const { PhoneService, smtpKey } = require('../lib/phone');
const { makePhoneHandler } = require('../lib/phone-handler');
const { gpsEmail } = require('../lib/gpsmail');
const { Drive, logCsv } = require('../lib/drive');
const { sign } = require('../lib/session');

const LESTER = 'lester@ovanova.co';
function setup(nowIso = '2026-10-20T15:00:00Z') {
  const db = memoryDb(), sent = [], drive = { configured: true, writes: [], async upsertCsv(name, csv, id) { this.writes.push({ name, csv }); return id || 'f-' + name; } };
  let now = new Date(nowIso);
  const transport = { sendMail: async m => { sent.push(m); return { messageId: '<m' + sent.length + '@x>' }; } };
  const svc = new PhoneService({ db, env: { SESSION_SECRET: 's' }, userTransport: e => e === LESTER ? transport : null, transport: null, drive, tesla: null, now: () => now, retryBaseMs: 1 });
  return { db, svc, sent, drive, setNow: d => { now = new Date(d); } };
}
async function withCars(svc) {
  await svc.ensureUser(LESTER, 'Lester Crafton');
  return svc.saveCars(LESTER, [
    { id: 'micro', name: 'micro', model: 'Tesla Model Y Dual Motor', vin: '7SAYGDEE4RA246655', ownership: 'personal', isTesla: true },
    { id: 'f150', name: 'F-150', model: 'Ford F-150', ownership: 'personal' },
    { id: 'van', name: 'Shop van', model: 'Transit', ownership: 'business' }]);
}
const trip = (o = {}) => ({ clientId: 'c1', startTime: '2026-10-19T14:00:00Z', endTime: '2026-10-19T14:30:00Z', miles: 12.44, startLoc: { lat: 32.7, lon: -97.1 }, endLoc: { lat: 32.8, lon: -97.3, name: 'Dunlap HQ' }, carId: 'f150', category: 'business', purpose: 'Site visit', ...o });

test('personal car + business + send now emails Sugar from the user Gmail in GPS mode', async () => {
  const { svc, sent, drive } = setup(); await withCars(svc);
  const r = await svc.receive(LESTER, [trip({ action: 'send' })]);
  assert.equal(r.results[0].status, 'sent'); assert.equal(sent.length, 1);
  const m = sent[0]; assert.equal(m.to, 'sugar@ovanova.co'); assert.match(m.from, /lester@ovanova\.co/);
  assert.match(m.subject, /^Mileage Reimbursement Request – Oct 19, 2026 Site visit Trip \(12\.4 miles \/ \$9\.42\)$/);
  assert.match(m.text, /GPS/); assert.doesNotMatch(m.text, /odometer/i);
  assert.equal(m.attachments.length, 1); assert.match(m.attachments[0].filename, /\.csv$/);
  assert.ok(drive.writes.some(w => w.name === 'Mileage log 2026-10 - lester@ovanova.co.csv' && /sent/.test(w.csv)));
});

test('double-send protection: resubmitting or re-sending does not email twice', async () => {
  const { svc, sent } = setup(); await withCars(svc);
  await svc.receive(LESTER, [trip({ action: 'send' })]);
  await svc.receive(LESTER, [trip({ action: 'send' })]);
  await assert.rejects(svc.send(LESTER, ['phone:c1']), /No unsent/);
  assert.equal(sent.length, 1);
});

test('concurrent send is rejected by the lock', async () => {
  const { svc, db } = setup(); await withCars(svc);
  await svc.receive(LESTER, [trip()]);
  await db.setnx('lock:send:' + LESTER, 1, 60);
  await assert.rejects(svc.send(LESTER, ['phone:c1']), /already in progress/);
});

test('business car trips are logged only, never queued or sent', async () => {
  const { svc, sent } = setup(); await withCars(svc);
  const r = await svc.receive(LESTER, [trip({ carId: 'van', action: 'send' }), trip({ clientId: 'c2', carId: 'van', action: 'batch' })]);
  assert.deepEqual(r.results.map(x => x.status), ['log only', 'log only']); assert.equal(sent.length, 0);
  assert.ok(!(await svc.trips(LESTER)).some(t => t.queuedAt));
});

test('personal trips are not reimbursed', async () => {
  const { svc, sent } = setup(); await withCars(svc);
  const r = await svc.receive(LESTER, [trip({ category: 'personal', action: 'send' })]);
  assert.equal(r.results[0].status, 'personal'); assert.equal(sent.length, 0);
});

test('Tesla dedup: Tesla selected on the phone => superseded and kept', async () => {
  const { svc, sent } = setup(); await withCars(svc);
  const r = await svc.receive(LESTER, [trip({ carId: 'micro', action: 'send' })]);
  assert.equal(r.results[0].status, 'superseded'); assert.equal(sent.length, 0);
  assert.equal((await svc.trips(LESTER)).length, 1);
});

test('Tesla dedup: overlap within ±5 min of a logged Tesla trip => superseded', async () => {
  const { svc, db, sent } = setup(); await withCars(svc);
  await db.set('trips:' + LESTER, [{ id: 'micro:t1', source: 'tesla', vehicleId: 'micro', startTime: '2026-10-19T14:33:00Z', endTime: '2026-10-19T15:00:00Z', miles: 20, startOdo: 1, endOdo: 21, category: null }]);
  const r = await svc.receive(LESTER, [trip({ action: 'send' })]);
  assert.equal(r.results[0].status, 'superseded'); assert.equal(r.results[0].supersededBy, 'micro:t1'); assert.equal(sent.length, 0);
  const far = await svc.receive(LESTER, [trip({ clientId: 'c9', startTime: '2026-10-19T12:00:00Z', endTime: '2026-10-19T14:20:00Z' })]);
  assert.equal(far.results[0].status, 'reimbursable');
});

test('Tesla dedup: a Tesla trip arriving later supersedes the queued phone trip', async () => {
  const { svc } = setup(); await withCars(svc);
  svc.pushNtfy = async () => false;
  await svc.receive(LESTER, [trip({ action: 'batch' })]);
  assert.ok((await svc.trips(LESTER)).find(t => t.id === 'phone:c1').queuedAt);
  await svc.onTripEnd(LESTER, { id: 'micro', name: 'micro', owner: 'Lester' }, { id: 't5', source: 'tesla', startTime: '2026-10-19T14:02:00Z', endTime: '2026-10-19T14:31:00Z', miles: 12.6, startOdo: 100, endOdo: 112.6 });
  const p = (await svc.trips(LESTER)).find(t => t.id === 'phone:c1');
  assert.equal(p.supersededBy, 'micro:t5'); assert.equal(p.queuedAt, undefined);
});

test('Friday 17:00 Central batch sends queued trips once, as one weekly email', async () => {
  const { svc, sent, setNow } = setup('2026-10-20T15:00:00Z'); await withCars(svc);
  await svc.receive(LESTER, [trip({ action: 'batch' }), trip({ clientId: 'c2', startTime: '2026-10-21T14:00:00Z', endTime: '2026-10-21T15:00:00Z', miles: 30, action: 'batch' })]);
  setNow('2026-10-23T21:59:00Z'); assert.deepEqual(await svc.tickAll(), []); // 16:59 CDT
  setNow('2026-10-23T23:05:00Z'); const r = await svc.tickAll(); // cron run, after 17:00 CDT
  assert.equal(r[0].sent[0].count, 2); assert.equal(sent.length, 1); assert.match(sent[0].subject, /Oct 19–21, 2026 Weekly Business Trips \(42\.4 miles/);
  assert.deepEqual(await svc.tickAll(), []); assert.equal(sent.length, 1);
});

test('IRS rate follows trip date', () => {
  const v = [{ id: 'f150', name: 'F-150' }], u = { name: 'Lester Crafton' };
  const m = gpsEmail([trip({ startTime: '2026-06-30T15:00:00Z', endTime: '2026-06-30T16:00:00Z', miles: 10 }), trip({ startTime: '2026-07-01T15:00:00Z', endTime: '2026-07-01T16:00:00Z', miles: 10 })].map(t => ({ ...t, vehicleId: 'f150' })), v, u);
  assert.equal(m.amount, 14.85); assert.match(m.text, /Miles at \$0\.725\/mile \| 10/); assert.match(m.text, /Thanks,\nLester/);
});

test('user without Gmail app password gets a clear error and nothing is marked sent', async () => {
  const { svc } = setup(); const JOHN = 'john@ovanova.co'; await svc.ensureUser(JOHN, 'John');
  await svc.saveCars(JOHN, [{ id: 'j1', name: 'Tahoe', ownership: 'personal' }]);
  const r = await svc.receive(JOHN, [trip({ carId: 'j1', action: 'send' })]);
  assert.match(r.sendError, /SMTP_PASS_JOHN/); assert.equal(r.results[0].status, 'reimbursable');
  assert.equal(smtpKey('c@ovanova.co'), 'SMTP_PASS_C');
});

test('saveCars keeps a connected Tesla even if the phone omits it', async () => {
  const { svc, db } = setup(); await svc.ensureUser(LESTER, 'Lester');
  await db.set('vehicles:' + LESTER, [{ id: 'micro', name: 'micro', vin: 'V', teslaId: 9, connected: true }]);
  const cars = await svc.saveCars(LESTER, [{ name: 'F-150', ownership: 'business' }]);
  assert.equal(cars.length, 2); assert.equal(cars.find(c => c.name === 'F-150').ownership, 'business');
});

test('HTTP: device token auth, cars, trips, cron secret', async () => {
  const db = memoryDb(), sent = [];
  const h = makePhoneHandler({ env: { SESSION_SECRET: 'sec', CRON_SECRET: 'cron' }, db, drive: { configured: false }, userTransport: () => ({ sendMail: async m => { sent.push(m); return { messageId: 'x' }; } }), now: () => new Date('2026-10-20T15:00:00Z') });
  const call = async (method, url, b, auth) => { const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(s) { this.body = JSON.parse(s); } };
    await h({ method, url, headers: { authorization: auth }, body: b }, res); return res; };
  const tok = 'Bearer ' + sign({ k: 'device', e: LESTER, n: 'Lester Crafton' }, 'sec');
  assert.equal((await call('GET', '/api/phone/me', undefined, 'Bearer junk')).statusCode, 401);
  assert.equal((await call('GET', '/api/phone/me', undefined, 'Bearer ' + sign({ k: 'device', e: 'x@gmail.com' }, 'sec'))).statusCode, 401);
  const me = await call('GET', '/api/phone/me', undefined, tok); assert.equal(me.body.email, LESTER); assert.equal(me.body.sugar, 'sugar@ovanova.co');
  await call('PUT', '/api/phone/cars', { cars: [{ id: 'f150', name: 'F-150', ownership: 'personal' }] }, tok);
  const r = await call('POST', '/api/phone/trips', { trips: [trip({ action: 'send' })] }, tok);
  assert.equal(r.statusCode, 200); assert.equal(r.body.results[0].status, 'sent'); assert.equal(sent.length, 1);
  const bad = await call('POST', '/api/phone/trips', { trips: [{ clientId: 'z', startTime: 'nope', miles: 3 }] }, tok); assert.equal(bad.body.results[0].error, 'invalid trip');
  assert.equal((await call('GET', '/api/phone/cron', undefined, 'Bearer nope')).statusCode, 401);
  assert.equal((await call('GET', '/api/phone/cron', undefined, 'Bearer cron')).body.ok, true);
});

test('Drive: service-account JWT, search then create, then patch with cached id', async () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const calls = [];
  const f = async (url, o = {}) => { calls.push({ url, method: o.method || 'GET' });
    const ok = b => ({ ok: true, json: async () => b, text: async () => '' });
    if (url.includes('oauth2')) return ok({ access_token: 'at', expires_in: 3600 });
    if (url.startsWith('https://www.googleapis.com/drive/v3/files?')) return ok({ files: [] });
    return ok({ id: 'new1' }); };
  const d = new Drive({ env: { GOOGLE_SA_EMAIL: 'sa@x.iam.gserviceaccount.com', GOOGLE_SA_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }), DRIVE_FOLDER_ID: 'fold' }, fetch: f, retryBaseMs: 1 });
  assert.equal(await d.upsertCsv('a.csv', 'x'), 'new1');
  assert.equal(await d.upsertCsv('a.csv', 'y', 'new1'), 'new1');
  assert.deepEqual(calls.map(c => c.method), ['POST', 'GET', 'POST', 'PATCH']);
  const csv = logCsv([{ ...trip(), vehicleId: 'f150', source: 'phone-gps', driver: 'Lester' }], [{ id: 'f150', name: 'F-150' }], () => ({ status: 'reimbursable', rate: 0.76, amount: 9.45 }));
  assert.match(csv.split('\n')[1], /"2026-10-19","9:00 AM","9:30 AM","Lester","F-150","personal","phone-gps","business","reimbursable","12.44"/);
});
