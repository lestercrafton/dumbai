// Command-scope OAuth route + admin token endpoint for the box CLI. Mocked Google/Tesla; nothing reaches a real car.
const test = require('node:test'), assert = require('node:assert');
const { makeHandler } = require('../lib/handler'), { memoryDb } = require('../lib/db');
const VIN = '7SAYGDEE4RA246655';
function fakeId(email) { const b = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  return b({ alg: 'none' }) + '.' + b({ aud: 'gid', iss: 'https://accounts.google.com', email, email_verified: true, name: 'Lester Crafton', sub: '1', exp: Date.now() / 1000 + 600 }) + '.x'; }
function call(h, method, url, { cookie = '', headers = {} } = {}) {
  return new Promise(resolve => { const res = { statusCode: 200, h: {}, setHeader(k, v) { this.h[k.toLowerCase()] = v; },
      end(b) { resolve({ status: this.statusCode, headers: this.h, json: () => JSON.parse(b) }); } };
    h({ method, url, headers: { cookie, ...headers } }, res); }); }
const cookieOf = r => [].concat(r.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');

test('commands OAuth stores command tokens; admin endpoint returns them', async () => {
  let n = 0; const posts = [];
  const fetch = async (u, o = {}) => { const R = (c, j) => ({ ok: c < 300, status: c, json: async () => j, text: async () => JSON.stringify(j) });
    if (o.method === 'POST' && !/token$/.test(u)) posts.push(u);
    if (u.startsWith('https://oauth2.googleapis.com/token')) return R(200, { id_token: fakeId('lester@ovanova.co') });
    if (u.startsWith('https://auth.tesla.com/oauth2/v3/token')) { n++; return R(200, { access_token: 'at' + n, refresh_token: 'rt' + n, expires_in: 28800, scope: 'openid vehicle_cmds vehicle_charging_cmds' }); }
    if (u.endsWith('/api/1/vehicles')) return R(200, { response: [{ id: 1, vin: VIN, display_name: 'micro' }] });
    if (u.endsWith('/api/1/vehicles/' + VIN)) return R(200, { response: { state: 'asleep' } });
    throw new Error('unexpected ' + u); };
  const env = { SESSION_SECRET: 's'.repeat(32), CRON_SECRET: 'c', GOOGLE_WEB_CLIENT_ID: 'gid', GOOGLE_WEB_CLIENT_SECRET: 'gs', TESLA_CLIENT_SECRET: 'ts' };
  const h = makeHandler({ env, db: memoryDb(), transport: null, fetch });
  let r = await call(h, 'GET', '/auth/tesla/commands'); assert.strictEqual(r.status, 302); assert.strictEqual(r.headers.location, '/'); // must be signed in
  r = await call(h, 'GET', '/auth/google'); const g = new URL(r.headers.location);
  r = await call(h, 'GET', '/auth/google/callback?code=x&state=' + g.searchParams.get('state'), { cookie: cookieOf(r) });
  const sess = cookieOf(r).split('; ').find(c => c.startsWith('sess='));
  r = await call(h, 'GET', '/auth/tesla/commands', { cookie: sess }); const tl = new URL(r.headers.location);
  assert.match(tl.searchParams.get('scope'), /vehicle_cmds vehicle_charging_cmds/);
  assert.strictEqual(tl.searchParams.get('prompt_missing_scopes'), 'true');
  assert.strictEqual(tl.searchParams.get('redirect_uri'), 'https://ovanova-mileage-tesla.vercel.app/auth/tesla/callback');
  assert.doesNotMatch(new URL((await call(h, 'GET', '/auth/tesla', { cookie: sess })).headers.location).searchParams.get('scope'), /vehicle_cmds/);
  r = await call(h, 'GET', '/auth/tesla/callback?code=c&state=' + tl.searchParams.get('state'), { cookie: sess + '; ' + cookieOf(r) });
  assert.strictEqual(r.status, 302);
  assert.strictEqual((await call(h, 'GET', '/api/admin/tesla-token?vin=' + VIN)).status, 401);
  assert.strictEqual((await call(h, 'GET', '/api/admin/tesla-token?vin=' + VIN, { headers: { authorization: 'Bearer wrong' } })).status, 401);
  assert.strictEqual((await call(h, 'GET', '/api/admin/tesla-token?vin=bad', { headers: { authorization: 'Bearer c' } })).status, 400);
  r = await call(h, 'GET', '/api/admin/tesla-token?vin=' + VIN, { headers: { authorization: 'Bearer c' } });
  assert.strictEqual(r.status, 200); const j = r.json();
  assert.strictEqual(j.accessToken, 'at1'); assert.strictEqual(j.email, 'lester@ovanova.co'); assert.match(j.scope, /vehicle_cmds/);
  assert.strictEqual((await call(h, 'GET', '/api/admin/tesla-token?vin=5YJ3E1EA0KF000000', { headers: { authorization: 'Bearer c' } })).status, 404);
  assert.deepStrictEqual(posts, []); // no vehicle commands sent
});
