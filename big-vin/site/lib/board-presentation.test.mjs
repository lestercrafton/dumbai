import test from 'node:test';
import assert from 'node:assert/strict';
import {centralDay, formatCentralClock, formatCentralTime, selectTodayEdge, displayLines} from './board-presentation.mjs';

const NOW = '2026-10-16T23:00:00Z';
const fixture = (overrides = {}) => ({
  id: 'game-1', sport: 'nfl', startTime: '2026-10-17T01:00:00Z',
  status: 'scheduled', completed: false, rank: 1, side: 'home', edge: 2.5,
  stale: false, lowEvidence: false,
  home: {name: 'Home Hawks', abbreviation: 'HAW'},
  away: {name: 'Away Bears', abbreviation: 'BEAR'},
  market: {homeSpread: 3.5, awaySpread: -3.5},
  projection: {predictedHomeMargin: -1, fairHomeSpread: 1},
  ...overrides,
});

test('Central dates differ from UTC and switch at the correct summer and winter midnight', () => {
  assert.equal(centralDay('2026-10-17T04:59:59Z'), '2026-10-16');
  assert.equal(centralDay('2026-10-17T05:00:00Z'), '2026-10-17');
  assert.equal(centralDay('2026-01-17T05:59:59Z'), '2026-01-16');
  assert.equal(centralDay('2026-01-17T06:00:00Z'), '2026-01-17');
  assert.equal(formatCentralTime('2026-10-17T00:30:00Z'), 'Oct 16, 7:30 PM CT');
});

test('Central clocks follow both daylight saving transitions', () => {
  assert.equal(formatCentralClock('2026-03-08T07:59:00Z'), '1:59 AM CT');
  assert.equal(formatCentralClock('2026-03-08T08:00:00Z'), '3:00 AM CT');
  assert.equal(formatCentralClock('2026-11-01T06:30:00Z'), '1:30 AM CT');
  assert.equal(formatCentralClock('2026-11-01T07:30:00Z'), '1:30 AM CT');
});

test('missing and malformed times never become the Unix epoch or throw', () => {
  for (const value of [null, '', '   ', 'not-a-date', Infinity, NaN, false, {}, new Date(NaN)]) {
    assert.equal(centralDay(value), null);
    assert.equal(formatCentralTime(value), 'Time TBA');
    assert.equal(formatCentralClock(value), 'Time TBA');
  }
  assert.equal(formatCentralTime(undefined), 'Time TBA');
  assert.equal(selectTodayEdge([], 'not-a-date'), null);
});

test('the hero compares actual edges across leagues and preserves the server rank and source objects', () => {
  const nfl = fixture({id: 'nfl-game', edge: 3, rank: 1});
  const cfb = fixture({id: 'cfb-game', sport: undefined, edge: 4, rank: 9});
  const slates = [{sport: 'nfl', games: [nfl]}, {sport: 'cfb', games: [cfb]}];
  const before = structuredClone(slates);
  Object.freeze(nfl); Object.freeze(cfb);
  for (const slate of slates) { Object.freeze(slate.games); Object.freeze(slate); }
  Object.freeze(slates);
  const winner = selectTodayEdge(slates, NOW);
  assert.equal(winner.id, 'cfb-game');
  assert.equal(winner.sport, 'cfb');
  assert.equal(winner.rank, 9);
  assert.deepEqual(slates, before);
  assert.equal(cfb.sport, undefined);
});

test('the hero rejects ineligible, past, next-day, nonpositive, and synthetic picks', () => {
  const valid = fixture({id: 'valid'});
  const cases = [
    {startTime: '2026-10-16T04:30:00Z'},
    {startTime: '2026-10-17T05:00:00Z'},
    {startTime: NOW},
    {startTime: '2026-10-16T22:59:00Z'},
    {startTime: null},
    {startTime: 'invalid'},
    {status: 'live'}, {status: 'completed'}, {status: 'awaiting-update'},
    {status: 'postponed'}, {status: 'cancelled'}, {completed: true},
    {stale: true}, {lowEvidence: true},
    {rank: null}, {rank: 0}, {rank: -1}, {rank: '1'},
    {side: null}, {side: 'over'},
    {edge: 0}, {edge: -1}, {edge: null}, {edge: Infinity}, {edge: '100'},
    {paperWager: {kind: 'synthetic-winner-even', homeSpread: 0, side: 'home', odds: 100}},
  ];
  for (const patch of cases) {
    const excluded = fixture({id: 'excluded', edge: 100, ...patch});
    assert.equal(selectTodayEdge([{sport: 'nfl', games: [excluded, valid]}], NOW)?.id, 'valid', JSON.stringify(patch));
    assert.equal(selectTodayEdge([{sport: 'nfl', games: [excluded]}], NOW), null, JSON.stringify(patch));
  }
  assert.equal(selectTodayEdge(null, NOW), null);
});

test('the hero includes late CT starts on the next Eastern and UTC dates', () => {
  const late = fixture({startTime: '2026-10-17T04:30:00Z'});
  assert.equal(selectTodayEdge([{sport: 'nfl', games: [late]}], NOW)?.id, late.id);
});

test('equal edges use kickoff, sport, and event ID as deterministic ties', () => {
  const later = fixture({id: 'early-id', startTime: '2026-10-17T02:00:00Z'});
  const nfl = fixture({id: 'a'});
  const cfbB = fixture({sport: 'cfb', id: 'b'});
  const cfbA = fixture({sport: 'cfb', id: 'a'});
  assert.equal(selectTodayEdge([{games: [later, nfl, cfbB, cfbA]}], NOW), cfbA);
});

test('repeated sport/event observations are deduplicated without merging different sports', () => {
  const first = fixture({edge: 1});
  const repeated = fixture({edge: 100});
  const otherSport = fixture({sport: 'cfb', edge: 3});
  assert.equal(selectTodayEdge([{games: [first, repeated, otherSport]}], NOW), otherSport);
});

test('home selection compares the same team even when the model predicts the opponent to win', () => {
  assert.deepEqual(displayLines(fixture()), {
    side: 'home', teamName: 'Home Hawks', teamShort: 'HAW',
    marketLine: 3.5, fairLine: 1, edge: 2.5, pick: 'HAW +3.5',
  });
});

test('away selection flips both spreads and preserves the supplied edge without recalculating it', () => {
  const game = fixture({
    side: 'away', edge: 4.125,
    market: {homeSpread: -7, awaySpread: 7},
    projection: {predictedHomeMargin: 3, fairHomeSpread: -3},
  });
  assert.deepEqual(displayLines(game), {
    side: 'away', teamName: 'Away Bears', teamShort: 'BEAR',
    marketLine: 7, fairLine: 3, edge: 4.125, pick: 'BEAR +7.0',
  });
});

test('zero lines remain Pick’em, with no negative zero', () => {
  const home = displayLines(fixture({market: {homeSpread: 0}, projection: {predictedHomeMargin: 2, fairHomeSpread: -2}, edge: 2}));
  assert.equal(home.marketLine, 0); assert.equal(home.pick, 'HAW PK');
  const away = displayLines(fixture({side: 'away', market: {homeSpread: 0}, projection: {predictedHomeMargin: -2, fairHomeSpread: 2}, edge: 2}));
  assert.equal(away.marketLine, 0); assert.equal(away.pick, 'BEAR PK');
  const noEdge = displayLines(fixture({side: null, edge: 0, market: {homeSpread: 0}, projection: {predictedHomeMargin: 0, fairHomeSpread: 0}}));
  assert.equal(noEdge.fairLine, 0); assert.equal(noEdge.edge, 0); assert.equal(noEdge.pick, null);
});

test('an explicitly absent side stays unpicked and uses home perspective', () => {
  const lines = displayLines(fixture({side: null}));
  assert.equal(lines.side, null);
  assert.equal(lines.teamName, 'Home Hawks');
  assert.equal(lines.marketLine, 3.5);
  assert.equal(lines.fairLine, 1);
  assert.equal(lines.pick, null);
});

test('null and nonnumeric source numbers remain unavailable', () => {
  for (const absent of [null, undefined, '', '0', NaN]) {
    const lines = displayLines(fixture({
      side: null, edge: absent,
      market: {homeSpread: absent},
      projection: {predictedHomeMargin: absent, fairHomeSpread: absent},
    }));
    assert.equal(lines.marketLine, null);
    assert.equal(lines.fairLine, null);
    assert.equal(lines.edge, null);
    assert.equal(lines.pick, null);
  }
  assert.equal(displayLines({}).teamName, 'Team');
});

test('archived opening wagers retain their saved spread and synthetic contracts never become ATS picks', () => {
  const archived = fixture({
    side: 'away', edge: 1.5,
    market: {homeSpread: -7},
    projection: {predictedHomeMargin: 3, fairHomeSpread: -3},
    paperWager: {kind: 'archived-opening-spread', homeSpread: -4.5, side: 'away', odds: -110},
  });
  const lines = displayLines(archived);
  assert.equal(lines.marketLine, 4.5); assert.equal(lines.fairLine, 3);
  assert.equal(lines.pick, 'BEAR +4.5'); assert.equal(lines.edge, 1.5);
  const synthetic = displayLines({...archived, paperWager: {kind: 'synthetic-winner-even', homeSpread: 0, side: 'home', odds: 100}});
  assert.equal(synthetic.side, null); assert.equal(synthetic.teamName, 'Home Hawks');
  assert.equal(synthetic.marketLine, null); assert.equal(synthetic.edge, null); assert.equal(synthetic.pick, null);
  assert.equal(synthetic.fairLine, -3);
});
