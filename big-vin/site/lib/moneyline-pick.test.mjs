import test from 'node:test';
import assert from 'node:assert/strict';
import {spreadSelection} from './pick-revisions.mjs';
import {moneylineMarket} from './feeds/adapter.mjs';

test('MLB markets become priced moneyline offers', () => {
  const m = moneylineMarket({homeSpread: -1.5, awaySpread: 1.5, homeSpreadPrice: 150, awaySpreadPrice: -180, homeMoneyline: -150, awayMoneyline: 130}, 'mlb');
  assert.equal(m.homeSpread, 0); assert.equal(m.homeSpreadPrice, -150); assert.equal(m.awaySpreadPrice, 130); assert.equal(m.runLineHomeSpread, -1.5);
  assert.equal(moneylineMarket({homeSpread: -1.5, homeMoneyline: -150, awayMoneyline: null}, 'mlb').homeSpread, null);
  assert.equal(moneylineMarket({homeSpread: -3}, 'nfl').homeSpread, -3);
  assert.equal(moneylineMarket({homeSpread: 1.5, homeMoneyline: 120, awayMoneyline: -140}, 'nhl').homeSpread, 1.5);
  assert.equal(spreadSelection(0.5, 1.5, {sport: 'nhl', homePrice: -200, awayPrice: 170}).side, 'home');
});

test('moneyline picks need value at the price, the same bar on both sides', () => {
  // Small home lean but home is priced as a heavy favorite: the dog has value.
  assert.equal(spreadSelection(0.2, 0, {sport: 'mlb', homePrice: -200, awayPrice: 170}).side, 'away');
  // Fair prices: pass.
  assert.equal(spreadSelection(0, 0, {sport: 'mlb', homePrice: -110, awayPrice: -110}).side, null);
  // Clear home edge at an even price.
  assert.equal(spreadSelection(1, 0, {sport: 'mlb', homePrice: 100, awayPrice: -120}).side, 'home');
  // Mirror image picks the mirror side.
  assert.equal(spreadSelection(-1, 0, {sport: 'mlb', homePrice: -120, awayPrice: 100}).side, 'away');
  // Missing a price: no pick. Old puck-line records keep the margin rule.
  assert.equal(spreadSelection(1, 0, {sport: 'mlb', homePrice: 100}).side, null);
  assert.equal(spreadSelection(0.5, 1.5).side, 'home');
});

test('playable price is the worst quote that still clears the value bar', async () => {
  const {worstPlayablePrice, moneylineExpectedValue} = await import('./moneyline.mjs');
  for (const p of [0.35, 0.48, 0.5, 0.6, 0.72]) {
    const o = worstPlayablePrice(p);
    assert.ok(moneylineExpectedValue(p, o) / 100 >= 0.03 - 1e-9, `p=${p} o=${o}`);
    const worse = o > 0 ? (o - 1 < 100 ? -101 : o - 1) : o - 1;
    assert.ok(moneylineExpectedValue(p, worse) / 100 < 0.03, `p=${p} worse=${worse}`);
  }
});
