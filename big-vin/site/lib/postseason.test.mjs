import test from 'node:test';
import assert from 'node:assert/strict';
import {postseasonMetadata,postseasonSlotForForecast,completedBestOfThreeSeries,inferUnneededPlayoffGame,seriesLookupCandidates} from './postseason.mjs';
import {normalizeScoreboard} from './feeds/adapter.mjs';
import {gradeForecast} from './results.mjs';
import {replayBankroll} from './bankroll.mjs';

const observedAt='2026-10-02T20:00:00Z';
const source='https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/summary?event=401918017';
const finalEvent=()=>({id:'401918017',season:{year:2026,type:3},date:'2026-09-30T00:30:00Z',competitions:[{date:'2026-09-30T00:30:00Z',status:{type:{state:'post',completed:true,name:'STATUS_FINAL'}},notes:[{headline:'First Round - Game 2'}],competitors:[{homeAway:'home',score:'87',team:{id:'9',abbreviation:'NY'}},{homeAway:'away',score:'71',team:{id:'8',abbreviation:'MIN'}}],series:{type:'playoff',completed:true,totalCompetitions:3,summary:'NY wins series 2-0',competitors:[{id:'9',wins:2,ties:0},{id:'8',wins:0,ties:0}]}}]});
const forecast=()=>({id:'test:wnba:401918021',gameId:'401918021',sport:'wnba',season:2026,homeId:'8',awayId:'9',startTime:'2026-10-01T04:00:00Z',capturedAt:'2026-09-25T13:00:00Z',sourceUrl:'https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard?dates=20261001',modelVersion:'test',cohort:'live',odds:-110,marketHomeSpread:2,side:'home'});
const evidence=()=>completedBestOfThreeSeries({events:[finalEvent()]},'wnba',{sourceUrl:source,observedAt});
const options={observedAt,summaryMissing:true};

test('explicit future postseason slot notes survive scoreboard normalization',()=>{
 const event=finalEvent();event.id='401999999';event.date='2026-10-04T23:00:00Z';event.competitions[0].notes=[{headline:'First Round - Game 3 If Necessary'}];event.competitions[0].status.type={state:'pre',completed:false,name:'STATUS_SCHEDULED'};
 const metadata=postseasonMetadata(event,'wnba',{sourceUrl:source,observedAt});
 assert.equal(metadata.gameNumber,3);assert.equal(metadata.ifNecessary,true);assert.equal(metadata.round,'First Round');
 const board=normalizeScoreboard({events:[event]},'wnba',{sourceUrl:source,retrievedAt:observedAt});assert.deepEqual(board.games[0].postseason,metadata);
 assert.equal(postseasonMetadata({...event,season:{year:2026,type:2}},'wnba'),null);
 assert.equal(postseasonMetadata({...event,competitions:[{...event.competitions[0],notes:[]}]},'wnba'),null);
});

test('verified completed playoff sweep voids only the archived unneeded slot and releases its risk',()=>{
 const f=forecast(),before=structuredClone(f),proof=evidence();assert.equal(proof.length,1);
 const game=inferUnneededPlayoffGame(f,proof,options);assert.equal(game.status,'cancelled');assert.equal(game.completed,false);assert.equal(game.voidEvidence.seriesGameId,'401918017');assert.equal(game.voidEvidence.seriesGameStartTime,'2026-09-30T00:30:00Z');
 const grade=gradeForecast(f,game,observedAt);assert.equal(grade.status,'void');assert.equal(grade.pnl,null);assert.equal(grade.homeScore,undefined);
 const bankroll=replayBankroll([{...f,result:grade}]);assert.equal(bankroll.plays[f.id].status,'void');assert.equal(bankroll.blockedBy,null);assert.equal(bankroll.pricedFinals,0);assert.deepEqual(f,before);
});

test('missing-only, live, future, mismatched pair, changed time, and unknown legacy slots stay pending',()=>{
 const f=forecast(),proof=evidence();
 assert.equal(inferUnneededPlayoffGame(f,proof,{observedAt}),null);
 assert.equal(inferUnneededPlayoffGame(f,proof,{...options,currentGame:{status:'live'}}),null);
 assert.equal(inferUnneededPlayoffGame(f,proof,{...options,currentGame:{status:'scheduled'}}),null);
 assert.equal(inferUnneededPlayoffGame(f,proof,{...options,observedAt:f.startTime}),null);
 for(const changed of [{homeId:'20'},{season:2025},{gameId:'401999998'},{startTime:'2026-10-03T04:00:00Z'}])assert.equal(inferUnneededPlayoffGame({...f,...changed},proof,options),null);
 assert.equal(inferUnneededPlayoffGame(f,[],options),null);
});

test('unfinished, live, regular-season, longer, score-inconsistent, or different-round series cannot void a slot',()=>{
 const cases=[event=>event.competitions[0].series.completed=false,event=>event.competitions[0].status.type={state:'in',completed:false,name:'STATUS_IN_PROGRESS'},event=>event.season.type=2,event=>event.competitions[0].series.type='season',event=>event.competitions[0].series.totalCompetitions=5,event=>event.competitions[0].series.competitors[1].wins=1,event=>event.competitions[0].competitors[0].score='60',event=>event.competitions[0].series.competitors[0].id='20'];
 for(const alter of cases){const event=finalEvent();alter(event);assert.equal(completedBestOfThreeSeries({events:[event]},'wnba',{sourceUrl:source,observedAt}).length,0);}
 const event=finalEvent();event.competitions[0].notes[0].headline='Semifinals - Game 2';const proof=completedBestOfThreeSeries({events:[event]},'wnba',{sourceUrl:source,observedAt});assert.equal(proof.length,1);assert.equal(inferUnneededPlayoffGame(forecast(),proof,options),null);
 assert.equal(completedBestOfThreeSeries({events:[finalEvent()]},'wnba',{sourceUrl:'https://example.com/scores',observedAt}).length,0);
});

test('new explicit archived slots require matching round and genuine pregame metadata',()=>{
 const f={...forecast(),gameId:'401999999',postseason:{gameId:'401999999',season:2026,round:'First Round',gameNumber:3,ifNecessary:true,sourceUrl:source,observedAt:'2026-09-25T13:00:00Z'}};
 assert.ok(inferUnneededPlayoffGame(f,evidence(),options));
 for(const altered of [{round:'Finals'},{ifNecessary:false},{gameNumber:2},{observedAt:'2026-10-02T00:00:00Z'},{sourceUrl:'https://example.com/notes'}])assert.equal(inferUnneededPlayoffGame({...f,postseason:{...f.postseason,...altered}},evidence(),options),null);
 assert.equal(inferUnneededPlayoffGame(f,evidence().map(e=>({...e,startTime:'2026-09-01T00:00:00Z'})),options),null);
});

test('bounded series lookups deduplicate model versions and find older finals with reversed venues',()=>{
 const pending=[forecast(),{...forecast(),id:'second-version'}],prior={...forecast(),gameId:'401918017',homeId:'9',awayId:'8',startTime:'2026-09-30T00:30:00Z',result:{status:'completed'}};
 const candidates=seriesLookupCandidates(pending,[{...prior,gameId:'older',startTime:'2026-09-27T18:00:00Z'},prior,{...prior,id:'second-version'}]);
 assert.equal(candidates.length,1);assert.equal(candidates[0].gameId,'401918017');
 assert.equal(seriesLookupCandidates(pending,[{...prior,result:null}]).length,0);
 assert.equal(seriesLookupCandidates(pending,[{...prior,season:2025}]).length,0);
});

test('the five legacy identities are bounded to their verified original pair, season, and time',()=>{
 const slots=[['wnba','401918021','8','9','2026-10-01T04:00:00Z'],['wnba','401918293','20','16','2026-10-02T04:00:00Z'],['mlb','401907964','mlb:NYY','mlb:BOS','2026-10-01T04:00:00Z'],['mlb','401907898','mlb:HOU','mlb:CWS','2026-10-01T21:00:00Z'],['mlb','401907976','mlb:SD','mlb:CHC','2026-10-02T02:00:00Z']];
 for(const [sport,gameId,homeId,awayId,startTime]of slots){const f={sport,gameId,homeId,awayId,startTime,season:2026};assert.ok(postseasonSlotForForecast(f));assert.equal(postseasonSlotForForecast({...f,season:2025}),null);assert.equal(postseasonSlotForForecast({...f,awayId:'unknown'}),null);}
});

test('a best-of-seven sweep voids its unneeded Game 5-7 slots after their start, and nothing earlier',async()=>{
 const {completedPlayoffSeries}=await import('./postseason.mjs');
 const src='https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary?event=401908033',seen='2026-10-20T01:00:00Z';
 const clinch=(wins=[0,4],gameNumber=4)=>({header:{id:'401908033',season:{year:2026,type:3},gameNote:`NLCS - Game ${gameNumber}`,competitions:[{date:'2026-10-16T01:00:00Z',status:{type:{state:'post',completed:true,name:'STATUS_FINAL'}},
  competitors:[{team:{id:'19',abbreviation:'LAD'},score:'4'},{team:{id:'8',abbreviation:'MIL'},score:'6'}],
  series:[{type:'current',completed:true,totalCompetitions:4,competitors:[{id:'19',wins:2},{id:'8',wins:2}]},{type:'playoff',summary:'MIL wins series 4-0',completed:true,totalCompetitions:7,competitors:[{id:'19',wins:wins[0]},{id:'8',wins:wins[1]}]}]}]}});
 const proof=completedPlayoffSeries(clinch(),'mlb',{sourceUrl:src,observedAt:seen});
 assert.equal(proof.length,1);assert.deepEqual([proof[0].bestOf,proof[0].gamesPlayed],[7,4]);assert.deepEqual(proof[0].teamIds.sort(),['mlb:LAD','mlb:MIL']);
 // Not the clinching game, or the series not yet decided: no evidence.
 assert.equal(completedPlayoffSeries(clinch([1,3],4),'mlb',{sourceUrl:src,observedAt:seen}).length,0);
 assert.equal(completedPlayoffSeries(clinch([0,4],3),'mlb',{sourceUrl:src,observedAt:seen}).length,0);
 assert.equal(completedPlayoffSeries(clinch(),'mlb',{sourceUrl:'https://example.com/x',observedAt:seen}).length,0);
 const slot=(gameNumber,startTime,id)=>({id:'ridge-v1:mlb:'+id,gameId:id,sport:'mlb',season:2026,homeId:'mlb:MIL',awayId:'mlb:LAD',startTime,capturedAt:'2026-10-13T19:19:18Z',
  postseason:{gameId:id,season:2026,round:'NLCS',gameNumber,ifNecessary:true,sourceUrl:'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?limit=1000&dates=20261019',observedAt:'2026-10-13T19:19:18.256Z'}});
 const g7=slot(7,'2026-10-20T00:00:00.000Z','401908036');
 const game=inferUnneededPlayoffGame(g7,proof,{observedAt:seen,summaryMissing:true});
 assert.equal(game.status,'cancelled');assert.match(game.voidEvidence.slotBasis,/Game 7/);
 assert.equal(gradeForecast(g7,game,seen).status,'void');
 // Before its start time it stays pending; a Game 4 or a different pair is never voided.
 assert.equal(inferUnneededPlayoffGame(g7,proof,{observedAt:'2026-10-19T17:00:00Z',summaryMissing:true}),null);
 assert.equal(inferUnneededPlayoffGame({...slot(4,'2026-10-17T01:00:00.000Z','401908099')},proof,{observedAt:seen,summaryMissing:true}),null);
 assert.equal(inferUnneededPlayoffGame({...g7,homeId:'mlb:TB',awayId:'mlb:CLE'},proof,{observedAt:seen,summaryMissing:true}),null);
 assert.ok(postseasonSlotForForecast(slot(5,'2026-10-17T01:00:00.000Z','401908034')));
});
