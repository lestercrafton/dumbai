import test from 'node:test';
import assert from 'node:assert/strict';
import {winProbability, fairAmericanOdds, moneylinePair, moneylineComparison} from './moneyline.mjs';
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

const quotedGame = {home: {name: 'Kansas City', abbreviation: 'KC'}, away: {name: 'Buffalo', abbreviation: 'BUF'},
  projection: {predictedHomeMargin: 6, fairHomeSpread: -6}, side: 'home',
  market: {homeSpread: -3, homeMoneyline: -155, awayMoneyline: 135, provider: 'Book', observedAt: '2026-10-17T12:00:00Z'}};

test('comparison uses actual quoted ML for the same team as the fair line', () => {
  const pair = moneylineComparison(quotedGame, 'nfl');
  assert.equal(pair.team, 'KC');
  assert.equal(pair.vegas, '-155');
  assert.equal(pair.implied, String(fairAmericanOdds(winProbability(6, 'nfl'))));
  assert.equal(pair.quote.provider, 'Book');
  assert.equal(pair.quote.observedAt, quotedGame.market.observedAt);
  const away = moneylineComparison({...quotedGame, side: 'away'}, 'nfl');
  assert.equal(away.team, 'BUF');
  assert.equal(away.vegas, '+135');
  assert.equal(away.implied, '+' + fairAmericanOdds(winProbability(-6, 'nfl')));
});

test('missing or invalid moneyline stays unavailable, never converted from a spread or ATS juice', () => {
  for (const price of [undefined, null, '', '-155', 0, 99, -110.5, Infinity]) {
    const pair = moneylineComparison({...quotedGame, odds: -110, market: {...quotedGame.market, homeMoneyline: price, homeSpreadPrice: -110}}, 'nfl');
    assert.equal(pair.vegas, '—');
    assert.equal(pair.quote, null);
  }
  assert.equal(moneylineComparison({...quotedGame, market: {...quotedGame.market, homeMoneyline: 100}}, 'nfl').vegas, '+100');
  assert.equal(moneylineComparison({...quotedGame, moneylineMarket: null}, 'nfl').vegas, '—');
});

test('saved spread and latest moneyline retain separate snapshots without changing the record', () => {
  const game = {...quotedGame, archived: true, rank: 4, market: {homeSpread: -4, observedAt: '2026-10-15T12:00:00Z'},
    moneylineMarket: {...quotedGame.market}, paperWager: {kind: 'archived-opening-spread', homeSpread: -2, odds: -110}};
  const before = structuredClone(game);
  const pair = moneylineComparison(game, 'nfl');
  assert.equal(pair.vegas, '-155');
  assert.equal(pair.quote.label, 'Vegas ML (latest)');
  assert.equal(pair.quote.observedAt, '2026-10-17T12:00:00Z');
  assert.deepEqual(game, before);
  assert.equal(moneylineComparison({...game, moneylineMarket: null}, 'nfl').vegas, '—');
  const historical = moneylineComparison({...game, completed: true}, 'nfl');
  assert.equal(historical.quote.label, 'Vegas ML (feed)');
  assert.equal(historical.quote.historical, true);
});

test('comparison respects fair-line overrides and hides unpicked or synthetic games', () => {
  const changed = {...quotedGame, projection: {...quotedGame.projection, fairHomeSpread: -8}};
  assert.equal(moneylineComparison(changed, 'nfl').implied, String(fairAmericanOdds(winProbability(8, 'nfl'))));
  assert.equal(moneylineComparison({...quotedGame, side: null}, 'nfl'), null);
  assert.equal(moneylineComparison({...quotedGame, paperWager: {kind: 'synthetic-winner-even'}}, 'nfl'), null);
  assert.equal(moneylineComparison({...quotedGame, projection: null}, 'nfl'), null);
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
