/** Email OTP + signed session cookie for My Bankroll. No passwords. */
export const COOKIE = 'bv_mb';
export const SESSION_DAYS = 30;
export const OTP_MINUTES = 15;
export const OTP_MAX_ATTEMPTS = 5;

const b64url = (buf) => {
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64url = (s) => {
  const pad = s.length % 4 === 0 ? '' : '===='.slice(s.length % 4);
  const b = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
};

export function normalizeEmail(email) {
  if (typeof email !== 'string') return null;
  const e = email.trim().toLowerCase();
  if (!/^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/i.test(e) || e.length > 200) return null;
  return e;
}

export function generateOtp() {
  const c = globalThis.crypto;
  const n = c.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, '0');
}

async function hmacKey(secret) {
  return globalThis.crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function hashOtp(code, secret) {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('otp:' + code));
  return b64url(sig);
}

export async function otpMatches(code, hash, secret) {
  if (typeof code !== 'string' || typeof hash !== 'string') return false;
  const expect = await hashOtp(code.trim(), secret);
  if (expect.length !== hash.length) return false;
  let diff = 0;
  for (let i = 0; i < expect.length; i++) diff |= expect.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}

export async function signSession({ userId, email, secret, days = SESSION_DAYS }) {
  const exp = Date.now() + days * 86400_000;
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ uid: userId, email, exp })));
  const key = await hmacKey(secret);
  const sig = b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)));
  return `${payload}.${sig}`;
}

export async function verifySession(token, secret) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const i = token.lastIndexOf('.');
  const payload = token.slice(0, i);
  const sig = token.slice(i + 1);
  if (!payload || !sig) return null;
  const key = await hmacKey(secret);
  const ok = await crypto.subtle.verify('HMAC', key, fromB64url(sig), new TextEncoder().encode(payload));
  if (!ok) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
    if (!data?.uid || !data?.email || !Number.isFinite(data.exp) || data.exp < Date.now()) return null;
    return { userId: data.uid, email: data.email, exp: data.exp };
  } catch {
    return null;
  }
}

export function sessionCookie(token, { secure = true } = {}) {
  const parts = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${SESSION_DAYS * 86400}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookie({ secure = true } = {}) {
  const parts = [`${COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function readSessionCookie(request) {
  const raw = request.headers.get('cookie') || '';
  const m = raw.match(/(?:^|;\s*)bv_mb=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function otpExpiryIso(minutes = OTP_MINUTES) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}
