import test from 'node:test';
import assert from 'node:assert/strict';
import {rankForecasts} from './ranking.mjs';
import {gradeSpreadPick} from './spread-record.mjs';
import {replayBankroll} from './bankroll.mjs';

test('archived opening spreads rank with saved spreads, independently of finals',()=>{
 const records=[
  {id:'saved',startTime:'2026-09-26T17:00:00Z',predictedMargin:6,marketHomeSpread:-3,result:{actualMargin:-20}},
  {id:'opening',startTime:'2026-09-26T18:00:00Z',predictedMargin:-5,marketHomeSpread:null,paperWager:{kind:'archived-opening-spread',homeSpread:12},result:{actualMargin:30}},
  {id:'synthetic',startTime:'2026-09-26T19:00:00Z',predictedMargin:9,marketHomeSpread:null,paperWager:{kind:'synthetic-winner-even',homeSpread:0},result:{actualMargin:1}},
 ];
 const ranked=rankForecasts(records);
 assert.deepEqual(ranked.map(f=>[f.id,f.cardRank,f.edge]),[['opening',1,7],['saved',2,3],['synthetic',null,null]]);
 assert.equal(ranked[2].rankReason,'Paper winner · no sportsbook spread');
 const reversed=rankForecasts(records.map(f=>({...f,result:{actualMargin:-f.result.actualMargin}})));
 assert.deepEqual(reversed.map(f=>[f.id,f.cardRank]),ranked.map(f=>[f.id,f.cardRank]));
});

test('a zero-prior college line remains ATS-comparable but cannot take a top-card rank',()=>{
 const records=[
  {id:'prior',sport:'cfb',startTime:'2026-10-03T16:00:00Z',predictedMargin:4,marketHomeSpread:26.5,side:'home',projection:{ratingCoverage:'both-prior'}},
  {id:'rated',sport:'cfb',startTime:'2026-10-03T16:00:00Z',predictedMargin:2,marketHomeSpread:3.5,side:'home',projection:{ratingCoverage:'both-rated'}},
 ];
 const [rated,prior]=rankForecasts(records);
 assert.equal(rated.id,'rated');assert.equal(rated.cardRank,1);
 assert.equal(prior.id,'prior');assert.equal(prior.edge,30.5);
 assert.equal(prior.cardRank,null);assert.equal(prior.rankReason,'Picks with limited data');
 assert.equal(prior.side,'home');assert.equal(prior.marketHomeSpread,26.5);
 const settled={...prior,cohort:'live',modelVersion:'cfb-weekly-tuned-2026-09-14',odds:-110,
  result:{status:'completed',actualMargin:3,pnl:100/110}};
 assert.equal(gradeSpreadPick(settled).outcome,'win');
 assert.equal(replayBankroll([settled]).days[0].pricedFinals,1);
});

test('a rated college team with sparse history stays counted but cannot outrank a supported pick',()=>{
 const records=[
  {id:'thin',sport:'cfb',startTime:'2026-10-03T16:00:00Z',predictedMargin:12.6,marketHomeSpread:-52.5,side:'away',projection:{ratingCoverage:'both-rated',sparseSample:true,awayEffectiveGames:0.47}},
  {id:'supported',sport:'cfb',startTime:'2026-10-03T17:00:00Z',predictedMargin:4,marketHomeSpread:21,side:'home',projection:{ratingCoverage:'both-rated',sparseSample:false}},
 ];
 const ranked=rankForecasts(records);
 assert.deepEqual(ranked.map(f=>[f.id,f.cardRank,f.lowEvidence]),[['supported',1,false],['thin',null,true]]);
 assert.equal(ranked[1].edge,39.9);
 const settle=rows=>rows.map(f=>({...f,cohort:'live',modelVersion:'cfb-weekly-tuned-2026-09-14',odds:-110,result:{status:'completed',actualMargin:14,pnl:f.id==='thin'?100/110:-1}}));
 assert.deepEqual(settle(ranked).map(gradeSpreadPick).map(x=>x.outcome).sort(),settle(records).map(gradeSpreadPick).map(x=>x.outcome).sort());
 assert.equal(replayBankroll(settle(ranked)).balance,replayBankroll(settle(records)).balance);
 assert.equal(replayBankroll(settle(ranked)).days[0].pricedFinals,2);
 // A large difference alone is not the classification criterion.
 assert.equal(ranked[0].edge,25);
});
