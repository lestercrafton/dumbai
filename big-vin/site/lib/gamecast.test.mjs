import test from 'node:test';
import assert from 'node:assert/strict';
import {espnGamecastUrl} from './gamecast.mjs';

test('Gamecast preserves the provider desktop matchup link for every supported sport', () => {
  for (const [sport,path] of Object.entries({nfl:'nfl',cfb:'college-football',nba:'nba',wnba:'wnba',cbb:'mens-college-basketball',nhl:'nhl',mlb:'mlb'})) {
    const href=`https://www.espn.com/${path}/game/_/gameId/401858265/away-home`;
    const row={id:'401858265',sport,links:[{rel:['summary','event'],href:href+'-mobile'},{rel:['summary','desktop','event'],href}]};
    assert.equal(espnGamecastUrl(row),href);
    assert.equal(espnGamecastUrl({...row,links:undefined,gamecastUrl:href}),href);
  }
});

test('legacy fallback requires a known ESPN source and never substitutes another provider identity', () => {
  assert.equal(espnGamecastUrl({id:'401858265',sport:'cfb',source:'ESPN scoreboard'}),'https://www.espn.com/college-football/game/_/gameId/401858265');
  assert.equal(espnGamecastUrl({id:'401858265',sport:'cfb',source:'SportsDataverse hoopR ESPN schedule archive'}),'https://www.espn.com/college-football/game/_/gameId/401858265');
  for (const row of [{id:'mlb:823093',sport:'mlb',source:'MLB StatsAPI schedule'},{id:'823093',sport:'mlb',source:'MLB StatsAPI schedule'},{id:'2026_06_HOU_JAX',sport:'nfl',source:'nflverse game data'},{id:'401858265',sport:'cfb'}]) assert.equal(espnGamecastUrl(row),null);
});

test('mismatched games, sports and unsafe destinations are rejected', () => {
  for (const href of ['https://www.espn.com.evil.test/college-football/game/_/gameId/401858265','https://www.espn.com/college-football/game/_/gameId/4018582650','https://www.espn.com/nfl/game/_/gameId/401858265','https://www.espn.com/college-football/game/_/gameId/999','javascript:alert(1)','https://someone@www.espn.com/college-football/game/_/gameId/401858265']) assert.equal(espnGamecastUrl({id:'401858265',sport:'cfb',gamecastUrl:href}),null);
  assert.equal(espnGamecastUrl({id:'401858265',sport:'cfb',links:[{rel:['summary','event'],href:'http://www.espn.com/college-football/game/_/gameId/401858265'}]}),'https://www.espn.com/college-football/game/_/gameId/401858265');
});
