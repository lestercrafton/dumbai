import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {makeCfbReconstructedRecords,summarizeWinners,CFB_RECONSTRUCTION_ORIGIN} from './cfb-reconstructed-records.mjs';
import {firstMarketObservation} from './first-market.mjs';

const fixture=JSON.parse(readFileSync(new URL('./college-experiment-cohort-2026-09-26.json',import.meta.url)));
const enteredAt=new Date(Date.parse(fixture.capturedAt)+3600000).toISOString();

test('missed-card backfill freezes 80 unique numeric lines with honest provenance and no prices',()=>{
 const rows=makeCfbReconstructedRecords(fixture,enteredAt);
 assert.equal(rows.length,80);
 assert.equal(new Set(rows.map(row=>row.id)).size,80);
 assert.deepEqual(Object.fromEntries([...new Set(rows.map(row=>row.reconstructionCategory))].map(category=>[category,rows.filter(row=>row.reconstructionCategory===category).length])),{'no-market-on-board':33,'omitted-from-board':37,'priced-without-saved-forecast':10});
 assert.ok(rows.every(row=>row.weekKey==='2026-09-21'&&row.modelVersion===fixture.modelVersion&&row.origin===CFB_RECONSTRUCTION_ORIGIN));
 assert.ok(rows.every(row=>Number.isFinite(row.predictedMargin)&&row.capturedAt===enteredAt&&row.reconstructedAt===enteredAt&&row.modelCapturedAt===fixture.capturedAt));
 assert.ok(rows.every(row=>row.trainingCutoff==='2026-09-26'&&row.lastTrainingDate<'2026-09-26'));
 assert.ok(rows.every(row=>row.marketHomeSpread===null&&row.side===null&&row.odds===null&&row.marketObservedAt===null));
 assert.ok(rows.filter(row=>row.ratingCoverage!=='both-rated').length>=8);
 assert.ok(rows.some(row=>row.result?.status==='completed'&&row.result.outcome==='no-line'&&row.result.pnl===null));
});

test('postgame score and late market mutations cannot change a reconstructed line',()=>{
 const original=makeCfbReconstructedRecords(fixture,enteredAt);
 const poisoned=structuredClone(fixture);
 for(const game of poisoned.games){game.capturedStatus='completed';game.capturedHomeScore=100;game.capturedAwayScore=0;game.lateMarketHomeSpread=-99;}
 const changed=makeCfbReconstructedRecords(poisoned,enteredAt);
 assert.deepEqual(changed.map(row=>[row.id,row.predictedMargin,row.projection.homeRating,row.projection.awayRating]),original.map(row=>[row.id,row.predictedMargin,row.projection.homeRating,row.projection.awayRating]));
 assert.ok(changed.some((row,index)=>row.result?.homeScore!==original[index].result?.homeScore));
});

test('backfill refuses a model trained on game-day results',()=>{
 const poisoned=structuredClone(fixture);
 poisoned.model.lastTrainingDate='2026-09-26';
 assert.throws(()=>makeCfbReconstructedRecords(poisoned,enteredAt),/invalid forecast provenance/);
});

test('reconstructed forecasts cannot acquire a later spread or sportsbook return',()=>{
 const row=makeCfbReconstructedRecords(fixture,enteredAt)[0];
 const startTime=new Date(Date.parse(enteredAt)+86400000).toISOString();
 const forecast={...row,startTime,result:null};
 const game={id:forecast.gameId,sport:'cfb',homeId:forecast.homeId,awayId:forecast.awayId,status:'scheduled',startTime,market:{homeSpread:-3,observedAt:new Date(Date.parse(enteredAt)+1000).toISOString(),homeSpreadPrice:-110,provider:'test'}};
 assert.equal(firstMarketObservation(forecast,game,new Date(Date.parse(enteredAt)+2000).toISOString()),null);
});

test('winner summary counts no-market finals, pending rows, ties and model error separately',()=>{
 const rows=[
  {predictedMargin:3,origin:CFB_RECONSTRUCTION_ORIGIN,reconstructedAt:enteredAt,result:{status:'completed',actualMargin:7}},
  {predictedMargin:-2,origin:CFB_RECONSTRUCTION_ORIGIN,reconstructedAt:enteredAt,result:{status:'completed',actualMargin:5}},
  {predictedMargin:0,result:{status:'completed',actualMargin:0}},
  {predictedMargin:4,result:null},
  {predictedMargin:null,result:{status:'completed',actualMargin:10}}
 ];
 assert.deepEqual(summarizeWinners(rows),{recorded:4,graded:3,pending:1,wins:1,losses:1,ties:1,winRate:0.5,mae:11/3,reconstructedCount:2,reconstructedGraded:2,latestReconstructedAt:enteredAt});
});
