const test = require('node:test'), assert = require('node:assert');
const crypto = require('crypto');
const { memoryDb } = require('../lib/db');
const { PhoneService, smtpKey } = require('../lib/phone');
const { makePhoneHandler } = require('../lib/phone-handler');
const { gpsEmail } = require('../lib/gpsmail');
const { logCsv } = require('../lib/log');
const { Google, encrypt, decrypt } = require('../lib/google');
const { sign } = require('../lib/session');

const LESTER = 'lester@ovanova.co';
function setup(nowIso = '2026-10-20T15:00:00Z') {
  const db = memoryDb(), sent = [], drive = { configured: true, writes: [], async hasScope(e, x) { return x === 'drive.file'; },
    async upsertCsv(email, ym, name, csv) { this.writes.push({ email, name, csv }); return 'f-' + ym; } };
  let now = new Date(nowIso);
  const transport = { sendMail: async m => { sent.push(m); return { messageId: '<m' + sent.length + '@x>' }; } };
  const svc = new PhoneService({ db, env: { SESSION_SECRET: 's' }, userTransport: e => e === LESTER ? transport : null, transport: null, google: drive, tesla: null, now: () => now, retryBaseMs: 1 });
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
  assert.ok(drive.writes.some(w => w.name === 'Mileage log 2026-10.csv' && w.email === LESTER && /sent/.test(w.csv)));
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

test('user without Google email access gets a clear error and nothing is marked sent', async () => {
  const { svc } = setup(); const JOHN = 'john@ovanova.co'; await svc.ensureUser(JOHN, 'John');
  await svc.saveCars(JOHN, [{ id: 'j1', name: 'Tahoe', ownership: 'personal' }]);
  const r = await svc.receive(JOHN, [trip({ carId: 'j1', action: 'send' })]);
  assert.match(r.sendError, /sign in with Google again/); assert.equal(r.results[0].status, 'reimbursable');
  assert.equal(smtpKey('c@ovanova.co'), 'SMTP_PASS_C');
});

test('saveCars keeps a connected Tesla even if the phone omits it', async () => {
  const { svc, db } = setup(); await svc.ensureUser(LESTER, 'Lester');
  await db.set('vehicles:' + LESTER, [{ id: 'micro', name: 'micro', vin: 'V', teslaId: 9, connected: true }]);
  const cars = await svc.saveCars(LESTER, [{ name: 'F-150', ownership: 'business' }]);
  assert.equal(cars.length, 2); assert.equal(cars.find(c => c.name === 'F-150').ownership, 'business');
});

test('HTTP: session token auth, cars, trips, cron secret', async () => {
  const db = memoryDb(), sent = [];
  const h = makePhoneHandler({ env: { SESSION_SECRET: 'sec', CRON_SECRET: 'cron' }, db, google: { configured: false, async hasScope() { return false; }, async status() { return { linked: false }; } }, userTransport: () => ({ sendMail: async m => { sent.push(m); return { messageId: 'x' }; } }), now: () => new Date('2026-10-20T15:00:00Z') });
  const call = async (method, url, b, auth) => { const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(s) { this.body = JSON.parse(s); } };
    await h({ method, url, headers: { authorization: auth }, body: b }, res); return res; };
  const tok = 'Bearer ' + sign({ k: 'device', e: LESTER, n: 'Lester Crafton' }, 'sec');
  assert.equal((await call('GET', '/api/phone/me', undefined, 'Bearer junk')).statusCode, 401);
  assert.equal((await call('GET', '/api/phone/me', undefined, 'Bearer ' + sign({ k: 'device', e: 'x@gmail.com' }, 'sec'))).statusCode, 200); // any Google account
  assert.equal((await call('GET', '/api/phone/me', undefined, 'Bearer ' + sign({ k: 'other', e: 'x@gmail.com' }, 'sec'))).statusCode, 401);
  const me = await call('GET', '/api/phone/me', undefined, tok); assert.equal(me.body.email, LESTER); assert.equal(me.body.sugar, 'sugar@ovanova.co');
  await call('PUT', '/api/phone/cars', { cars: [{ id: 'f150', name: 'F-150', ownership: 'personal' }] }, tok);
  const r = await call('POST', '/api/phone/trips', { trips: [trip({ action: 'send' })] }, tok);
  assert.equal(r.statusCode, 200); assert.equal(r.body.results[0].status, 'sent'); assert.equal(sent.length, 1);
  const bad = await call('POST', '/api/phone/trips', { trips: [{ clientId: 'z', startTime: 'nope', miles: 3 }] }, tok); assert.equal(bad.body.results[0].error, 'invalid trip');
  assert.equal((await call('GET', '/api/phone/cron', undefined, 'Bearer nope')).statusCode, 401);
  assert.equal((await call('GET', '/api/phone/cron', undefined, 'Bearer cron')).body.ok, true);
});

test('log CSV row format', () => {
  const csv = logCsv([{ ...trip(), vehicleId: 'f150', source: 'phone-gps', driver: 'Lester' }], [{ id: 'f150', name: 'F-150' }], () => ({ status: 'reimbursable', rate: 0.76, amount: 9.45 }));
  assert.match(csv.split('\n')[1], /"2026-10-19","9:00 AM","9:30 AM","Lester","F-150","personal","phone-gps","business","reimbursable","12.44"/);
});

test('refresh tokens are encrypted at rest (AES-GCM) and tamper-evident', () => {
  const env = { SESSION_SECRET: 'abc' }, blob = encrypt(env, '1//refresh-token');
  assert.ok(!blob.includes('refresh')); assert.equal(decrypt(env, blob), '1//refresh-token');
  assert.throws(() => decrypt({ SESSION_SECRET: 'other' }, blob));
});

// Fake Google: token endpoint, Gmail send, Drive create/patch.
function fakeGoogle() {
  const calls = [], idt = o => 'h.' + Buffer.from(JSON.stringify({ aud: 'cid', iss: 'https://accounts.google.com', exp: 4102444800, email_verified: true, sub: '42', ...o })).toString('base64url') + '.s';
  let refreshFails = false;
  const ok = b => ({ ok: true, status: 200, json: async () => b, text: async () => '' });
  const f = async (url, o = {}) => { const b = o.body instanceof URLSearchParams ? Object.fromEntries(o.body) : o.body; calls.push({ url, method: o.method || 'GET', body: b, auth: o.headers && o.headers.Authorization });
    if (url === 'https://oauth2.googleapis.com/token' && b.grant_type === 'authorization_code') return ok({ access_token: 'at1', expires_in: 3600, refresh_token: 'rt-secret',
      scope: 'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/drive.file', id_token: idt({ email: 'Pat@Gmail.com', name: 'Pat Doe' }) });
    if (url === 'https://oauth2.googleapis.com/token' && b.grant_type === 'refresh_token') return refreshFails ? { ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) } : ok({ access_token: 'at2', expires_in: 3600 });
    if (url.includes('gmail/v1/users/me/messages/send')) return ok({ id: 'gm1' });
    if (url.startsWith('https://www.googleapis.com/drive/v3/files')) return ok({ id: 'folder1' });
    if (url.includes('/upload/drive/v3/files')) return ok({ id: 'file1' });
    throw new Error('unexpected ' + url); };
  return { f, calls, failRefresh: () => { refreshFails = true; } };
}

test('Google sign-in from the app: any Google account, one-time code, session token, Gmail send + own Drive log', async () => {
  const db = memoryDb(), G = fakeGoogle(), env = { SESSION_SECRET: 'sec', GOOGLE_WEB_CLIENT_ID: 'cid', GOOGLE_WEB_CLIENT_SECRET: 'csecret', PUBLIC_URL: 'https://m.example' };
  const h = makePhoneHandler({ env, db, fetch: G.f, now: () => new Date('2026-10-20T15:00:00Z') });
  const call = async (method, url, b, auth) => { const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(s) { try { this.body = JSON.parse(s); } catch { this.body = s; } } };
    await h({ method, url, headers: { authorization: auth }, body: b }, res); return res; };
  assert.equal((await call('GET', '/api/phone/auth/start?redirect=https://evil.example')).statusCode, 400);
  const st = await call('GET', '/api/phone/auth/start?redirect=' + encodeURIComponent('ovanovamileage://auth'));
  assert.equal(st.statusCode, 302); const g = new URL(st.headers.Location);
  assert.equal(g.searchParams.get('redirect_uri'), 'https://m.example/api/phone/auth/callback'); assert.equal(g.searchParams.get('access_type'), 'offline');
  assert.match(g.searchParams.get('scope'), /gmail\.send.*drive\.file/);
  const cb = await call('GET', `/api/phone/auth/callback?code=abc&state=${g.searchParams.get('state')}`);
  const back = new URL(cb.headers.Location); assert.equal(back.protocol, 'ovanovamileage:'); assert.ok(!back.searchParams.get('missing'));
  assert.equal((await call('GET', `/api/phone/auth/callback?code=abc&state=${g.searchParams.get('state')}`)).statusCode, 400); // state is single-use
  const ex = await call('POST', '/api/phone/auth/exchange', { code: back.searchParams.get('code') });
  assert.equal(ex.body.email, 'pat@gmail.com');
  assert.equal((await call('POST', '/api/phone/auth/exchange', { code: back.searchParams.get('code') })).statusCode, 400); // code is single-use
  const stored = await db.get('google:pat@gmail.com'); assert.ok(stored.rt && !JSON.stringify(stored).includes('rt-secret'));
  const tok = 'Bearer ' + ex.body.token;
  const me = await call('GET', '/api/phone/me', undefined, tok); assert.equal(me.body.emailVia, 'gmail'); assert.equal(me.body.driveReady, true); assert.equal(me.body.sugar, 'sugar@ovanova.co');
  assert.equal((await call('PUT', '/api/phone/settings', { sugar: 'not-an-email' }, tok)).statusCode, 400);
  assert.equal((await call('PUT', '/api/phone/settings', { sugar: 'ap@example.com', sugarCc: 'boss@example.com' }, tok)).body.sugar, 'ap@example.com');
  await call('PUT', '/api/phone/cars', { cars: [{ id: 'civic', name: 'Civic', ownership: 'personal' }] }, tok);
  const r = await call('POST', '/api/phone/trips', { trips: [trip({ carId: 'civic', action: 'send' })] }, tok);
  assert.equal(r.body.results[0].status, 'sent', JSON.stringify(r.body));
  const sendCall = G.calls.find(c => c.url.includes('messages/send')); const raw = Buffer.from(JSON.parse(sendCall.body).raw, 'base64url').toString();
  assert.match(raw, /^From: Pat Doe <pat@gmail\.com>/m); assert.match(raw, /^To: ap@example\.com/m); assert.match(raw, /^Cc: boss@example\.com/m); assert.match(raw, /GPS/);
  assert.ok(G.calls.some(c => c.url.startsWith('https://www.googleapis.com/drive/v3/files') && c.method === 'POST'));
  assert.ok(G.calls.some(c => c.url.includes('/upload/drive/v3/files?uploadType=multipart')));
  assert.equal((await call('GET', '/api/phone/me', undefined, 'Bearer junk')).statusCode, 401);
});

test('expired Google grant (e.g. 7-day Testing limit) asks the user to sign in again and sends nothing', async () => {
  const db = memoryDb(), G = fakeGoogle(), env = { SESSION_SECRET: 'sec', GOOGLE_WEB_CLIENT_ID: 'cid', GOOGLE_WEB_CLIENT_SECRET: 'cs' };
  const google = new Google({ env, db, fetch: G.f, retryBaseMs: 1 });
  await db.set('google:pat@gmail.com', { rt: encrypt(env, 'rt'), scopes: ['https://www.googleapis.com/auth/gmail.send'] });
  const svc = new PhoneService({ db, env, google, transport: null, userTransport: () => null, tesla: null, now: () => new Date('2026-10-20T15:00:00Z'), retryBaseMs: 1 });
  await svc.ensureUser('pat@gmail.com', 'Pat'); await svc.saveCars('pat@gmail.com', [{ id: 'c', name: 'Civic' }]);
  G.failRefresh();
  const r = await svc.receive('pat@gmail.com', [trip({ carId: 'c', action: 'send' })]);
  assert.match(r.sendError, /Sign in with Google again/); assert.equal(r.results[0].status, 'reimbursable');
  assert.equal((await db.get('google:pat@gmail.com')).error, 'expired');
});
