import test from 'node:test';
import assert from 'node:assert/strict';
import sep14 from './tuning-2026-09-14.json' with {type:'json'};
import oct16 from './tuning-2026-10-16.json' with {type:'json'};
import {savedBoardHistory,canProjectUncapturedGame} from './saved-board-history.mjs';
import {summarizeTrackedHistory} from './tracked-history.mjs';

const models=[sep14.cfb,oct16.cfb];
const row=(id,version,margin,extra={})=>({id,gameId:'same-game',sport:'cfb',season:2026,week:6,cohort:'live',origin:'collector',modelVersion:version,
 startTime:'2026-10-10T18:00:00Z',capturedAt:'2026-10-08T12:00:00Z',marketObservedAt:'2026-10-08T11:00:00Z',weekKey:'2026-10-05',predictedMargin:margin,marketHomeSpread:3,side:margin+3>0?'home':'away',
 result:{status:'completed',actualMargin:0,outcome:margin+3>0?'win':'loss'},...extra});

test('default historical board uses the genuine September pick and grade instead of a conflicting baseline',()=>{
 const rows=[row('baseline','ridge-v1',-10),row('september',sep14.cfb.id,2),row('october',oct16.cfb.id,-10,{capturedAt:'2026-10-16T22:00:00Z'})];
 const result=savedBoardHistory(rows,{sport:'cfb',models,date:'2026-10-10',days:7});
 assert.deepEqual(result.records.map(r=>r.id),['september']);
 assert.equal(result.records[0].side,'home');assert.equal(result.records[0].predictedMargin,2);assert.strictEqual(result.records[0].result,rows[1].result);
 const history=summarizeTrackedHistory(rows,{sport:'cfb',models,rankPeriod:'week',rankAnchor:'2026-10-10'});
 assert.deepEqual(result.records.map(r=>[r.id,r.cardRank]),history.records.map(r=>[r.id,r.cardRank]));
});

test('reconstruction or benchmark without an authentic active-model pick stays final-only',()=>{
 const rows=[row('baseline','ridge-v1',2),row('reconstruction',sep14.cfb.id,2,{origin:'cfb-reconstructed-2026-09-26'})];
 assert.equal(savedBoardHistory(rows,{sport:'cfb',models,date:'2026-10-10',days:1}).records.length,0);
});

test('future active saved picks retain the same side, market, result and daily card rank',()=>{
 const rows=Array.from({length:5},(_,i)=>row('pick'+i,oct16.cfb.id,10-i,{gameId:'game'+i,startTime:'2026-10-17T18:00:00Z',capturedAt:'2026-10-17T12:00:00Z',marketObservedAt:'2026-10-17T11:00:00Z',result:null}));
 const result=savedBoardHistory(rows,{sport:'cfb',models,date:'2026-10-17',days:1});
 assert.deepEqual(result.records.map(r=>r.cardRank),[1,2,3,4,5]);
 for(const r of result.records){assert.equal(r.side,'home');assert.equal(r.marketHomeSpread,3);assert.equal(r.result,null);}
});

test('started or completed missing forecasts cannot be regenerated even with stale scheduled status',()=>{
 const now=Date.parse('2026-10-17T18:00:00Z');
 assert.equal(canProjectUncapturedGame({status:'scheduled',startTime:'2026-10-17T17:59:00Z'},now),false);
 assert.equal(canProjectUncapturedGame({status:'scheduled',startTime:'2026-10-17T18:00:00Z'},now),false);
 assert.equal(canProjectUncapturedGame({status:'completed',startTime:'2026-10-17T19:00:00Z'},now),false);
 assert.equal(canProjectUncapturedGame({status:'in-progress',startTime:'2026-10-17T19:00:00Z'},now),false);
 assert.equal(canProjectUncapturedGame({status:'scheduled',startTime:'invalid'},now),false);
 assert.equal(canProjectUncapturedGame({status:'scheduled',startTime:'2026-10-17T19:00:00Z',seasonType:1},now),false);
 assert.equal(canProjectUncapturedGame({status:'scheduled',startTime:'2026-10-17T19:00:00Z',modelExcludedReason:'excluded'},now),false);
 assert.equal(canProjectUncapturedGame({status:'scheduled',startTime:'2026-10-17T19:00:00Z'},now),true);
});
