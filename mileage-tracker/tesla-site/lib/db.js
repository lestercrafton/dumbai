// Key/value JSON storage. Production: Upstash Redis REST (free tier, via Vercel Marketplace env KV_REST_API_URL/TOKEN
// or UPSTASH_REDIS_REST_URL/TOKEN). Tests: in-memory. No SDK needed, just fetch.
function memoryDb() {
  const m = new Map();
  return { kind: 'memory', map: m,
    async get(k) { return m.has(k) ? JSON.parse(m.get(k)) : null; },
    async set(k, v) { m.set(k, JSON.stringify(v)); },
    async del(k) { m.delete(k); },
    async setnx(k, v, ttlSec) { if (m.has(k)) return false; m.set(k, JSON.stringify(v)); if (ttlSec) setTimeout(() => m.delete(k), ttlSec * 1000).unref?.(); return true; },
    async smembers(k) { return m.has(k) ? JSON.parse(m.get(k)) : []; },
    async sadd(k, v) { const s = new Set(m.has(k) ? JSON.parse(m.get(k)) : []); s.add(v); m.set(k, JSON.stringify([...s])); } };
}
function redisDb(url, token, f = globalThis.fetch) {
  const cmd = async (...args) => {
    const r = await f(url.replace(/\/$/, ''), { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error('Storage error: ' + (j.error || r.status));
    return j.result;
  };
  return { kind: 'redis',
    async get(k) { const v = await cmd('GET', k); return v == null ? null : JSON.parse(v); },
    async set(k, v) { await cmd('SET', k, JSON.stringify(v)); },
    async del(k) { await cmd('DEL', k); },
    async setnx(k, v, ttlSec) { return (await cmd('SET', k, JSON.stringify(v), 'NX', 'EX', String(ttlSec || 300))) === 'OK'; },
    async smembers(k) { return (await cmd('SMEMBERS', k)) || []; },
    async sadd(k, v) { await cmd('SADD', k, v); } };
}
function fromEnv(env = process.env) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL, token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return redisDb(url, token);
  if (env.NODE_ENV === 'production' || env.VERCEL) throw new Error('Storage not configured: connect Upstash Redis (free) to this Vercel project');
  return memoryDb();
}
module.exports = { memoryDb, redisDb, fromEnv };
