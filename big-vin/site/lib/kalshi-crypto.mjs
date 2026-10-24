/** Encrypt Kalshi API private keys at rest + RSA-PSS / Ed25519 request signing. */

const te = new TextEncoder();
const td = new TextDecoder();

const b64 = (buf) => {
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const fromB64 = (s) => {
  const b = atob(s);
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
};

async function aesKeyFromSecret(secret) {
  const hash = await crypto.subtle.digest('SHA-256', te.encode('bv-kalshi-v1:' + secret));
  return crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** @returns {{ ciphertext: string, iv: string }} base64 */
export async function encryptSecret(plaintext, secret) {
  if (typeof plaintext !== 'string' || !plaintext) throw new Error('empty');
  const key = await aesKeyFromSecret(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(plaintext));
  return { ciphertext: b64(ct), iv: b64(iv) };
}

export async function decryptSecret(ciphertextB64, ivB64, secret) {
  const key = await aesKeyFromSecret(secret);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(ivB64) }, key, fromB64(ciphertextB64));
  return td.decode(pt);
}

function pemToDer(pem) {
  const cleaned = String(pem).replace(/-----BEGIN [^-]+-----/g, '').replace(/-----END [^-]+-----/g, '').replace(/\s+/g, '');
  return fromB64(cleaned);
}

function pemType(pem) {
  const m = String(pem).match(/-----BEGIN ([^-]+)-----/);
  return m ? m[1].trim() : '';
}

/** Import Kalshi private key PEM (PKCS8 RSA, PKCS1 RSA, or Ed25519). */
export async function importKalshiPrivateKey(pem) {
  const type = pemType(pem);
  const der = pemToDer(pem);
  if (/ED25519/i.test(type) || der.byteLength < 100) {
    try {
      return await crypto.subtle.importKey('pkcs8', der, { name: 'Ed25519' }, false, ['sign']);
    } catch {
      /* fall through */
    }
  }
  // PKCS#8 PRIVATE KEY
  if (/PRIVATE KEY/i.test(type) && !/RSA PRIVATE KEY/i.test(type)) {
    try {
      return await crypto.subtle.importKey('pkcs8', der, { name: 'RSA-PSS', hash: 'SHA-256' }, false, ['sign']);
    } catch (e) {
      // Some runtimes want RSA-OAEP name for import then fail; try Ed25519
      return await crypto.subtle.importKey('pkcs8', der, { name: 'Ed25519' }, false, ['sign']);
    }
  }
  // PKCS#1 RSA PRIVATE KEY — wrap to PKCS#8
  if (/RSA PRIVATE KEY/i.test(type)) {
    const pkcs8 = wrapPkcs1ToPkcs8(der);
    return crypto.subtle.importKey('pkcs8', pkcs8, { name: 'RSA-PSS', hash: 'SHA-256' }, false, ['sign']);
  }
  // Bare PKCS8 without careful header
  return crypto.subtle.importKey('pkcs8', der, { name: 'RSA-PSS', hash: 'SHA-256' }, false, ['sign']);
}

/** Minimal PKCS#1 → PKCS#8 wrap for RSA. */
function wrapPkcs1ToPkcs8(pkcs1) {
  // PrivateKeyInfo ::= SEQUENCE { version INTEGER 0, algorithm AlgorithmIdentifier, privateKey OCTET STRING }
  // AlgorithmIdentifier for rsaEncryption: 1.2.840.113549.1.1.1
  const oid = Uint8Array.from([0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]);
  const version = Uint8Array.from([0x02, 0x01, 0x00]);
  const octet = encodeTlv(0x04, pkcs1);
  const body = concat(version, oid, octet);
  return encodeTlv(0x30, body);
}

function encodeTlv(tag, value) {
  const len = value.byteLength ?? value.length;
  let lenBytes;
  if (len < 0x80) lenBytes = Uint8Array.from([len]);
  else if (len < 0x100) lenBytes = Uint8Array.from([0x81, len]);
  else if (len < 0x10000) lenBytes = Uint8Array.from([0x82, (len >> 8) & 0xff, len & 0xff]);
  else lenBytes = Uint8Array.from([0x83, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);
  return concat(Uint8Array.from([tag]), lenBytes, value instanceof Uint8Array ? value : new Uint8Array(value));
}

function concat(...parts) {
  const size = parts.reduce((a, p) => a + (p.byteLength ?? p.length), 0);
  const out = new Uint8Array(size);
  let o = 0;
  for (const p of parts) {
    const u = p instanceof Uint8Array ? p : new Uint8Array(p);
    out.set(u, o);
    o += u.length;
  }
  return out;
}

export async function signKalshiRequest(privateKey, timestamp, method, pathWithoutQuery) {
  const path = String(pathWithoutQuery).split('?')[0];
  const message = te.encode(`${timestamp}${method.toUpperCase()}${path}`);
  const algo = privateKey.algorithm?.name || '';
  let sig;
  if (algo === 'Ed25519') {
    sig = await crypto.subtle.sign('Ed25519', privateKey, message);
  } else {
    // RSA-PSS salt length = digest length (32 for SHA-256), per Kalshi docs.
    sig = await crypto.subtle.sign({ name: 'RSA-PSS', saltLength: 32 }, privateKey, message);
  }
  return b64(sig);
}

export function redactPem(pem) {
  if (typeof pem !== 'string') return '';
  return pem.replace(/-----BEGIN[\s\S]+?-----END [^-]+-----/g, '[REDACTED PEM]');
}
