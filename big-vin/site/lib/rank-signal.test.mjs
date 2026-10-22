import test from 'node:test';import assert from 'node:assert/strict';
import {learnRankSignal,scoreGame,compareSignal,CLV_SWITCH} from './rank-signal.mjs';
const rec=(i,win,extra={})=>({id:'f'+i,gameId:'g'+i,cohort:'live',sport:'nfl',startTime:'2026-01-01T00:00:00Z',side:'home',marketHomeSpread:-3,odds:-110,predictedMargin:4,result:{status:'completed',actualMargin:win?7:0,...extra}});
test('small samples stay near break-even and gap alone does not reorder',()=>{
 const s=learnRankSignal([rec(1,true),rec(2,true)]);
 const big=scoreGame(s,{sport:'nfl',side:'home',homeSpread:-3,edge:8}),small=scoreGame(s,{sport:'nfl',side:'home',homeSpread:-3,edge:1});
 assert.ok(Math.abs(small.value-0.5238)<0.02);assert.equal(s.basis,'win');
 assert.ok(Math.abs(big.value-small.value)<0.01);
});
test('switches to line movement after enough closing lines',()=>{
 const s=learnRankSignal(Array.from({length:CLV_SWITCH},(_,i)=>rec(i,i%2,{closingHomeSpread:-4})));
 assert.equal(s.basis,'clv');assert.ok(scoreGame(s,{sport:'nfl',side:'home',homeSpread:-3,edge:1}).value>0);
});
test('ties go to the cheaper price, then earlier kickoff',()=>{
 const a={rankSignal:{value:.53,breakEven:.52},startTime:'2'},b={rankSignal:{value:.53,breakEven:.5},startTime:'3'};
 assert.ok(compareSignal(a,b)>0);
});
