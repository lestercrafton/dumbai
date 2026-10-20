// Vercel serverless Tesla token broker. Holds the shared Fleet API app's secret (Vercel env vars), so the desktop app never ships it.
// Env: TESLA_CLIENT_ID, TESLA_CLIENT_SECRET, TESLA_REGION (na|eu, default na), ALLOWED_REDIRECT (default http://localhost:8765/callback)
const AUD = { na: 'https://fleet-api.prd.na.vn.cloud.tesla.com', eu: 'https://fleet-api.prd.eu.vn.cloud.tesla.com' };
module.exports = async (req, res) => {
  const { TESLA_CLIENT_ID: id, TESLA_CLIENT_SECRET: secret, TESLA_REGION = 'na', ALLOWED_REDIRECT = 'http://localhost:8765/callback' } = process.env;
  if (req.method === 'GET') return res.status(200).json({ ok: true, configured: !!(id && secret) });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!id || !secret) return res.status(503).json({ error: 'Broker not configured: set TESLA_CLIENT_ID and TESLA_CLIENT_SECRET in Vercel' });
  const j = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const p = { client_id: id, client_secret: secret, audience: AUD[TESLA_REGION] || AUD.na };
  if (j.grant_type === 'authorization_code') {
    if (j.redirect_uri !== ALLOWED_REDIRECT) return res.status(400).json({ error: 'bad redirect_uri' });
    Object.assign(p, { grant_type: 'authorization_code', code: String(j.code || ''), code_verifier: String(j.code_verifier || ''), redirect_uri: j.redirect_uri });
  } else if (j.grant_type === 'refresh_token') Object.assign(p, { grant_type: 'refresh_token', refresh_token: String(j.refresh_token || '') });
  else return res.status(400).json({ error: 'unsupported grant_type' });
  const r = await fetch('https://auth.tesla.com/oauth2/v3/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(p) });
  res.status(r.status).setHeader('Content-Type', 'application/json'); res.send(await r.text());
};
