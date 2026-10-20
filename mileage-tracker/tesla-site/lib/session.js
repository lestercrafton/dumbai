// Stateless signed cookies (HMAC-SHA256 with SESSION_SECRET). No auth SaaS.
const crypto = require('crypto');
const b64 = s => Buffer.from(s).toString('base64url');
function sign(obj, secret, ttlSec = 30 * 86400, now = Date.now()) {
  const body = b64(JSON.stringify({ ...obj, exp: Math.floor(now / 1000) + ttlSec }));
  return body + '.' + crypto.createHmac('sha256', secret).update(body).digest('base64url');
}
function verify(tok, secret, now = Date.now()) {
  if (!tok || typeof tok !== 'string' || !secret) return null;
  const [body, mac] = tok.split('.'); if (!body || !mac) return null;
  const want = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (want.length !== mac.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(mac))) return null;
  try { const o = JSON.parse(Buffer.from(body, 'base64url').toString()); return o.exp * 1000 > now ? o : null; } catch { return null; }
}
const parseCookies = h => Object.fromEntries((h || '').split(/;\s*/).filter(Boolean).map(c => { const i = c.indexOf('='); return [c.slice(0, i), decodeURIComponent(c.slice(i + 1))]; }));
const cookie = (name, val, maxAge) => `${name}=${encodeURIComponent(val)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
module.exports = { sign, verify, parseCookies, cookie };
