const test = require('node:test'), assert = require('node:assert');
const { memoryDb } = require('../lib/db');
const { K } = require('../lib/service');
const { businessTrips, makeSitetimeHandler } = require('../lib/sitetime');

async function seed() {
  const db = memoryDb();
  const add = async (email, name, cars, trips) => { await db.sadd(K.users, email); await db.set(K.user(email), { email, name }); await db.set(K.veh(email), cars); await db.set(K.trips(email), trips); };
  const t = (id, vehicleId, category, miles, extra = {}) => ({ id, vehicleId, category, miles, startTime: '2026-10-20T14:00:00Z', endTime: '2026-10-20T14:30:00Z', startLoc: { lat: 1, lon: 2 }, endLoc: { lat: 3, lon: 4, name: 'Isha' }, ...extra });
  await add('chris@ovanova.co', 'Chris Snodgrass', [{ id: 'silv', name: 'Black Silverado', ownership: 'business', vin: 'V1' }, { id: 'own', name: 'Civic', ownership: 'personal' }],
    [t('phone:1', 'silv', 'business', 21.24), t('phone:2', 'silv', 'personal', 5), t('phone:3', 'own', 'business', 8, { route: 'Yard → Zone 4' }), t('phone:4', 'own', null, 3), t('phone:5', 'silv', 'business', 4, { supersededBy: 'x' })]);
  await add('tyler@gmail.com', 'Tyler Hoyle', [{ id: 'truck', name: 'Ram', ownership: 'personal' }], [t('phone:9', 'truck', 'business', 30)]);
  await add('stranger@example.com', 'Someone', [{ id: 'c', name: 'Car', ownership: 'personal' }], [t('phone:7', 'c', 'business', 9), t('phone:8', 'c', 'personal', 1)]);
  return db;
}

test('only business trips of Ovanova people; ownership per car; others counted, never sent', async () => {
  const db = await seed();
  const r = await businessTrips(db, ['Tyler@Gmail.com']);
  assert.deepEqual(r.trips.map(t => t.id).sort(), ['phone:1', 'phone:3', 'phone:9']);
  const silv = r.trips.find(t => t.id === 'phone:1');
  assert.equal(silv.ownership, 'company'); assert.equal(silv.miles, 21.2); assert.equal(silv.carName, 'Black Silverado'); assert.equal(silv.vin, 'V1'); assert.equal(silv.to, 'Isha');
  const civic = r.trips.find(t => t.id === 'phone:3');
  assert.equal(civic.ownership, 'worker'); assert.equal(civic.from, 'Yard'); assert.equal(civic.to, 'Zone 4');
  assert.deepEqual(r.skipped, [{ email: 'stranger@example.com', businessTrips: 1 }]);
  assert.ok(!JSON.stringify(r).includes('phone:7'));
});

test('without the crew list only @ovanova.co users are returned', async () => {
  const r = await businessTrips(await seed());
  assert.deepEqual(r.trips.map(t => t.email), ['chris@ovanova.co', 'chris@ovanova.co']);
});

const call = async (h, { auth, body, path = '/api/sitetime/trips', method = 'POST' }) => {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(s) { this.body = s; } };
  await h({ url: path, method, headers: auth ? { authorization: auth } : {}, body }, res);
  return { status: res.statusCode, data: JSON.parse(res.body) };
};

test('the route needs the shared secret', async () => {
  const h = makeSitetimeHandler({ env: { SITETIME_SYNC_SECRET: 'sek' }, db: await seed() });
  assert.equal((await call(h, { body: {} })).status, 401);
  assert.equal((await call(h, { auth: 'Bearer nope', body: {} })).status, 401);
  assert.equal((await call(h, { auth: 'Bearer sek', body: {}, method: 'GET' })).status, 404);
  const ok = await call(h, { auth: 'Bearer sek', body: { emails: [] } });
  assert.equal(ok.status, 200); assert.equal(ok.data.trips.length, 2);
  assert.equal((await call(makeSitetimeHandler({ env: {}, db: await seed() }), { auth: 'Bearer ', body: {} })).status, 401);
});
