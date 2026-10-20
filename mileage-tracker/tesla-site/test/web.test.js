// End-to-end-ish tests: real handler + in-memory storage + mocked Google/Tesla/ntfy + local SMTP catcher. No real email.
const test = require('node:test'), assert = require('node:assert');
const { SMTPServer } = require('smtp-server'), { simpleParser } = require('mailparser'), nodemailer = require('nodemailer');
const { makeHandler } = require('../lib/handler'), { memoryDb } = require('../lib/db'), S = require('../lib/session'), { lastWeekly } = require('../lib/tz');
const fs = require('fs'), path = require('path');

function fakeId(email, aud = 'gid') { const b = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  return b({ alg: 'none' }) + '.' + b({ aud, iss: 'https://accounts.google.com', email, email_verified: true, name: 'Lester Crafton', sub: '1', exp: Date.now() / 1000 + 600 }) + '.x'; }
function world() {
  const car = { state: 'online', shift: 'P', odo: 1000, lat: 41.88, lon: -87.63 }, calls = [], pushes = [];
  let googleEmail = 'lester@ovanova.co';
  const fetch = async (u, o = {}) => { calls.push(u); const R = (code, j) => ({ ok: code < 300, status: code, json: async () => j, text: async () => JSON.stringify(j) });
    if (u.startsWith('https://oauth2.googleapis.com/token')) return R(200, { id_token: fakeId(googleEmail) });
    if (u.startsWith('https://auth.tesla.com/oauth2/v3/token')) return R(200, { access_token: 'at', refresh_token: 'rt', expires_in: 28800 });
    if (u.endsWith('/api/1/vehicles')) return R(200, { response: [{ id: 1, vin: '7SAYGDEE4RA246655', display_name: 'micro' }] });
    if (/vehicle_data/.test(u)) return R(200, { response: { vehicle_state: { odometer: car.odo }, drive_state: { shift_state: car.shift, latitude: car.lat, longitude: car.lon, speed: 0 } } });
    if (/\/api\/1\/vehicles\/\w+$/.test(u)) return R(200, { response: { state: car.state } });
    if (u.startsWith('https://ntfy.sh/')) { pushes.push(o); return R(200, {}); }
    throw new Error('unexpected fetch ' + u); };
  return { car, calls, pushes, fetch, setGoogle: e => { googleEmail = e; } };
}
async function catcher() { const mails = []; const srv = new SMTPServer({ authOptional: true, disabledCommands: ['STARTTLS'],
    onData(s, sess, cb) { simpleParser(s).then(m => { mails.push(m); cb(); }); } });
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); return { mails, port: srv.server.address().port, close: () => srv.close() }; }
function call(h, method, url, { cookie = '', body, headers = {} } = {}) {
  return new Promise(resolve => { const res = { statusCode: 200, h: {}, setHeader(k, v) { this.h[k.toLowerCase()] = v; },
      end(b) { resolve({ status: this.statusCode, headers: this.h, text: b || '', json: () => JSON.parse(b) }); } };
    h({ method, url, headers: { cookie, ...(body ? { 'x-mt': '1' } : {}), ...headers }, body }, res); }); }
const cookieOf = r => [].concat(r.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');

test('core copied unchanged from desktop app', () => {
  assert.strictEqual(fs.readFileSync(path.join(__dirname, '../lib/core.js'), 'utf8'), fs.readFileSync(path.join(__dirname, '../../src/core.js'), 'utf8')); });

test('Friday 17:00 Central, DST-safe', () => {
  assert.strictEqual(lastWeekly(new Date('2026-10-23T22:30:00Z'), 5, '17:00').toISOString(), '2026-10-23T22:00:00.000Z'); // CDT
  assert.strictEqual(lastWeekly(new Date('2026-10-23T21:59:00Z'), 5, '17:00').toISOString(), '2026-10-16T22:00:00.000Z');
  assert.strictEqual(lastWeekly(new Date('2026-11-13T23:30:00Z'), 5, '17:00').toISOString(), '2026-11-13T23:00:00.000Z'); // CST
});

test('full flow: sign-in, Tesla link, trip detection, push, tag, send now, batch, Friday send', async () => {
  const W = world(), smtp = await catcher(), db = memoryDb();
  let now = new Date('2026-10-20T15:00:00Z');
  const env = { SESSION_SECRET: 's'.repeat(32), CRON_SECRET: 'c', GOOGLE_WEB_CLIENT_ID: 'gid', GOOGLE_WEB_CLIENT_SECRET: 'gs', TESLA_CLIENT_SECRET: 'ts', SMTP_HOST: '127.0.0.1', SMTP_FROM: 'lester@ovanova.co' };
  const transport = nodemailer.createTransport({ host: '127.0.0.1', port: smtp.port, secure: false, ignoreTLS: true });
  const h = makeHandler({ env, db, transport, fetch: W.fetch, now: () => now });
  try {
    assert.strictEqual((await call(h, 'GET', '/api/state')).status, 401);
    // Google sign-in
    let r = await call(h, 'GET', '/auth/google'); assert.strictEqual(r.status, 302);
    const loc = new URL(r.headers.location); assert.strictEqual(loc.searchParams.get('redirect_uri'), 'https://ovanova-mileage-tesla.vercel.app/auth/google/callback');
    r = await call(h, 'GET', '/auth/google/callback?code=x&state=' + loc.searchParams.get('state'), { cookie: cookieOf(r) });
    assert.strictEqual(r.status, 302); const sess = cookieOf(r).split('; ').find(c => c.startsWith('sess='));
    let st = (await call(h, 'GET', '/api/state', { cookie: sess })).json();
    assert.strictEqual(st.user.email, 'lester@ovanova.co'); assert.strictEqual(st.vehicles[0].name, 'micro'); assert.strictEqual(st.settings.sugar.to, 'sugar@ovanova.co');
    // Tesla link
    r = await call(h, 'GET', '/auth/tesla', { cookie: sess }); const tl = new URL(r.headers.location);
    assert.strictEqual(tl.searchParams.get('redirect_uri'), 'https://ovanova-mileage-tesla.vercel.app/auth/tesla/callback');
    r = await call(h, 'GET', '/auth/tesla/callback?code=c&state=' + tl.searchParams.get('state'), { cookie: sess + '; ' + cookieOf(r) });
    assert.strictEqual(r.headers.location, '/#vehicles');
    await call(h, 'POST', '/api/settings', { cookie: sess, body: { ntfy: { topic: 'mt-test' } } });
    // Cron auth, then a drive: P -> D -> D -> P
    assert.strictEqual((await call(h, 'GET', '/api/cron')).status, 401);
    const cron = () => call(h, 'GET', '/api/cron', { headers: { authorization: 'Bearer c' } }).then(x => x.json());
    await cron(); W.car.shift = 'D'; now = new Date(now.getTime() + 300000); await cron();
    W.car.odo = 1012.4; now = new Date(now.getTime() + 300000); await cron();
    W.car.shift = 'P'; now = new Date(now.getTime() + 300000); const c4 = await cron();
    assert.deepStrictEqual(c4.results[0].ended.length, 1);
    st = (await call(h, 'GET', '/api/state', { cookie: sess })).json(); assert.strictEqual(st.trips.length, 1); assert.strictEqual(st.trips[0].miles, 12.4);
    // asleep car is not read
    W.car.state = 'asleep'; const before = W.calls.filter(u => /vehicle_data/.test(u)).length; await cron();
    assert.strictEqual(W.calls.filter(u => /vehicle_data/.test(u)).length, before); W.car.state = 'online';
    // push has 3 action buttons; pressing "Yes - Send now" sends to the catcher
    assert.strictEqual(W.pushes.length, 1); const acts = W.pushes[0].headers.Actions.split('; ');
    assert.strictEqual(acts.length, 3); assert.match(acts[0], /Send now/); assert.match(acts[1], /Batch/); assert.match(acts[2], /Personal/);
    const sendUrl = acts[0].split(', ')[2];
    assert.strictEqual((await call(h, 'GET', new URL(sendUrl).pathname + new URL(sendUrl).search)).status, 200); // GET only confirms
    assert.strictEqual(smtp.mails.length, 0);
    r = await call(h, 'POST', new URL(sendUrl).pathname + new URL(sendUrl).search); assert.match(r.text, /Sent to Sugar/);
    assert.strictEqual(smtp.mails.length, 1); const m = smtp.mails[0];
    assert.match(m.subject, /^Mileage Reimbursement Request – Oct 20, 2026 .*\(12\.4 miles \/ \$9\.42\)$/);
    assert.strictEqual(m.to.text, 'sugar@ovanova.co'); assert.match(m.text, /^Sugar,/); assert.match(m.text, /VIN 7SAYGDEE4RA246655/);
    assert.deepStrictEqual(m.attachments.map(a => a.contentType).sort(), ['text/csv', 'text/html']);
    // double-submit guard
    r = await call(h, 'POST', new URL(sendUrl).pathname + new URL(sendUrl).search); assert.strictEqual(smtp.mails.length, 1);
    // second drive -> batch -> Friday 17:00 CT sends once
    W.car.shift = 'D'; now = new Date('2026-10-21T14:00:00Z'); await cron(); W.car.odo = 1020; W.car.shift = 'P'; now = new Date('2026-10-21T14:20:00Z'); await cron();
    st = (await call(h, 'GET', '/api/state', { cookie: sess })).json(); const t2 = st.trips.find(t => !t.reimbursedAt);
    assert.strictEqual((await call(h, 'POST', '/api/queue', { cookie: sess, body: { ids: [t2.id] } })).json().queued, 1);
    now = new Date('2026-10-23T21:55:00Z'); await cron(); assert.strictEqual(smtp.mails.length, 1);
    now = new Date('2026-10-23T22:05:00Z'); const fri = await cron(); assert.strictEqual(smtp.mails.length, 2, JSON.stringify(fri));
    now = new Date('2026-10-23T22:10:00Z'); await cron(); assert.strictEqual(smtp.mails.length, 2);
    // personal tag and CSRF header
    assert.strictEqual((await call(h, 'POST', '/api/manual', { cookie: sess, body: { date: '2026-10-22', miles: 5, purpose: 'Bank' } })).status, 200);
    const res = await new Promise(resolve => h({ method: 'POST', url: '/api/send', headers: { cookie: sess }, body: {} }, { statusCode: 0, setHeader() {}, end() { resolve(this.statusCode); } }));
    assert.strictEqual(res, 403);
  } finally { smtp.close(); }
});

test('only @ovanova.co accounts can sign in', async () => {
  const W = world(); W.setGoogle('someone@gmail.com');
  const h = makeHandler({ env: { SESSION_SECRET: 'x'.repeat(32), GOOGLE_WEB_CLIENT_ID: 'gid', GOOGLE_WEB_CLIENT_SECRET: 'gs' }, db: memoryDb(), transport: null, fetch: W.fetch });
  let r = await call(h, 'GET', '/auth/google'); const st = new URL(r.headers.location).searchParams.get('state');
  r = await call(h, 'GET', '/auth/google/callback?code=x&state=' + st, { cookie: cookieOf(r) });
  assert.strictEqual(r.status, 403); assert.ok(!cookieOf(r).includes('sess=e'));
  assert.strictEqual((await call(h, 'GET', '/api/state', { cookie: 'sess=' + S.sign({ email: 'a@evil.com' }, 'x'.repeat(32)) })).status, 401);
  assert.strictEqual((await call(h, 'GET', '/auth/google/callback?code=x&state=forged', { cookie: cookieOf(r) })).status, 400);
});

test('placeholders: sign-in page explains Google is not set up yet', async () => {
  const h = makeHandler({ env: { SESSION_SECRET: 'x'.repeat(32) }, db: memoryDb(), transport: null });
  const r = await call(h, 'GET', '/auth/google'); assert.strictEqual(r.status, 503); assert.match(r.text, /not switched on yet/);
  assert.deepStrictEqual((await call(h, 'GET', '/api/health')).json().google, false);
});
