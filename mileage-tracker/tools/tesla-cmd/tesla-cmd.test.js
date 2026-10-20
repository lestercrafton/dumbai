'use strict';
const test = require('node:test');
const assert = require('node:assert');
const t = require('./tesla-cmd.js');

test('pairing link', () => assert.strictEqual(t.pairingUrl(), 'https://tesla.com/_ak/ovanova-mileage-tesla.vercel.app'));
test('auth url has command scopes and allowed redirect', () => {
  const u = new URL(t.authorizeUrl('s'));
  assert.match(u.searchParams.get('scope'), /vehicle_cmds/);
  assert.match(u.searchParams.get('scope'), /vehicle_charging_cmds/);
  assert.strictEqual(u.searchParams.get('redirect_uri'), 'http://localhost:8765/callback');
});
test('extract code from redirect URL', () => assert.strictEqual(t.extractCode('http://localhost:8765/callback?code=abc&state=x'), 'abc'));
test('argv includes vin and key', () => {
  const a = t.buildArgv('windows-vent', []);
  assert.deepStrictEqual(a.slice(0, 2), ['-vin', '7SAYGDEE4RA246655']);
  assert.strictEqual(a.at(-1), 'windows-vent');
});
test('charge limit validated', () => {
  assert.strictEqual(t.buildArgv('charging-set-limit', ['80']).at(-1), '80');
  assert.throws(() => t.buildArgv('charging-set-limit', ['30']));
});
test('schedule time validated', () => {
  assert.strictEqual(t.buildArgv('charging-schedule', ['23:30']).at(-1), '23:30');
  assert.throws(() => t.buildArgv('charging-schedule', ['25:00']));
});
test('temp defaults to F', () => assert.strictEqual(t.buildArgv('climate-set-temp', ['70']).at(-1), '70F'));
test('unknown command throws', () => assert.throws(() => t.buildArgv('self-destruct', [])));
