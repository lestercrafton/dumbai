import test from 'node:test';
import assert from 'node:assert/strict';
import {runLinePick, gradeRunLine, homeCoverProbability} from './run-line.mjs';
import {moneylineExpectedValue} from './moneyline.mjs';
import {playableTotal} from './total-playable.mjs';

test('puck line picks need value at the price and pass otherwise', () => {
  const p = homeCoverProbability('nhl', 0.4, -1.5);
  assert.ok(p > 0 && p < 0.5);
  const pick = runLinePick('nhl', 2.5, {homeSpread: -1.5, homePrice: 200, awayPrice: -250});
  assert.equal(pick.side, 'home');
  assert.ok(moneylineExpectedValue(pick.probability, pick.playable) / 100 >= 0.03 - 1e-9);
  assert.equal(runLinePick('nhl', 0, {homeSpread: -1.5, homePrice: 100, awayPrice: -400}).side, null);
  assert.equal(gradeRunLine({side: 'home', homeSpread: -1.5}, 4, 2), 'win');
  assert.equal(gradeRunLine({side: 'away', homeSpread: -1.5}, 3, 2), 'win');
});

test('totals playable line keeps the edge bar', () => {
  assert.equal(playableTotal('nfl', 'under', 48.3), 49.5);
  assert.equal(playableTotal('nfl', 'over', 48.3), 47);
  assert.equal(playableTotal('cfb', 'over', 60), 57);
});
