import test from 'node:test';
import assert from 'node:assert/strict';
import {matchMlbFinals,unchangedGrade,eventSummaryUrl,matchEspnSummary,selectSummaryCandidates} from './live-finals.mjs';
import {gradeForecast} from './results.mjs';
import {replayBankroll} from './bankroll.mjs';
const source='https://statsapi.mlb.com/api/v1/schedule';
const game=(time,score=7)=>({gamePk:1,gameDate:time,status:{abstractGameState:'Final',detailedState:'Final'},teams:{home:{team:{abbreviation:'PIT'},score},away:{team:{abbreviation:'MIL'},score:4}}});
const forecast={id:'v:1',gameId:'espn-1',homeId:'mlb:PIT',awayId:'mlb:MIL',startTime:'2026-09-17T16:35:00Z',predictedMargin:.3,marketHomeSpread:1.5,side:'home',odds:-110};
test('verified MLB final grades the saved side and price without changing inputs',()=>{const before=JSON.stringify(forecast);const m=matchMlbFinals({dates:[{games:[game(forecast.startTime)]}]},[forecast],source);const r=gradeForecast(forecast,m.get('espn-1'),'2026-09-17T21:00:00Z');assert.equal(r.outcome,'win');assert.equal(r.pnl,100/110);assert.equal(JSON.stringify(forecast),before);});
test('postponed MLB original is void and its separate makeup is graded only once',()=>{
 const original={...forecast,id:'v:original',gameId:'401817035',sport:'mlb',cohort:'live',modelVersion:'test',startTime:'2026-09-22T22:35:00Z',odds:-207};
 const makeup={...original,id:'v:makeup',gameId:'401923610',startTime:'2026-09-23T17:35:00Z'};
 const postponed=gradeForecast(original,{status:'postponed',completed:false,sourceUrl:'https://www.espn.com/mlb/game/_/gameId/401817035'},'2026-09-25T12:00:00Z');
 const final=gradeForecast(makeup,{status:'completed',completed:true,homeScore:4,awayScore:2,sourceUrl:'https://www.espn.com/mlb/game/_/gameId/401923610'},'2026-09-25T12:00:00Z');
 assert.equal(postponed.status,'void');assert.equal(postponed.pnl,null);assert.equal(postponed.homeScore,undefined);
 assert.equal(final.status,'completed');assert.equal(final.outcome,'win');
 const replay=replayBankroll([{...original,result:postponed},{...makeup,result:final}]);
 assert.equal(replay.blockedBy,null);assert.equal(replay.pricedFinals,1);assert.equal(replay.plays[original.id].stake,null);assert.equal(replay.days[1].stake,10);
 assert.equal(gradeForecast(original,{status:'suspended',completed:false},'2026-09-25T12:00:00Z'),null);
});
test('doubleheaders use start times; ambiguous, live, and suspended games stay ungraded',()=>{const later='2026-09-17T22:35:00Z';const m=matchMlbFinals({dates:[{games:[game(forecast.startTime),game(later,2)]}]},[forecast,{...forecast,gameId:'espn-2',startTime:later}],source);assert.equal(m.get('espn-1').homeScore,7);assert.equal(m.get('espn-2').homeScore,2);assert.equal(matchMlbFinals({dates:[{games:[game(later)]}]},[forecast],source).size,0);assert.equal(matchMlbFinals({dates:[{games:[game(forecast.startTime),game(forecast.startTime)]}]},[forecast],source).size,0);for(const status of [{abstractGameState:'Live',detailedState:'In Progress'},{abstractGameState:'Final',detailedState:'Suspended'}])assert.equal(matchMlbFinals({dates:[{games:[{...game(forecast.startTime),status}]}]},[forecast],source).size,0);});
test('new timestamps do not duplicate grades but score corrections do',()=>{const old={status:'completed',homeScore:7,awayScore:4,outcome:'win',pnl:1,observedAt:'old'};assert.equal(unchangedGrade(old,{...old,observedAt:'new'}),true);assert.equal(unchangedGrade(old,{...old,homeScore:2,outcome:'loss',pnl:-1}),false);});
test('a verified date change backfills settlement metadata even when the score is unchanged',()=>{
 const f={...forecast,sport:'mlb',cohort:'live',modelVersion:'test',startTime:'2026-09-27T19:05:00Z'};
 const before=structuredClone(f);
 const result=gradeForecast(f,{startTime:'2026-09-25T17:05:00Z',status:'completed',completed:true,homeScore:7,awayScore:4,sourceUrl:source},'2026-09-26T15:00:00Z');
 assert.equal(result.playedAt,'2026-09-25T17:05:00Z');
 assert.equal(unchangedGrade({...result,playedAt:undefined},result),false);
 assert.deepEqual(f,before);
});
const cfbForecast={...forecast,gameId:'401900001',sport:'cfb',homeId:'2',awayId:'3'};
const summary=()=>({header:{id:cfbForecast.gameId,week:3,competitions:[{date:forecast.startTime,status:{type:{state:'post',completed:true,name:'STATUS_FINAL'}},competitors:[{homeAway:'home',score:'7',team:{id:'2',abbreviation:'H'}},{homeAway:'away',score:'4',team:{id:'3',abbreviation:'A'}}]}]}});
test('summary checks exact event and home/away identities before supplying a final',()=>{
 const before=JSON.stringify(cfbForecast),url=eventSummaryUrl('cfb',cfbForecast.gameId),raw=summary();
 const g=matchEspnSummary(raw,cfbForecast,url,'2026-09-17T21:00:00Z');
 assert.equal(g.completed,true);assert.equal(g.homeScore,7);assert.equal(g.awayScore,4);assert.equal(g.sourceUrl,url);assert.equal(gradeForecast(cfbForecast,g).pnl,100/110);assert.equal(JSON.stringify(cfbForecast),before);
 assert.equal(matchEspnSummary({...raw,header:{...raw.header,id:'401900002'}},cfbForecast,url),null);
 assert.equal(matchEspnSummary(raw,{...cfbForecast,homeId:'3',awayId:'2'},url),null);
 raw.header.competitions[0].date='invalid';assert.equal(matchEspnSummary(raw,cfbForecast,url),null);
 assert.throws(()=>eventSummaryUrl('cfb','1&event=2'));assert.throws(()=>eventSummaryUrl('unknown','1'));
});
test('live and suspended summaries never turn their displayed scores into finals',()=>{
 for(const type of [{state:'in',completed:false,name:'STATUS_IN_PROGRESS'},{state:'post',completed:false,name:'STATUS_SUSPENDED'}]){
  const raw=summary();raw.header.competitions[0].status.type=type;
  const g=matchEspnSummary(raw,cfbForecast,eventSummaryUrl('cfb',cfbForecast.gameId),'2026-09-17T21:00:00Z');assert.equal(g.completed,false);assert.equal(gradeForecast(cfbForecast,g),null);
 }
});
test('summary fallback deduplicates versions and rotates every pending date without starving old games',()=>{
 const pending=Array.from({length:14},(_,i)=>({...cfbForecast,id:`v1:${i}`,gameId:String(100+i),startTime:`2026-09-${String(i<2?1:17).padStart(2,'0')}T16:35:00Z`}));
 const board=new Map([['113',{}]]),attempts={};
 const first=selectSummaryCandidates([...pending,{...pending[0],id:'v2:0'}],board,attempts,12);
 assert.equal(first.length,12);assert.equal(first[0].gameId,'100');assert.equal(first[1].gameId,'101');assert.equal(new Set(first.map(f=>f.gameId)).size,12);
 for(const f of first)attempts[f.gameId]='2026-09-17T21:00:00Z';
 const next=selectSummaryCandidates(pending,board,attempts,12);assert.equal(next[0].gameId,'112');assert.ok(!next.some(f=>f.gameId==='113'));
});
