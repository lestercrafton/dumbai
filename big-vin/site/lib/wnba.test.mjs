import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeScoreboard,scoreboardUrls} from './feeds/adapter.mjs';
import {collectSourceRange,boardDates} from './collector-sources.mjs';
import {fitRatings,projectGame,MODEL_CONFIGS} from './ratings.mjs';
import {gradeForecast} from './results.mjs';
import {replayBankroll} from './bankroll.mjs';
const event={id:'401857194',date:'2026-09-18T02:00:00Z',season:{year:2026,type:2},competitions:[{type:{abbreviation:'STD'},status:{type:{state:'pre',completed:false}},competitors:[{homeAway:'home',team:{id:'14',abbreviation:'SEA',displayName:'Seattle Storm'},score:'0'},{homeAway:'away',team:{id:'17',abbreviation:'LV',displayName:'Las Vegas Aces'},score:'0'}],odds:[{provider:{name:'Source book'},pointSpread:{home:{close:{line:'+10.5',odds:'-110'}},away:{close:{line:'-10.5',odds:'-110'}}}}]}]};
test('WNBA normalizes actual offers and excludes all-star teams even in regular-season type',()=>{
 const g=normalizeScoreboard({events:[event]},'wnba').games[0];assert.equal(g.sportLabel,'WNBA');assert.equal(g.home.id,'14');assert.equal(g.market.homeSpread,10.5);assert.equal(g.market.awaySpreadPrice,-110);assert.equal(g.homeScore,null);assert.equal(g.exhibition,false);
 const star={...event,name:'Team Collier at Team Clark',competitions:[{...event.competitions[0],type:{abbreviation:'ALLSTAR'}}]};assert.equal(normalizeScoreboard({events:[star]},'wnba').games[0].exhibition,true);
 const playoff=normalizeScoreboard({events:[{...event,season:{year:2026,type:3}}]},'wnba').games[0];assert.equal(playoff.exhibition,false);assert.equal(playoff.seasonType,3);
 const cup={...event,competitions:[{...event.competitions[0],notes:[{headline:"Commissioner's Cup Championship"}]}]};assert.equal(normalizeScoreboard({events:[cup]},'wnba').games[0].modelExcludedReason,'Standalone Cup final excluded');
 const qualifier={...event,competitions:[{...event.competitions[0],notes:[{headline:"Commissioner's Cup"}]}]};assert.equal(normalizeScoreboard({events:[qualifier]},'wnba').games[0].modelExcludedReason,null);
});
test('WNBA date windows use individual requests and never claim coverage for a failed day',async()=>{
 const urls=scoreboardUrls('wnba',{startDate:'2026-09-17',endDate:'2026-09-19'});assert.deepEqual(urls.map(u=>new URL(u).searchParams.get('dates')),['20260917','20260918','20260919']);
 const r=await collectSourceRange('wnba',{date:'2026-09-17',endDate:'2026-09-19'},async u=>{if(new URL(u).searchParams.get('dates')==='20260918')throw new Error('outage');return {events:[]};});assert.deepEqual(boardDates(r.boards),['2026-09-17','2026-09-19']);assert.deepEqual(r.missing,[{date:'2026-09-18',group:null}]);
});
test('WNBA ratings, saved-price grade, and daily bankroll form an independent path',()=>{
 const games=Array.from({length:12},(_,i)=>({homeId:i%2?'17':'14',awayId:i%2?'14':'17',date:`2026-08-${String(i+1).padStart(2,'0')}`,homeScore:85,awayScore:80,neutral:false}));
 const model=fitRatings([...games,{homeId:'14',awayId:'17',date:'2026-09-17',homeScore:200,awayScore:0}],{sport:'wnba',asOf:'2026-09-17'});assert.equal(model.trainingGames,12);assert.equal(model.config.homePrior,2);assert.notEqual(model.config.homePrior,MODEL_CONFIGS.nba.homePrior);
 const prediction=projectGame({homeId:'14',awayId:'17',neutral:false},model);assert.ok(Number.isFinite(prediction.predictedHomeMargin));
 const f={id:'ridge-v1:wnba:401857194',gameId:event.id,sport:'wnba',cohort:'live',modelVersion:'ridge-v1',startTime:event.date,predictedMargin:prediction.predictedHomeMargin,marketHomeSpread:10.5,side:'home',odds:-110};
 const result=gradeForecast(f,{startTime:event.date,status:'completed',completed:true,homeScore:80,awayScore:85},'2026-09-18T05:00:00Z');assert.equal(result.outcome,'win');
 const bankroll=replayBankroll([{...f,result}]);assert.equal(bankroll.plays[f.id].stake,10);assert.equal(bankroll.days[0].date,'2026-09-17');assert.ok(Math.abs(bankroll.balance-(500+10*100/110))<1e-9);
});
