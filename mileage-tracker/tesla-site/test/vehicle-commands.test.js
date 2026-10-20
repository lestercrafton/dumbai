// Commands tab: parsing, scope check, strict per-user VIN authorization. Mocked Tesla; nothing reaches a real car.
const test = require('node:test'), assert = require('node:assert');
const C = require('../lib/commands'), { memoryDb } = require('../lib/db'), { Tesla } = require('../lib/tesla');
const MICRO = '7SAYGDEE4RA246655', CHRIS = '7SAYGDEE0RA111111';
const jwt = scp => 'h.' + Buffer.from(JSON.stringify({ scp })).toString('base64url') + '.s';
const CMD = jwt(['openid', 'vehicle_device_data', 'vehicle_cmds', 'vehicle_charging_cmds']), READ = jwt(['openid', 'vehicle_device_data']);
function svcFor(byToken, opts = {}) {
  const db = memoryDb(), calls = []; let state = opts.state || 'online';
  const fetch = async (u, o = {}) => { calls.push({ u, o }); const R = (c, j) => ({ ok: c < 300, status: c, json: async () => j, text: async () => JSON.stringify(j) });
    const tok = String((o.headers || {}).Authorization || '').replace('Bearer ', '');
    if (u.endsWith('/api/1/vehicles')) return R(200, { response: byToken[tok] || [] });
    if (/\/api\/1\/vehicles\/\w{17}$/.test(u)) return R(200, { response: { state } });
    if (u.endsWith('/wake_up')) { state = 'online'; return R(200, { response: { state: 'asleep' } }); }
    if (u.endsWith('/api/vcmd')) { const ok = o.headers['X-Sig'] === C.sign(o.body, 'cs'); return ok ? R(200, { ok: true }) : R(401, { error: 'unauthorized' }); }
    throw new Error('unexpected ' + u); };
  const env = { CRON_SECRET: 'cs', TESLA_CLIENT_SECRET: 'x' };
  return { db, calls, svc: { db, env, fetch, tesla: new Tesla({ env, fetch, retryBaseMs: 1 }), baseUrl: 'https://ovanova-mileage-tesla.vercel.app', wakePollMs: 1, wakeMs: 500 } };
}
async function link(db, email, tok) { await db.set('tesla:' + email, { accessToken: tok, refreshToken: 'r', expiresAt: Date.now() + 3600e3, scope: null }); }
const CHRISTOK = jwt(['vehicle_cmds', 'vehicle_charging_cmds']) + 'c';
const cars = { [CMD]: [{ vin: MICRO, display_name: 'micro', state: 'online' }], [CHRISTOK]: [{ vin: CHRIS, display_name: 'chris car', state: 'online' }], [READ]: [{ vin: CHRIS, display_name: 'chris car' }] };

test('parse phrases', () => {
  const P = C.parse;
  assert.deepStrictEqual(P('set temp 72'), { cmd: 'set-temp', arg: 72 });
  assert.deepStrictEqual(P('Charge limit 80'), { cmd: 'charge-limit', arg: 80 });
  assert.deepStrictEqual(P('amps 20'), { cmd: 'charge-amps', arg: 20 });
  assert.deepStrictEqual(P('set charging to 20 amps'), { cmd: 'charge-amps', arg: 20 });
  assert.deepStrictEqual(P('vent windows'), { cmd: 'windows-vent' });
  assert.deepStrictEqual(P('roll down my windows'), { cmd: 'windows-vent' });
  assert.deepStrictEqual(P('roll up the windows'), { cmd: 'windows-close' });
  assert.deepStrictEqual(P('close windows'), { cmd: 'windows-close' });
  assert.deepStrictEqual(P('turn on the heat'), { cmd: 'climate-on' });
  assert.deepStrictEqual(P('turn the climate off'), { cmd: 'climate-off' });
  assert.deepStrictEqual(P('make it 74 degrees'), { cmd: 'set-temp', arg: 74 });
  assert.deepStrictEqual(P('start charging'), { cmd: 'charge-start' });
  assert.deepStrictEqual(P('stop charging'), { cmd: 'charge-stop' });
  assert.deepStrictEqual(P('unlock the car'), { cmd: 'unlock' });
  assert.deepStrictEqual(P('lock it'), { cmd: 'lock' });
  assert.deepStrictEqual(P('honk'), { cmd: 'honk' });
  assert.deepStrictEqual(P('flash the lights'), { cmd: 'flash' });
  assert.deepStrictEqual(P('wake up'), { cmd: 'wake' });
  assert.strictEqual(P('make me a sandwich'), null);
});
test('validate ranges', () => {
  assert.strictEqual(C.validate('charge-limit', 80), 80);
  assert.throws(() => C.validate('charge-limit', 30), /50–100/);
  assert.throws(() => C.validate('charge-amps', 99), /5–48/);
  assert.throws(() => C.validate('set-temp', null), /number/);
  assert.throws(() => C.validate('rm-rf', 1), /Unknown/);
});
test('scope comes from JWT scp claim', () => {
  assert.ok(C.canCommand(CMD)); assert.ok(!C.canCommand(READ)); assert.ok(!C.canCommand('garbage'));
});
test('user cannot command a car outside their own Tesla account (Chris -> micro)', async () => {
  const { db, svc, calls } = svcFor(cars); await link(db, 'c@ovanova.co', CHRISTOK); await link(db, 'lester@ovanova.co', CMD);
  await assert.rejects(C.run(svc, 'c@ovanova.co', { vin: MICRO, cmd: 'windows-vent' }), e => e.status === 403 && /isn't on your Tesla account/.test(e.message));
  assert.ok(!calls.some(c => /vcmd|wake_up/.test(c.u)), 'nothing sent');
  // even if micro were copied into Chris's app vehicle list, ownership is checked against his own Tesla token
  await db.set('vehicles:c@ovanova.co', [{ vin: MICRO }]);
  await assert.rejects(C.run(svc, 'c@ovanova.co', { vin: MICRO, cmd: 'honk' }), e => e.status === 403);
  await assert.rejects(C.run(svc, 'john@ovanova.co', { vin: MICRO, cmd: 'lock' }), /Connect your Tesla/);
  assert.ok(!calls.some(c => /vcmd|wake_up/.test(c.u)));
});
test('read-only token is rejected and status says not approved', async () => {
  const { db, svc, calls } = svcFor(cars); await link(db, 'c@ovanova.co', READ);
  await assert.rejects(C.run(svc, 'c@ovanova.co', { vin: CHRIS, cmd: 'lock' }), /not approved/);
  const s = await C.status(svc, 'c@ovanova.co'); assert.strictEqual(s.approved, false);
  assert.strictEqual(s.pairUrl, 'https://tesla.com/_ak/ovanova-mileage-tesla.vercel.app'); assert.strictEqual(s.approveUrl, '/auth/tesla/commands');
  assert.ok(!calls.some(c => /vcmd/.test(c.u)));
});
test('own car: wakes if asleep, then sends a signed request', async () => {
  const { db, svc, calls } = svcFor(cars, { state: 'asleep' }); await link(db, 'c@ovanova.co', CHRISTOK);
  const r = await C.run(svc, 'c@ovanova.co', { vin: CHRIS, text: 'charge limit 80' });
  assert.strictEqual(r.ok, true); assert.strictEqual(r.woke, true); assert.match(r.done, /80%/);
  const v = calls.find(c => c.u.endsWith('/api/vcmd')); const b = JSON.parse(v.o.body);
  assert.deepStrictEqual([b.vin, b.cmd, b.arg, b.token], [CHRIS, 'charge-limit', 80, CHRISTOK]);
  assert.ok(calls.findIndex(c => c.u.endsWith('/wake_up')) < calls.indexOf(v));
});
test('unlock needs confirmation first', async () => {
  const { db, svc, calls } = svcFor(cars); await link(db, 'lester@ovanova.co', CMD);
  const r = await C.run(svc, 'lester@ovanova.co', { vin: MICRO, cmd: 'unlock' }); assert.strictEqual(r.needsConfirm, true);
  assert.ok(!calls.some(c => /vcmd/.test(c.u)));
  assert.strictEqual((await C.run(svc, 'lester@ovanova.co', { vin: MICRO, cmd: 'unlock', confirmed: true })).ok, true);
});
test('HTTP route: signed-out 401, CSRF header required', async () => {
  const { makeHandler } = require('../lib/handler');
  const h = makeHandler({ env: { SESSION_SECRET: 's'.repeat(32), CRON_SECRET: 'c' }, db: memoryDb(), transport: null, fetch: async () => { throw new Error('no network'); } });
  const call = (m, u, headers = {}) => new Promise(res => h({ method: m, url: u, headers, body: '{}' }, { statusCode: 200, setHeader() {}, end(b) { res(this.statusCode); } }));
  assert.strictEqual(await call('POST', '/api/command'), 401);
  const S = require('../lib/session'); const ck = 'sess=' + S.sign({ email: 'c@ovanova.co' }, 's'.repeat(32));
  assert.strictEqual(await call('POST', '/api/command', { cookie: ck }), 403);
});
