// Conservative retry with exponential backoff + jitter for network calls (Tesla, ntfy, SMTP).
async function withRetry(fn, { tries = 3, baseMs = 1000, retryable = () => true, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(i); } catch (e) { last = e; if (i === tries - 1 || !retryable(e)) break; await sleep(baseMs * 2 ** i * (0.75 + Math.random() / 2)); }
  }
  throw last;
}
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const transient = e => !(e instanceof HttpError) || e.status === 429 || e.status >= 500;
module.exports = { withRetry, HttpError, transient };
