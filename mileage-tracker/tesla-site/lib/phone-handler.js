// HTTP API for the iPhone app plus the Friday batch cron. Auth: a long-lived signed device token per user
// (HMAC with SESSION_SECRET, issued with tools/device-token.js), sent as "Authorization: Bearer <token>".
const S = require('./session');
const { PhoneService } = require('./phone');
const { HttpError } = require('./retry');
const { allowedEmail } = require('./service');

function makePhoneHandler({ env = process.env, db, transport = null, userTransport, drive, fetch: f = globalThis.fetch, now } = {}) {
  let svc; const get = () => svc || (svc = new PhoneService({ db: db || require('./db').fromEnv(env), env, transport, userTransport, drive, fetch: f, now }));
  const json = (res, code, o) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(o)); };
  const body = async req => { if (req.body !== undefined) return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    let s = ''; for await (const c of req) { s += c; if (s.length > 2e6) throw new HttpError(413, 'too large'); } return s ? JSON.parse(s) : {}; };
  return async function handler(req, res) {
    const url = new URL(req.url, 'http://x'), p = url.pathname.replace(/\/$/, '');
    try {
      if (p === '/api/phone/cron') {
        if (!env.CRON_SECRET || req.headers.authorization !== 'Bearer ' + env.CRON_SECRET) return json(res, 401, { error: 'unauthorized' });
        return json(res, 200, { ok: true, at: new Date().toISOString(), results: await get().tickAll() });
      }
      if (!env.SESSION_SECRET) return json(res, 503, { error: 'SESSION_SECRET not set' });
      const tok = S.verify(String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''), env.SESSION_SECRET);
      if (!tok || tok.k !== 'device' || !allowedEmail(tok.e)) return json(res, 401, { error: 'Pair this phone again (invalid or expired device token)' });
      const s = get(), email = await s.ensureUser(tok.e, tok.n);
      if (p === '/api/phone/me' && req.method === 'GET') { const st = await s.settings(email);
        return json(res, 200, { email, name: (await s.user(email)).name, sugar: st.sugar.to, nextBatch: s.nextBatch(st).toISOString(), emailReady: !!(s.userTransport(email) || s.transport), driveReady: !!(s.drive && s.drive.configured) }); }
      if (p === '/api/phone/cars' && req.method === 'GET') return json(res, 200, { cars: await s.cars(email) });
      if (p === '/api/phone/cars' && req.method === 'PUT') return json(res, 200, { cars: await s.saveCars(email, (await body(req)).cars) });
      if (p === '/api/phone/trips' && req.method === 'POST') return json(res, 200, await s.receive(email, (await body(req)).trips));
      if (p === '/api/phone/trips' && req.method === 'GET') { const vs = await s.cars(email), since = url.searchParams.get('since') || '';
        return json(res, 200, { trips: (await s.trips(email)).filter(t => t.startTime >= since).map(t => ({ ...t, ...s.status(t, vs) })) }); }
      if (p === '/api/phone/send' && req.method === 'POST') { const ids = (await body(req)).ids; return json(res, 200, await s.send(email, Array.isArray(ids) ? ids.map(String) : [], 'phone')); }
      return json(res, 404, { error: 'not found' });
    } catch (e) {
      const code = e instanceof HttpError && e.status >= 400 && e.status < 600 ? e.status : e instanceof SyntaxError ? 400 : 500;
      return json(res, code, { error: e.message });
    }
  };
}
module.exports = { makePhoneHandler };
