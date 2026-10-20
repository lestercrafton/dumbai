// HTTP API for the iPhone app plus the Friday batch cron.
// Sign-in: the app opens /api/phone/auth/start in a browser sheet; Google redirects to /api/phone/auth/callback,
// which stores the user's (encrypted) refresh token and bounces back to the app with a one-time code; the app trades
// the code for a session token at /api/phone/auth/exchange and sends it as "Authorization: Bearer <token>".
const crypto = require('crypto');
const S = require('./session');
const { PhoneService, validEmail } = require('./phone');
const { HttpError } = require('./retry');
const { pkce } = require('./tesla');

const APP_REDIRECT = /^(ovanovamileage:\/\/|exp:\/\/)/; // the app's URL scheme (exp:// for Expo Go during development)
const SESSION_DAYS = 180;

function makePhoneHandler({ env = process.env, db, transport = null, userTransport, google, fetch: f = globalThis.fetch, now } = {}) {
  let svc; const get = () => svc || (svc = new PhoneService({ db: db || require('./db').fromEnv(env), env, transport, userTransport, google, fetch: f, now }));
  const base = () => (env.PUBLIC_URL || 'https://ovanova-mileage-tesla.vercel.app').replace(/\/$/, ''), callback = () => base() + '/api/phone/auth/callback';
  const json = (res, code, o) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(o)); };
  const redirect = (res, to) => { res.statusCode = 302; res.setHeader('Location', to); res.setHeader('Cache-Control', 'no-store'); res.end(); };
  const withQuery = (u, q) => u + (u.includes('?') ? '&' : '?') + new URLSearchParams(q);
  const body = async req => { if (req.body !== undefined) return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    let s = ''; for await (const c of req) { s += c; if (s.length > 2e6) throw new HttpError(413, 'too large'); } return s ? JSON.parse(s) : {}; };
  return async function handler(req, res) {
    const url = new URL(req.url, 'http://x'), p = url.pathname.replace(/\/$/, ''), q = url.searchParams;
    try {
      if (p === '/api/phone/cron') {
        if (!env.CRON_SECRET || req.headers.authorization !== 'Bearer ' + env.CRON_SECRET) return json(res, 401, { error: 'unauthorized' });
        return json(res, 200, { ok: true, at: new Date().toISOString(), results: await get().tickAll() });
      }
      if (!env.SESSION_SECRET) return json(res, 503, { error: 'SESSION_SECRET not set' });
      const s = get(), db = s.db;
      // ---- Google sign-in
      if (p === '/api/phone/auth/start') {
        const appRedirect = q.get('redirect') || 'ovanovamileage://auth';
        if (!APP_REDIRECT.test(appRedirect)) return json(res, 400, { error: 'bad redirect' });
        if (!s.google.configured) return redirect(res, withQuery(appRedirect, { error: 'Google sign-in is not set up on the server yet' }));
        const { verifier, challenge } = pkce(), state = crypto.randomBytes(18).toString('base64url');
        await db.setnx('oauth:' + state, { verifier, appRedirect }, 600);
        return redirect(res, s.google.authUrl(callback(), state, challenge));
      }
      if (p === '/api/phone/auth/callback') {
        const st = q.get('state') && await db.get('oauth:' + q.get('state'));
        if (!st) return json(res, 400, { error: 'Sign-in expired. Close this window and try again.' });
        await db.del('oauth:' + q.get('state'));
        if (q.get('error')) return redirect(res, withQuery(st.appRedirect, { error: q.get('error') === 'access_denied' ? 'Sign-in was cancelled' : q.get('error') }));
        try {
          const g = await s.google.exchange(q.get('code') || '', st.verifier, callback());
          await s.ensureUser(g.email, g.name, g.sub);
          const code = crypto.randomBytes(24).toString('base64url');
          await db.setnx('authcode:' + code, { e: g.email, n: g.name }, 120);
          const missing = ['gmail.send', 'drive.file'].filter(x => !g.scopes.some(sc => sc.endsWith(x)));
          return redirect(res, withQuery(st.appRedirect, { code, ...(missing.length ? { missing: missing.join(',') } : {}) }));
        } catch (e) { return redirect(res, withQuery(st.appRedirect, { error: e.message })); }
      }
      if (p === '/api/phone/auth/exchange' && req.method === 'POST') {
        const code = String((await body(req)).code || ''), v = code && await db.get('authcode:' + code);
        if (!v) return json(res, 400, { error: 'Sign-in code expired. Please sign in again.' });
        await db.del('authcode:' + code);
        return json(res, 200, { token: S.sign({ k: 'device', e: v.e, n: v.n }, env.SESSION_SECRET, SESSION_DAYS * 86400), email: v.e, name: v.n });
      }
      // ---- signed-in API
      const tok = S.verify(String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''), env.SESSION_SECRET);
      if (!tok || tok.k !== 'device' || !validEmail(tok.e)) return json(res, 401, { error: 'Please sign in with Google again' });
      const email = await s.ensureUser(tok.e, tok.n);
      if (p === '/api/phone/me' && req.method === 'GET') { const st = await s.settings(email), g = await s.google.status(email), tr = await s.transportFor(email);
        return json(res, 200, { email, name: (await s.user(email)).name, sugar: st.sugar.to, sugarCc: st.sugar.cc, nextBatch: s.nextBatch(st).toISOString(),
          emailReady: !!tr, emailVia: tr ? (tr.t.kind === 'gmail' ? 'gmail' : 'smtp') : null, driveReady: !!(s.google.configured && g.drive && g.linked), google: g }); }
      if (p === '/api/phone/settings' && req.method === 'PUT') { const b = await body(req); const st = await s.setRecipient(email, { to: b.sugar, cc: b.sugarCc }); return json(res, 200, { sugar: st.sugar.to, sugarCc: st.sugar.cc }); }
      if (p === '/api/phone/auth/signout' && req.method === 'POST') { if ((await body(req)).revoke) await s.google.revoke(email); return json(res, 200, { ok: true }); }
      if (p === '/api/phone/cars' && req.method === 'GET') return json(res, 200, { cars: await s.cars(email) });
      if (p === '/api/phone/cars' && req.method === 'PUT') return json(res, 200, { cars: await s.saveCars(email, (await body(req)).cars) });
      if (p === '/api/phone/trips' && req.method === 'POST') return json(res, 200, await s.receive(email, (await body(req)).trips));
      if (p === '/api/phone/trips' && req.method === 'GET') { const vs = await s.cars(email), since = q.get('since') || '';
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
