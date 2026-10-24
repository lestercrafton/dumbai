import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTeam, teamScore, matchGameEvent, matchPick, groupEvents, marketUrl, SERIES_BY_SPORT,
} from './kalshi-match.mjs';

test('normalizeTeam keeps school names, strips mascots', () => {
  assert.equal(normalizeTeam('Army Black Knights'), 'army');
  assert.equal(normalizeTeam('Tulsa Golden Hurricane'), 'tulsa');
  assert.equal(normalizeTeam('East Tennessee State Buccaneers'), 'east tennessee state');
  assert.equal(normalizeTeam('East Tennessee St.'), 'east tennessee state');
  assert.equal(normalizeTeam('Pennsylvania Quakers'), 'pennsylvania');
});

test('teamScore matches Kalshi short labels', () => {
  assert.ok(teamScore('Army Black Knights', 'Army') >= 85);
  assert.ok(teamScore('Yale Bulldogs', 'Yale') >= 85);
  assert.ok(teamScore('East Tennessee State Buccaneers', 'East Tennessee St.') >= 80);
});

test('matchGameEvent pairs home/away', () => {
  const markets = [
    { event_ticker: 'KXNCAAFGAME-26OCT23ARMYTLSA', ticker: 'KXNCAAFGAME-26OCT23ARMYTLSA-ARMY', title: 'Army wins', yes_sub_title: 'Army' },
    { event_ticker: 'KXNCAAFGAME-26OCT23ARMYTLSA', ticker: 'KXNCAAFGAME-26OCT23ARMYTLSA-TLSA', title: 'Tulsa wins', yes_sub_title: 'Tulsa' },
  ];
  const events = groupEvents(markets);
  const hit = matchGameEvent(
    { name: 'Tulsa Golden Hurricane', abbreviation: 'TLSA' },
    { name: 'Army Black Knights', abbreviation: 'ARMY' },
    events,
  );
  assert.ok(hit);
  assert.equal(hit.event.eventTicker, 'KXNCAAFGAME-26OCT23ARMYTLSA');
});

test('matchPick moneyline returns placeable YES ticker', () => {
  const catalogs = {
    game: groupEvents([
      { event_ticker: 'KXMLBGAME-26OCT27MILTB', ticker: 'KXMLBGAME-26OCT27MILTB-MIL', title: 'Milwaukee wins', yes_sub_title: 'Milwaukee', yes_ask_dollars: '0.5500' },
      { event_ticker: 'KXMLBGAME-26OCT27MILTB', ticker: 'KXMLBGAME-26OCT27MILTB-TB', title: 'Tampa Bay wins', yes_sub_title: 'Tampa Bay', yes_ask_dollars: '0.4600' },
    ]),
    spread: [],
    total: [],
  };
  const m = matchPick({
    id: 'mlb:1', sport: 'mlb', market: 'ml', line: null,
    home: { name: 'Tampa Bay Rays', abbreviation: 'TB' },
    away: { name: 'Milwaukee Brewers', abbreviation: 'MIL' },
    pickName: 'Milwaukee Brewers', pickAbbr: 'MIL',
  }, catalogs);
  assert.equal(m.matched, true);
  assert.equal(m.kind, 'moneyline');
  assert.equal(m.side, 'yes');
  assert.equal(m.marketTicker, 'KXMLBGAME-26OCT27MILTB-MIL');
  assert.equal(m.placeable, true);
  assert.match(m.url, /^https:\/\/kalshi\.com\/markets\/kxmlbgame\//);
});

test('matchPick spread favorite maps to wins-by-over', () => {
  const game = groupEvents([
    { event_ticker: 'KXNCAAFGAME-26OCT23ARMYTLSA', ticker: 'KXNCAAFGAME-26OCT23ARMYTLSA-ARMY', yes_sub_title: 'Army' },
    { event_ticker: 'KXNCAAFGAME-26OCT23ARMYTLSA', ticker: 'KXNCAAFGAME-26OCT23ARMYTLSA-TLSA', yes_sub_title: 'Tulsa' },
  ]);
  const spread = groupEvents([
    { event_ticker: 'KXNCAAFSPREAD-26OCT23ARMYTLSA', ticker: 'KXNCAAFSPREAD-26OCT23ARMYTLSA-ARMY23', title: 'Army wins by over 22.5 points', yes_sub_title: 'Army wins by over 22.5 points' },
  ]);
  const m = matchPick({
    id: 'cfb:1', sport: 'cfb', line: -22.5,
    home: { name: 'Tulsa Golden Hurricane', abbreviation: 'TLSA' },
    away: { name: 'Army Black Knights', abbreviation: 'ARMY' },
    pickName: 'Army Black Knights', pickAbbr: 'ARMY',
  }, { game, spread, total: [] });
  assert.equal(m.matched, true);
  assert.equal(m.kind, 'spread');
  assert.equal(m.marketTicker, 'KXNCAAFSPREAD-26OCT23ARMYTLSA-ARMY23');
  assert.equal(m.side, 'yes');
});

test('marketUrl and series map', () => {
  assert.equal(marketUrl('KXNFLGAME', 'KXNFLGAME-26NOV02CHISEA'), 'https://kalshi.com/markets/kxnflgame/kxnflgame-26nov02chisea');
  assert.equal(SERIES_BY_SPORT.cfb.game, 'KXNCAAFGAME');
});
