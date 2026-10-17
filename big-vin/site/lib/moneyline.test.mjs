import test from 'node:test';
import assert from 'node:assert/strict';
import {winProbability, fairAmericanOdds, moneylinePair} from './moneyline.mjs';
import {sortBoard, boardConferences, filterByConference} from './board-sort.mjs';

test('a pick-em margin is a coin flip and fair odds are -100', () => {
  assert.equal(Math.round(winProbability(0, 'nfl') * 100), 50);
  assert.equal(fairAmericanOdds(0.5), -100);
  assert.equal(fairAmericanOdds(0.75), -300);
  assert.equal(fairAmericanOdds(0.25), 300);
});

test('moneyline pair prices the pick team from both spreads', () => {
  const game = {home: {abbreviation: 'KC'}, away: {abbreviation: 'BUF'}, predictedMargin: 6, marketHomeSpread: -3, side: 'home'};
  const pair = moneylinePair(game, 'nfl');
  assert.equal(pair.team, 'KC');
  // Big Vin expects a bigger KC win than Vegas, so its fair price is shorter.
  assert.ok(Number(pair.bigVinFair) < Number(pair.vegasImplied), `${pair.bigVinFair} vs ${pair.vegasImplied}`);
  assert.equal(moneylinePair({home: 'A', away: 'B', predictedMargin: null, marketHomeSpread: -3}, 'nfl'), null);
  assert.equal(moneylinePair({home: 'A', away: 'B', predictedMargin: 3, marketHomeSpread: -3}, 'nfl'), null);
});

test('sort modes keep rank numbers while changing listing order', () => {
  const games = [
    {id: 'late-top', rank: 1, startTime: '2026-10-17T23:00:00Z'},
    {id: 'early-low', rank: 5, startTime: '2026-10-17T16:00:00Z'},
    {id: 'unranked', rank: null, startTime: '2026-10-17T18:00:00Z'},
  ];
  assert.deepEqual(sortBoard(games, 'rank').map(g => g.id), ['late-top', 'early-low', 'unranked']);
  assert.deepEqual(sortBoard(games, 'time').map(g => g.id), ['early-low', 'unranked', 'late-top']);
  assert.deepEqual(sortBoard(games, 'rank-time').map(g => g.id), ['late-top', 'early-low', 'unranked']);
  assert.equal(sortBoard(games, 'time')[0].rank, 5);
});

test('conference filter only keeps games involving that conference', () => {
  const games = [
    {id: '1', conferences: ['SEC']},
    {id: '2', conferences: ['Big Ten', 'SEC']},
    {id: '3', conferences: ['ACC']},
    {id: '4'},
  ];
  assert.deepEqual(boardConferences(games), ['ACC', 'Big Ten', 'SEC']);
  assert.deepEqual(filterByConference(games, 'SEC').map(g => g.id), ['1', '2']);
  assert.equal(filterByConference(games, 'all').length, 4);
});
