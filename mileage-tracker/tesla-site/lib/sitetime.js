// Business trips for SiteTime's equipment tab (Ovanova's crew app). SiteTime calls POST /api/sitetime/trips with
// "Authorization: Bearer <SITETIME_SYNC_SECRET>" and the crew emails it knows; the answer is every BUSINESS trip of each
// signed-in user whose email is @ovanova.co or on that list. Personal trips are never returned, in any car. Other users
// are only counted (no trip data leaves for them), so the office can see who still needs a matching email.
const crypto = require('crypto');
const { K } = require('./service');

const OVANOVA = /@ovanova\.co$/i;
const norm = e => String(e || '').trim().toLowerCase();
const place = l => !l ? null : (l.name || `${l.lat}, ${l.lon}`);
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

async function businessTrips(db, crewEmails = []) {
  const allowed = new Set((Array.isArray(crewEmails) ? crewEmails : []).map(norm).filter(Boolean));
  const trips = [], skipped = [];
  for (const raw of await db.smembers(K.users)) {
    const email = norm(raw);
    const list = (await db.get(K.trips(raw))) || [];
    const biz = list.filter(t => t && t.category === 'business' && !t.supersededBy && Number.isFinite(+t.miles));
    if (!OVANOVA.test(email) && !allowed.has(email)) { if (biz.length) skipped.push({ email, businessTrips: biz.length }); continue; }
    const user = (await db.get(K.user(raw))) || {}, cars = (await db.get(K.veh(raw))) || [];
    for (const t of biz) {
      const car = cars.find(c => c.id === t.vehicleId) || null;
      const [a, b] = String(t.route || '').split(' → ');
      trips.push({
        id: String(t.id), email, name: user.name || null,
        carId: car ? car.id : null, carName: car ? car.name : null, carModel: car ? car.model || null : null, vin: car ? car.vin || null : null,
        ownership: car ? (car.ownership === 'business' ? 'company' : 'worker') : null,
        startTime: t.startTime, endTime: t.endTime, miles: Math.round(+t.miles * 10) / 10,
        from: a && b ? a : place(t.startLoc), to: a && b ? b : place(t.endLoc), purpose: t.purpose || null, source: t.source || null,
      });
    }
  }
  return { trips, skipped };
}

function makeSitetimeHandler({ env = process.env, db } = {}) {
  const getDb = () => db || (db = require('./db').fromEnv(env));
  const json = (res, code, o) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(o)); };
  return async function handler(req, res) {
    try {
      const p = new URL(req.url, 'http://x').pathname.replace(/\/$/, '');
      if (p !== '/api/sitetime/trips' || req.method !== 'POST') return json(res, 404, { error: 'not found' });
      const given = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (!env.SITETIME_SYNC_SECRET || !given || !safeEq(given, env.SITETIME_SYNC_SECRET)) return json(res, 401, { error: 'unauthorized' });
      let b = req.body;
      if (b === undefined) { let s = ''; for await (const c of req) { s += c; if (s.length > 1e6) return json(res, 413, { error: 'too large' }); } b = s ? JSON.parse(s) : {}; }
      else if (typeof b === 'string') b = JSON.parse(b || '{}');
      return json(res, 200, { at: new Date().toISOString(), ...(await businessTrips(getDb(), b && b.emails)) });
    } catch (e) { return json(res, e instanceof SyntaxError ? 400 : 500, { error: e.message }); }
  };
}
module.exports = { businessTrips, makeSitetimeHandler };
