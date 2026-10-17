import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchScoreboard,scoreboardUrl,scoreboardUrls} from './feeds/adapter.mjs';

const window={startDate:'2026-10-26',endDate:'2026-11-01'};
const dates=['20261026','20261027','20261028','20261029','20261030','20261031','20261101'];
const event=(id,date)=>({id,date,season:{year:2027,type:2},competitions:[{status:{type:{state:'pre',completed:false}},competitors:[{homeAway:'home',team:{id:'1',displayName:'Home'}},{homeAway:'away',team:{id:'2',displayName:'Away'}}]}]});

test('a CBB week requests all seven Division I daily scoreboards across month and DST boundaries',()=>{
 const urls=scoreboardUrls('cbb',window);
 assert.deepEqual(urls.map(url=>new URL(url).searchParams.get('dates')),dates);
 assert.ok(urls.every(url=>new URL(url).searchParams.get('groups')==='50'));
 assert.equal(scoreboardUrls('cbb',{startDate:window.startDate,endDate:window.startDate}).length,1);
 assert.throws(()=>scoreboardUrl('cbb',window),/Use one date/);
 assert.throws(()=>scoreboardUrls('cbb',{startDate:'2026-10-01',endDate:'2026-11-01'}),/at most 31 days/);
});

test('CBB weekly fetching aggregates daily games, retains source dates and deduplicates repeated events',async()=>{
 const requested=[];
 const repeated=event('repeat','2026-10-26T18:00:00Z');
 const board=await fetchScoreboard('cbb',window,async url=>{
  requested.push(url);
  const date=new URL(url).searchParams.get('dates');
  const iso=`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`;
  return {ok:true,json:async()=>({events:[event(date,`${iso}T18:00:00Z`),repeated]})};
 });
 assert.equal(requested.length,7);
 assert.equal(board.gameCount,8);
 assert.equal(board.games.filter(game=>game.id==='repeat').length,1);
 assert.deepEqual(board.sourceUrls.map(url=>new URL(url).searchParams.get('dates')),dates);
 for(const date of dates){
  const game=board.games.find(game=>game.id===date);
  assert.equal(new URL(game.sourceUrl).searchParams.get('dates'),date);
 }
 assert.equal(board.partialLiveCoverage,false);
 assert.equal(board.completeness,'unverified');
});

test('a failed CBB daily scoreboard does not return a silently incomplete weekly board',async()=>{
 await assert.rejects(()=>fetchScoreboard('cbb',window,async url=>{
  const date=new URL(url).searchParams.get('dates');
  return date==='20261029'?{ok:false,status:503}:{ok:true,json:async()=>({events:[]})};
 }),/ESPN cbb HTTP 503/);
});
