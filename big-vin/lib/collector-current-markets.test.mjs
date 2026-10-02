import test from 'node:test';
import assert from 'node:assert/strict';
import {adaptCurrentCoreOdds,captureCurrentCollegeMarkets} from './collector-current-markets.mjs';
import {normalizeScoreboard} from './feeds/adapter.mjs';

const now=Date.parse('2026-10-02T19:00:00Z'),observedAt=new Date(now).toISOString(),start='2026-10-03T23:00:00Z';
const competition={id:'401856711',date:start,status:{type:{state:'pre',completed:false}},competitors:[{homeAway:'home',team:{id:'245',displayName:'Texas A&M Aggies'}},{homeAway:'away',team:{id:'8',displayName:'Arkansas Razorbacks'}}]};
const event={id:'401856711',date:start,season:{year:2026,type:2},competitions:[competition]};
const board={date:'2026-10-03',observedAt,sourceUrl:'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80',payload:{events:[event]}};
const team=(teamId,line,price)=>({team:{$ref:`http://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/2026/teams/${teamId}?lang=en&region=us`},current:{pointSpread:{american:line},spread:{american:price}},open:{pointSpread:{american:'-40'},spread:{american:'-110'}}});
const quote=()=>({count:1,pageIndex:1,pageCount:1,items:[{$ref:'http://sports.core.api.espn.com/v2/sports/football/leagues/college-football/events/401856711/competitions/401856711/odds/100?lang=en&region=us',provider:{id:'100',name:'DraftKings'},homeTeamOdds:team('245','-14','-108'),awayTeamOdds:team('8','+14','-112')}]});
const adapt=payload=>adaptCurrentCoreOdds(payload,event,{observedAt,now});

test('current exact core offer preserves reciprocal signed spreads and distinct actual prices',()=>{
 const odds=adapt(quote());assert.equal(odds.length,1);
 const game=normalizeScoreboard({events:[{...event,competitions:[{...competition,odds}]}]},'cfb',{retrievedAt:observedAt}).games[0];
 assert.equal(game.market.homeSpread,-14);assert.equal(game.market.awaySpread,14);
 assert.equal(game.market.homeSpreadPrice,-108);assert.equal(game.market.awaySpreadPrice,-112);
 assert.equal(game.market.provider,'DraftKings');assert.equal(game.market.observedAt,observedAt);
});

test('wrong event, competition, team membership or reciprocal signs rejects core offer',()=>{
 for(const mutate of [
  x=>{x.items[0].$ref=x.items[0].$ref.replace('events/401856711','events/401856712');},
  x=>{x.items[0].$ref=x.items[0].$ref.replace('competitions/401856711','competitions/401856712');},
  x=>{x.items[0].homeTeamOdds.team=x.items[0].awayTeamOdds.team;},
  x=>{x.items[0].awayTeamOdds.current.pointSpread.american='-14';},
  x=>{x.items[0].provider.id='999';},
 ]){const payload=quote();mutate(payload);assert.deepEqual(adapt(payload),[]);}
});

test('missing current price/side cannot borrow open odds or legacy favorite spread',()=>{
 for(const mutate of [
  x=>{delete x.items[0].awayTeamOdds.current;},
  x=>{delete x.items[0].homeTeamOdds.current.spread;},
  x=>{x.items[0].homeTeamOdds.current.spread.american='1.92';},
  x=>{delete x.items[0].homeTeamOdds.current.pointSpread;x.items[0].spread=-14;x.items[0].homeTeamOdds.favorite=true;},
 ]){const payload=quote();mutate(payload);assert.deepEqual(adapt(payload),[]);}
});

test('started, postgame, stale observations or after-start provider timestamps never become pregame captures',()=>{
 assert.deepEqual(adaptCurrentCoreOdds(quote(),event,{observedAt:start,now:Date.parse(start)}),[]);
 assert.deepEqual(adaptCurrentCoreOdds(quote(),{...event,status:{type:{state:'post',completed:true}}},{observedAt,now}),[]);
 assert.deepEqual(adaptCurrentCoreOdds(quote(),event,{observedAt:new Date(now-31*60000).toISOString(),now}),[]);
 const payload=quote();payload.items[0].lastUpdated=start;assert.deepEqual(adapt(payload),[]);
});

test('bounded fallback captures missing current market with its own source and preserves event identity',async()=>{
 const archived=[],calls=[];
 const result=await captureCurrentCollegeMarkets([board],async url=>{calls.push(url);return quote();},b=>archived.push(b),{now:()=>now});
 assert.equal(result.requested,1);assert.equal(result.boards.length,1);assert.deepEqual(result.failures,[]);
 assert.match(calls[0],/events\/401856711\/competitions\/401856711\/odds/);
 assert.equal(result.boards[0].observedAt,observedAt);assert.equal(result.boards[0].sourceGroup,'80');assert.equal(result.boards[0].scheduleSourceUrl,board.sourceUrl);
 assert.deepEqual(result.boards[0].payload.events[0].competitions[0].competitors,competition.competitors);assert.equal(archived.length,1);
 assert.equal(board.payload.events[0].competitions[0].odds,undefined);
});

test('existing priced market, completed game and clock crossing kickoff do not receive fallback captures',async()=>{
 const priced={...event,competitions:[{...competition,odds:adapt(quote())}]};
 const post={...event,id:'2',status:{type:{state:'post',completed:true}}};
 const skipped=await captureCurrentCollegeMarkets([{...board,payload:{events:[priced,post]}}],()=>{throw new Error('No request expected');},undefined,{now:()=>now});
 assert.equal(skipped.requested,0);assert.deepEqual(skipped.failures,[]);
 let time=now;
 const crossed=await captureCurrentCollegeMarkets([board],async()=>{time=Date.parse(start);return quote();},undefined,{now:()=>time});
 assert.equal(crossed.requested,1);assert.equal(crossed.boards.length,0);assert.equal(crossed.unavailable.length,1);
});
