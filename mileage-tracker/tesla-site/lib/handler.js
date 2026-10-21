// HTTP routing for the web app (one Vercel function keeps us well under Hobby limits).
const crypto = require('crypto');
const S = require('./session');
const { allowedEmail } = require('./service');
const { PhoneService } = require('./phone'); // WebService plus phone-trip rules (company cars, per-user Gmail)
const { Tesla, pkce, CMD_SCOPES } = require('./tesla');
const { HttpError } = require('./retry');
const C = require('./commands');

function makeHandler({ env = process.env, db, transport, fetch: f = globalThis.fetch, now } = {}) {
  let svc;
  const get = () => svc || (svc = new PhoneService({ db: db || require('./db').fromEnv(env), env, transport: transport !== undefined ? transport : smtpTransport(env), tesla: new Tesla({ env, fetch: f }), fetch: f, now }));
  const base = () => (env.PUBLIC_URL || 'https://ovanova-mileage-tesla.vercel.app').replace(/\/$/, '');
  const googleRedirect = () => base() + '/auth/google/callback', teslaRedirect = () => base() + '/auth/tesla/callback';
  const json = (res, code, o) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(o)); };
  const redirect = (res, to, cookies = []) => { res.statusCode = 302; if (cookies.length) res.setHeader('Set-Cookie', cookies); res.setHeader('Location', to); res.setHeader('Cache-Control', 'no-store'); res.end(); };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const page = (res, code, msg, extra = '') => { res.statusCode = code; res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
    res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mileage Tracker</title><body style="font-family:system-ui;max-width:32em;margin:3em auto;padding:0 1em"><h2>Mileage Tracker</h2><p>${esc(msg)}</p>${extra}<p><a href="/">Open Mileage Tracker</a></p>`); };
  const body = async req => { if (req.body !== undefined) return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    let s = ''; for await (const c of req) s += c; return s ? JSON.parse(s) : {}; };

  return async function handler(req, res) {
    const url = new URL(req.url, base()), p = url.pathname, q = url.searchParams, ck = S.parseCookies(req.headers.cookie);
    const secret = env.SESSION_SECRET;
    try {
      if (p === '/api/health') return json(res, 200, { ok: true, google: !!(env.GOOGLE_WEB_CLIENT_ID && env.GOOGLE_WEB_CLIENT_SECRET), tesla: !!env.TESLA_CLIENT_SECRET,
        storage: !!(env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL), smtp: !!env.SMTP_HOST, session: !!secret, cron: !!env.CRON_SECRET });
      if (!secret) return json(res, 503, { error: 'SESSION_SECRET not set' });
      if (p === '/auth/google') {
        if (!env.GOOGLE_WEB_CLIENT_ID || !env.GOOGLE_WEB_CLIENT_SECRET) return page(res, 503, 'Google sign-in is not switched on yet. The admin still needs to add the Google web client.');
        const { verifier, challenge } = pkce(), state = crypto.randomBytes(16).toString('hex');
        return redirect(res, 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({ client_id: env.GOOGLE_WEB_CLIENT_ID, redirect_uri: googleRedirect(), response_type: 'code',
          scope: 'openid email profile', state, code_challenge: challenge, code_challenge_method: 'S256', hd: 'ovanova.co', prompt: 'select_account' }),
          [S.cookie('g_oauth', S.sign({ state, verifier }, secret, 600), 600)]);
      }
      if (p === '/auth/google/callback') {
        const st = S.verify(ck.g_oauth, secret); if (!st || st.state !== q.get('state')) return page(res, 400, 'Sign-in expired. Please try again.');
        if (q.get('error')) return page(res, 400, 'Google sign-in was cancelled.');
        const r = await f('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ client_id: env.GOOGLE_WEB_CLIENT_ID, client_secret: env.GOOGLE_WEB_CLIENT_SECRET, code: q.get('code') || '', code_verifier: st.verifier, redirect_uri: googleRedirect(), grant_type: 'authorization_code' }) });
        if (!r.ok) return page(res, 502, 'Google sign-in failed (' + r.status + ').');
        const idt = JSON.parse(Buffer.from((await r.json()).id_token.split('.')[1], 'base64url').toString()); // received directly from Google over TLS
        if (idt.aud !== env.GOOGLE_WEB_CLIENT_ID || !/accounts\.google\.com$/.test(String(idt.iss)) || idt.exp * 1000 < Date.now()) return page(res, 400, 'Invalid Google sign-in.');
        if (!allowedEmail(idt.email, idt.email_verified)) return page(res, 403, `${idt.email} isn't allowed. Sign in with your @ovanova.co Google account.`);
        const u = await get().signIn({ email: idt.email, name: idt.name, sub: idt.sub });
        return redirect(res, '/', [S.cookie('sess', S.sign({ email: u.email }, secret), 30 * 86400), S.cookie('g_oauth', '', 0)]);
      }
      if (p === '/auth/logout') return redirect(res, '/', [S.cookie('sess', '', 0)]);
      if (p === '/api/act') { // ntfy action buttons POST here; a GET (link preview / tap) shows a confirm button
        const t = S.verify(q.get('t'), secret); if (!t) return page(res, 400, 'This link has expired. Open the app to tag the trip.');
        if (req.method !== 'POST') return page(res, 200, 'Confirm this choice for the trip:', `<form method="post"><button>${esc({ send: 'Business: send now', batch: 'Business: batch for Friday', personal: 'Personal' }[t.a] || t.a)}</button></form>`);
        const r = await get().act(t.e, t.id, t.a); return page(res, 200, r.done + '.');
      }
      if (p === '/api/cron') {
        if (!env.CRON_SECRET || req.headers.authorization !== 'Bearer ' + env.CRON_SECRET) return json(res, 401, { error: 'unauthorized' });
        if (!db && !(env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL)) return json(res, 200, { ok: true, skipped: 'storage not connected yet' });
        return json(res, 200, { ok: true, at: new Date().toISOString(), results: await get().pollAll() });
      }
      if (p === '/api/admin/tesla-token') { // box CLI (tesla-cmd) fetches a fresh access token for one VIN
        if (!env.CRON_SECRET || req.headers.authorization !== 'Bearer ' + env.CRON_SECRET) return json(res, 401, { error: 'unauthorized' });
        const vin = String(q.get('vin') || ''); if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return json(res, 400, { error: 'bad vin' });
        return json(res, 200, await get().accessTokenForVin(vin));
      }
      const sess = S.verify(ck.sess, secret), email = sess && sess.email;
      if (!email || !allowedEmail(email)) return p.startsWith('/auth/') ? redirect(res, '/') : json(res, 401, { error: 'signed out' });
      if (p === '/auth/tesla' || p === '/auth/tesla/commands') { // /commands also asks for vehicle_cmds + vehicle_charging_cmds
        const { verifier, challenge } = pkce(), state = crypto.randomBytes(16).toString('hex');
        return redirect(res, get().tesla.authorizeUrl(teslaRedirect(), state, challenge, p === '/auth/tesla/commands' ? CMD_SCOPES : undefined), [S.cookie('t_oauth', S.sign({ state, verifier, email }, secret, 600), 600)]);
      }
      if (p === '/auth/tesla/callback') {
        const st = S.verify(ck.t_oauth, secret); if (!st || st.state !== q.get('state') || st.email !== email) return page(res, 400, 'Tesla sign-in expired. Please try again.');
        if (q.get('error')) return page(res, 400, 'Tesla sign-in was cancelled: ' + q.get('error'));
        const login = await get().tesla.exchangeCode(q.get('code') || '', st.verifier, teslaRedirect());
        await get().linkTesla(email, login);
        return redirect(res, '/#vehicles', [S.cookie('t_oauth', '', 0)]);
      }
      if (req.method === 'POST' && req.headers['x-mt'] !== '1') return json(res, 403, { error: 'missing header' }); // CSRF guard
      const svc = get();
      if (p === '/api/commands') return json(res, 200, await C.status(svc, email));
      if (p === '/api/state') return json(res, 200, await svc.state(email));
      if (req.method !== 'POST') return json(res, 404, { error: 'not found' });
      const b = await body(req), ids = Array.isArray(b.ids) ? b.ids.map(String) : [];
      if (p === '/api/tag') return json(res, 200, await svc.tag(email, String(b.id), b.category ?? null, b.purpose, b.route));
      if (p === '/api/queue') return json(res, 200, { queued: await svc.queue(email, ids) });
      if (p === '/api/unqueue') { await svc.unqueue(email, ids); return json(res, 200, { ok: true }); }
      if (p === '/api/preview') return json(res, 200, await svc.preview(email, ids));
      if (p === '/api/send') return json(res, 200, await svc.send(email, ids, 'manual'));
      if (p === '/api/settings') return json(res, 200, await svc.saveSettings(email, b));
      if (p === '/api/manual') return json(res, 200, await svc.addManual(email, b));
      if (p === '/api/command') return json(res, 200, await C.run(svc, email, { vin: b.vin, cmd: b.cmd, arg: b.arg, text: b.text, confirmed: b.confirmed }));
      if (p === '/api/poll') return json(res, 200, await svc.pollUser(email));
      return json(res, 404, { error: 'not found' });
    } catch (e) {
      const code = e instanceof HttpError && e.status >= 400 && e.status < 600 ? e.status : 500;
      if (p.startsWith('/auth/') || p === '/api/act') return page(res, code, e.message);
      return json(res, code, { error: e.message });
    }
  };
}
function smtpTransport(env) {
  if (!env.SMTP_HOST) return null;
  return require('nodemailer').createTransport({ host: env.SMTP_HOST, port: Number(env.SMTP_PORT || 587), secure: env.SMTP_SECURE === 'true', auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined });
}
module.exports = { makeHandler, smtpTransport };
