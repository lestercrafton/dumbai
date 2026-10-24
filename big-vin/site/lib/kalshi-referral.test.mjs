import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeKalshiReferralCode,
  applyKalshiReferral,
  kalshiJoinUrl,
  applyReferralToMatches,
} from './kalshi-referral.mjs';

test('normalize empty', () => {
  assert.equal(normalizeKalshiReferralCode(''), null);
  assert.equal(normalizeKalshiReferralCode('  BIGVIN  '), 'BIGVIN');
});

test('applyKalshiReferral appends r= for bare codes', () => {
  const u = applyKalshiReferral('https://kalshi.com/markets/kxnflgame/kxnflgame-x', 'BIGVIN');
  assert.equal(u, 'https://kalshi.com/markets/kxnflgame/kxnflgame-x?r=BIGVIN');
  assert.equal(applyKalshiReferral(u, 'OTHER'), u); // already has r=
});

test('full invite URL leaves market links unchanged', () => {
  const market = 'https://kalshi.com/markets/kxnflgame/x';
  assert.equal(applyKalshiReferral(market, 'https://kalshi.com/invite/abc'), market);
});

test('kalshiJoinUrl', () => {
  assert.equal(kalshiJoinUrl(null), 'https://kalshi.com');
  assert.equal(kalshiJoinUrl('BIGVIN'), 'https://kalshi.com/?r=BIGVIN');
  assert.equal(kalshiJoinUrl('https://kalshi.com/invite/xyz'), 'https://kalshi.com/invite/xyz');
});

test('applyReferralToMatches', () => {
  const out = applyReferralToMatches({
    matches: {a: {url: 'https://kalshi.com/markets/x/y', placeable: true}, b: {url: null}},
    matched: 1,
    total: 2,
  }, 'CODE');
  assert.equal(out.matches.a.url, 'https://kalshi.com/markets/x/y?r=CODE');
  assert.equal(out.matches.b.url, null);
  assert.equal(out.referralConfigured, true);
  assert.equal(out.joinUrl, 'https://kalshi.com/?r=CODE');
});
