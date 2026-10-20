// Google sign-in for desktop apps: loopback redirect + PKCE (RFC 8252). Free, no auth SaaS; the account lives locally.
const http = require('http'), crypto = require('crypto');
async function googleSignIn({ clientId, clientSecret, open }) {
  if (!clientId) throw new Error('No Google OAuth client configured (admin: app-config.json google.clientId)');
  const verifier = crypto.randomBytes(32).toString('base64url'), challenge = crypto.createHash('sha256').update(verifier).digest('base64url'), state = crypto.randomBytes(12).toString('hex');
  const code = await new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => { const q = new URL(req.url, 'http://127.0.0.1').searchParams;
      if (!q.get('code') && !q.get('error')) { res.end(); return; }
      res.end(q.get('code') ? 'Signed in. Return to Mileage Tracker.' : 'Sign-in failed.'); srv.close();
      if (q.get('state') !== state) reject(new Error('state mismatch')); else if (q.get('error')) reject(new Error(q.get('error'))); else resolve(q.get('code')); });
    srv.listen(0, '127.0.0.1', () => { srv.redirect = `http://127.0.0.1:${srv.address().port}`; resolve.redirect = srv.redirect;
      open('https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({ client_id: clientId, redirect_uri: srv.redirect, response_type: 'code',
        scope: 'openid email profile', code_challenge: challenge, code_challenge_method: 'S256', state, prompt: 'select_account' })); });
    googleSignIn._srv = srv; setTimeout(() => { srv.close(); reject(new Error('Timed out')); }, 300000);
  });
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, ...(clientSecret ? { client_secret: clientSecret } : {}), code, code_verifier: verifier,
      redirect_uri: googleSignIn._srv.redirect, grant_type: 'authorization_code' }) });
  if (!r.ok) throw new Error('Google token error ' + r.status);
  const p = JSON.parse(Buffer.from((await r.json()).id_token.split('.')[1], 'base64url').toString()); // received directly from Google over TLS
  if (p.aud !== clientId || !String(p.iss).includes('accounts.google.com')) throw new Error('Invalid Google token');
  return { sub: 'google-' + p.sub, email: p.email, name: p.name || p.email };
}
module.exports = { googleSignIn };
