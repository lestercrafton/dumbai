import test from 'node:test';
import assert from 'node:assert/strict';
import {providerSeasonContext,activeProviderSeason,mergeSeasonContexts} from './provider-season.mjs';
import {normalizeScoreboard} from './feeds/adapter.mjs';
const nfl={year:2026,displayName:'2026',startDate:'2026-08-06T07:00Z',endDate:'2027-02-16T07:59Z'};
const nba={year:2027,displayName:'2026-27',startDate:'2026-09-30T07:00Z',endDate:'2027-06-26T06:59Z'};
test('league season metadata survives empty schedules and preserves cross-calendar labels',()=>{
 const board=normalizeScoreboard({leagues:[{season:nfl}],events:[]},'nfl',{retrievedAt:'2026-10-17T00:00Z'});
 assert.equal(board.games.length,0);assert.equal(board.seasonContext.year,2026);
 assert.equal(activeProviderSeason(board.seasonContext,Date.parse('2027-01-10T00:00Z')),2026);
 const basketball=providerSeasonContext({leagues:[{season:nba}]});
 assert.equal(basketball.label,'2026-27');assert.equal(activeProviderSeason(basketball,Date.parse('2026-10-17T00:00Z')),2027);
});
test('missing, invalid, conflicting or out-of-interval metadata never guesses a current season',()=>{
 for(const payload of [{},{events:[{season:{year:2026}}]},{season:{year:'2026'}},{leagues:[{season:nfl}],season:{year:2027}}])assert.equal(activeProviderSeason(providerSeasonContext(payload)),null);
 assert.equal(activeProviderSeason({year:2026}),null);
 assert.equal(activeProviderSeason(nfl,Date.parse('2027-06-01T00:00Z')),null);
 assert.equal(activeProviderSeason(nba,Date.parse('2026-08-01T00:00Z')),null);
});
test('multi-day responses reject conflicting seasons and keep newest matching metadata',()=>{
 const first=providerSeasonContext({leagues:[{season:nfl}]},{observedAt:'2026-10-16T00:00Z'});
 const latest={...first,observedAt:'2026-10-17T00:00Z'};
 assert.equal(mergeSeasonContexts([{seasonContext:first},{seasonContext:latest}]),latest);
 assert.equal(mergeSeasonContexts([{seasonContext:first},{seasonContext:{...nba,observedAt:latest.observedAt}}]),null);
 assert.equal(mergeSeasonContexts([{}]),null);
});
