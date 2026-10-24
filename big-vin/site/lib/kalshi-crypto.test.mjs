import test from 'node:test';
import assert from 'node:assert/strict';
import {encryptSecret, decryptSecret, importKalshiPrivateKey, signKalshiRequest, redactPem} from './kalshi-crypto.mjs';

test('encrypt/decrypt round-trip', async () => {
  const secret = 'test-secret-at-least-16';
  const pem = '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC0\n-----END PRIVATE KEY-----';
  const { ciphertext, iv } = await encryptSecret(pem, secret);
  assert.notEqual(ciphertext, pem);
  assert.equal(await decryptSecret(ciphertext, iv, secret), pem);
  assert.match(redactPem(pem), /REDACTED/);
});

test('RSA-PSS sign strips query and verifies', async () => {
  const { privateKey, publicKey } = await crypto.subtle.generateKey(
    { name: 'RSA-PSS', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', privateKey);
  let bin = '';
  const bytes = new Uint8Array(pkcs8);
  for (const b of bytes) bin += String.fromCharCode(b);
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(bin)}\n-----END PRIVATE KEY-----`;
  const key = await importKalshiPrivateKey(pem);
  const ts = '1703123456789';
  const sigB64 = await signKalshiRequest(key, ts, 'GET', '/trade-api/v2/portfolio/balance?x=1');
  assert.ok(sigB64.length > 40);
  const sig = Uint8Array.from(atob(sigB64), (c) => c.charCodeAt(0));
  const msg = new TextEncoder().encode(`${ts}GET/trade-api/v2/portfolio/balance`);
  const ok = await crypto.subtle.verify({ name: 'RSA-PSS', saltLength: 32 }, publicKey, sig, msg);
  assert.equal(ok, true);
});
