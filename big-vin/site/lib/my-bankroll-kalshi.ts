/** Persist per-user Kalshi API credentials (encrypted) for My Bankroll Go full. */
import {db} from '@/lib/db';
import {authSecret} from '@/lib/my-bankroll-session';
import {encryptSecret, decryptSecret, redactPem} from '@/lib/kalshi-crypto.mjs';
import {testKalshiConnection, placeKalshiOrder} from '@/lib/kalshi-api.mjs';

export async function loadKalshiStatus(userId: string) {
  const row = await db().prepare(
    'SELECT api_key_id, go_full, connected_at, last_ok_at, last_error FROM my_bankroll_kalshi WHERE user_id=?',
  ).bind(userId).first<{api_key_id: string; go_full: number; connected_at: string; last_ok_at: string|null; last_error: string|null}>();
  if (!row) return {connected: false, goFull: false};
  return {
    connected: true,
    goFull: !!row.go_full,
    apiKeyIdSuffix: String(row.api_key_id || '').slice(-8),
    connectedAt: row.connected_at,
    lastOkAt: row.last_ok_at,
    lastError: row.last_error,
  };
}

async function loadCreds(userId: string) {
  const secret = authSecret();
  if (!secret) return null;
  const row = await db().prepare(
    'SELECT api_key_id, private_key_enc, private_key_iv, go_full FROM my_bankroll_kalshi WHERE user_id=?',
  ).bind(userId).first<{api_key_id: string; private_key_enc: string; private_key_iv: string; go_full: number}>();
  if (!row) return null;
  const pem = await decryptSecret(row.private_key_enc, row.private_key_iv, secret);
  return {apiKeyId: row.api_key_id, privateKeyPem: pem, goFull: !!row.go_full};
}

export async function saveKalshiCredentials(userId: string, {apiKeyId, privateKeyPem, goFull = true}: {apiKeyId: string; privateKeyPem: string; goFull?: boolean}) {
  const secret = authSecret();
  if (!secret) return {ok: false as const, error: 'Sign-in secret missing.', status: 503};
  if (typeof apiKeyId !== 'string' || apiKeyId.trim().length < 8) return {ok: false as const, error: 'Enter your Kalshi API Key ID.', status: 400};
  if (typeof privateKeyPem !== 'string' || !/BEGIN .+PRIVATE KEY/.test(privateKeyPem)) {
    return {ok: false as const, error: 'Paste the full Kalshi private key PEM.', status: 400};
  }
  void redactPem(privateKeyPem);
  const test = await testKalshiConnection({apiKeyId: apiKeyId.trim(), privateKeyPem});
  const now = new Date().toISOString();
  if (!test.ok) {
    return {ok: false as const, error: test.error || 'Kalshi rejected those credentials.', status: 400};
  }
  const enc = await encryptSecret(privateKeyPem, secret);
  await db().prepare(
    `INSERT INTO my_bankroll_kalshi (user_id, api_key_id, private_key_enc, private_key_iv, go_full, connected_at, last_ok_at, last_error)
     VALUES (?,?,?,?,?,?,?,NULL)
     ON CONFLICT(user_id) DO UPDATE SET
       api_key_id=excluded.api_key_id,
       private_key_enc=excluded.private_key_enc,
       private_key_iv=excluded.private_key_iv,
       go_full=excluded.go_full,
       connected_at=excluded.connected_at,
       last_ok_at=excluded.last_ok_at,
       last_error=NULL`,
  ).bind(userId, apiKeyId.trim(), enc.ciphertext, enc.iv, goFull ? 1 : 0, now, now).run();
  return {ok: true as const, balance: test.balance};
}

export async function disconnectKalshi(userId: string) {
  await db().prepare('DELETE FROM my_bankroll_kalshi WHERE user_id=?').bind(userId).run();
  return {ok: true as const};
}

export async function retestKalshi(userId: string) {
  const creds = await loadCreds(userId);
  if (!creds) return {ok: false as const, error: 'Not connected.', status: 404};
  const test = await testKalshiConnection(creds);
  const now = new Date().toISOString();
  if (test.ok) {
    await db().prepare('UPDATE my_bankroll_kalshi SET last_ok_at=?, last_error=NULL WHERE user_id=?').bind(now, userId).run();
    return {ok: true as const, balance: test.balance};
  }
  await db().prepare('UPDATE my_bankroll_kalshi SET last_error=? WHERE user_id=?').bind(String(test.error || 'failed').slice(0, 300), userId).run();
  return {ok: false as const, error: test.error, status: 400};
}

export async function placeForUser(userId: string, args: {ticker: string; side: string; wagerDollars: number; yesAskDollars?: string|number|null; clientOrderId?: string}) {
  const creds = await loadCreds(userId);
  if (!creds) return {ok: false as const, error: 'Connect Kalshi first.', status: 401};
  if (!creds.goFull) return {ok: false as const, error: 'Turn on Go full with Kalshi first.', status: 403};
  const result = await placeKalshiOrder({
    apiKeyId: creds.apiKeyId,
    privateKeyPem: creds.privateKeyPem,
    ticker: args.ticker,
    side: args.side,
    wagerDollars: args.wagerDollars,
    yesAskDollars: args.yesAskDollars,
    clientOrderId: args.clientOrderId,
  });
  const now = new Date().toISOString();
  if (result.ok) {
    await db().prepare('UPDATE my_bankroll_kalshi SET last_ok_at=?, last_error=NULL WHERE user_id=?').bind(now, userId).run();
  } else {
    await db().prepare('UPDATE my_bankroll_kalshi SET last_error=? WHERE user_id=?').bind(String(result.error || 'order failed').slice(0, 300), userId).run();
  }
  return result;
}
