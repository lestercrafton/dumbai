import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOtpEmail, KARMA_URL } from './my-bankroll-email.mjs';

test('OTP email is warm, keeps code prominent, includes karma link', () => {
  const { subject, text, karmaUrl } = buildOtpEmail({ code: '424242' });
  assert.equal(karmaUrl, 'https://cash.app/$bigvinsports');
  assert.equal(KARMA_URL, 'https://cash.app/$bigvinsports');
  assert.match(subject, /424242/);
  assert.match(subject, /fun/i);
  assert.match(text, /424242/);
  assert.match(text, /entertainment/i);
  assert.match(text, /have fun|fun of it/i);
  assert.match(text, /Boost your karma/i);
  assert.ok(text.includes(KARMA_URL));
  // Code appears on its own indented line for prominence
  assert.match(text, /^\s{4}424242$/m);
});
