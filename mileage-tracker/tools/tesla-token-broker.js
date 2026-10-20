// Tiny self-hosted Tesla token broker (admin runs this once, free: any small VPS, home server, or Fly/Render free tier).
// Holds the shared Fleet API app's client secret so the desktop app never ships it. Only proxies the two OAuth grants.
//   TESLA_CLIENT_ID=... TESLA_CLIENT_SECRET=... TESLA_REGION=na PORT=8787 node tools/tesla-token-broker.js
const http = require('http');
const { TESLA_CLIENT_ID: id, TESLA_CLIENT_SECRET: secret, TESLA_REGION = 'na', PORT = 8787, ALLOWED_REDIRECT = 'http://localhost:8765/callback' } = process.env;
if (!id || !secret) { console.error('Set TESLA_CLIENT_ID and TESLA_CLIENT_SECRET'); process.exit(1); }
const audience = { na: 'https://fleet-api.prd.na.vn.cloud.tesla.com', eu: 'https://fleet-api.prd.eu.vn.cloud.tesla.com' }[TESLA_REGION];
http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/token') { res.writeHead(404).end(); return; }
  let b = ''; req.on('data', c => { b += c; if (b.length > 1e4) req.destroy(); });
  req.on('end', async () => {
    try { const j = JSON.parse(b), p = { client_id: id, client_secret: secret, audience };
      if (j.grant_type === 'authorization_code') { if (j.redirect_uri !== ALLOWED_REDIRECT) throw new Error('bad redirect');
        Object.assign(p, { grant_type: j.grant_type, code: j.code, code_verifier: j.code_verifier, redirect_uri: j.redirect_uri }); }
      else if (j.grant_type === 'refresh_token') Object.assign(p, { grant_type: 'refresh_token', refresh_token: j.refresh_token });
      else throw new Error('unsupported grant');
      const r = await fetch('https://auth.tesla.com/oauth2/v3/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(p) });
      res.writeHead(r.status, { 'Content-Type': 'application/json' }).end(await r.text());
    } catch (e) { res.writeHead(400).end(JSON.stringify({ error: e.message })); }
  });
}).listen(PORT, () => console.log('Tesla token broker on :' + PORT));
