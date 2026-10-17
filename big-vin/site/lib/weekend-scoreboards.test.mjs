import test from 'node:test';
import assert from 'node:assert/strict';
import {scoreboardUrls, fetchScoreboard, isThreeDayScoreboardWindow} from './feeds/adapter.mjs';

const sports = ['nfl', 'cfb', 'nba', 'wnba', 'cbb', 'nhl', 'mlb'];
const dates = urls => urls.map(url => new URL(url).searchParams.get('dates'));
const event = (id, date) => ({id, date, season: {year: 2026, type: 2}, competitions: [{
  status: {type: {state: 'pre', completed: false}},
  competitors: [{homeAway: 'home', team: {id: '1', displayName: 'Home'}}, {homeAway: 'away', team: {id: '2', displayName: 'Away'}}],
}]});

test('all seven weekend leagues request the exact three compact dates including year, leap-day and DST boundaries', () => {
  const windows = [
    ['2026-10-16', '2026-10-18', ['20261016', '20261017', '20261018']],
    ['2026-10-30', '2026-11-01', ['20261030', '20261031', '20261101']],
    ['2026-12-31', '2027-01-02', ['20261231', '20270101', '20270102']],
    ['2028-02-28', '2028-03-01', ['20280228', '20280229', '20280301']],
  ];
  for (const sport of sports) for (const [startDate, endDate, expected] of windows) {
    const options = {startDate, endDate, weekendDaily: true};
    assert.equal(isThreeDayScoreboardWindow(options), true);
    const urls = scoreboardUrls(sport, options);
    assert.deepEqual([...new Set(dates(urls))], expected, sport);
    assert.equal(urls.length, sport === 'cfb' ? 6 : 3);
    if (sport === 'cfb') for (const date of expected) assert.deepEqual(urls.filter(url => new URL(url).searchParams.get('dates') === date).map(url => new URL(url).searchParams.get('groups')), ['80', '81']);
  }
});

test('existing one-day and week URL behavior is retained', () => {
  for (const sport of sports) {
    assert.equal(isThreeDayScoreboardWindow({startDate: '2026-10-16', endDate: '2026-10-16'}), false);
    assert.equal(isThreeDayScoreboardWindow({startDate: '2026-10-16', endDate: '2026-10-22'}), false);
    const single = scoreboardUrls(sport, {startDate: '2026-10-16', endDate: '2026-10-16'});
    assert.equal(single.length, sport === 'cfb' ? 2 : 1);
    assert.ok(dates(single).every(date => date === (sport === 'cfb' ? '20261016-20261016' : '20261016')));
    const week = scoreboardUrls(sport, {startDate: '2026-10-16', endDate: '2026-10-22'});
    assert.equal(week.length, ['wnba', 'cbb'].includes(sport) ? 7 : sport === 'cfb' ? 2 : 1);
    if (!['wnba', 'cbb'].includes(sport)) assert.ok(dates(week).every(date => date === '20261016-20261022'));
    // Automation's range collector retains its original contract unless the
    // new display transport explicitly requests the weekend daily strategy.
    const originalThree = scoreboardUrls(sport, {startDate: '2026-10-16', endDate: '2026-10-18'});
    assert.equal(originalThree.length, ['wnba', 'cbb'].includes(sport) ? 3 : sport === 'cfb' ? 2 : 1);
  }
});

test('server weekend aggregation keeps actual daily events and provenance without losing another day to one failure', async () => {
  for (const sport of sports) {
    const requested = [];
    const board = await fetchScoreboard(sport, {startDate: '2026-10-16', endDate: '2026-10-18'}, async url => {
      requested.push(url);
      const query = new URL(url).searchParams, date = query.get('dates');
      if (date === '20261017') return {ok: false, status: 503};
      const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T18:00:00Z`;
      return {ok: true, json: async () => ({events: [event(date, iso)]})};
    });
    assert.deepEqual([...new Set(dates(requested))], ['20261016', '20261017', '20261018']);
    assert.deepEqual(board.games.map(game => game.id), ['20261016', '20261018']);
    assert.equal(board.partialLiveCoverage, true);
    assert.ok(board.warnings.some(warning => /weekend.*failed/.test(warning)), sport);
    assert.ok(board.sourceUrls.every(url => new URL(url).searchParams.get('dates') !== '20261017'));
    for (const game of board.games) assert.equal(new URL(game.sourceUrl).searchParams.get('dates'), game.id);
    if (sport !== 'cfb') assert.ok(!board.warnings.some(warning => /capped at 25/.test(warning)), sport);
  }
});

test('successful empty dates are explicit partial results, complete successful checks stay unverified, and all failures throw', async () => {
  for (const sport of sports) {
    const options = {startDate: '2026-10-16', endDate: '2026-10-18'};
    const partial = await fetchScoreboard(sport, options, async url => ({ok: new URL(url).searchParams.get('dates') !== '20261017', status: 503, json: async () => ({events: []})}));
    assert.deepEqual(partial.games, []);
    assert.equal(partial.partialLiveCoverage, true);
    assert.ok(partial.warnings.some(warning => /failed/.test(warning)));
    const complete = await fetchScoreboard(sport, options, async () => ({ok: true, json: async () => ({events: []})}));
    assert.equal(complete.partialLiveCoverage, false);
    assert.equal(complete.completeness, 'unverified');
    assert.ok(!complete.warnings.some(warning => /capped at 25/.test(warning)));
    await assert.rejects(() => fetchScoreboard(sport, options, async () => ({ok: false, status: 503})), /HTTP 503/);
  }
});
