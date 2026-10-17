import test from 'node:test';
import assert from 'node:assert/strict';
import {spreadDecision} from './spread-display.mjs';
const game={sport:'cfb',home:'TENN',away:'TEX',marketHomeSpread:5.5};

test('a home underdog projected to win has distinct model line, handicap and difference',()=>{
 const d=spreadDecision({...game,predictedMargin:5.7});
 assert.deepEqual(d.market,['TEX −5.5','TENN +5.5']);
 assert.equal(d.modelLine,'TENN −5.7');
 assert.equal(d.modelWinner,'TENN by 5.7');
 assert.equal(d.pick,'TENN +5.5');
 assert.equal(d.difference,11.2);
 assert.equal(d.label,'Pending');
});
test('projected winner and ATS pick can differ in either direction',()=>{
 const underdog=spreadDecision({...game,predictedMargin:-2});
 assert.equal(underdog.modelWinner,'TEX by 2.0');assert.equal(underdog.pick,'TENN +5.5');assert.equal(underdog.difference,3.5);
 const awayPick=spreadDecision({...game,predictedMargin:3,marketHomeSpread:-7});
 assert.equal(awayPick.modelWinner,'TENN by 3.0');assert.equal(awayPick.pick,'TEX +7.0');assert.equal(awayPick.difference,4);
});
test('ties, absent lines and synthetic contracts never imply an ATS win',()=>{
 const final={status:'completed',homeScore:20,awayScore:10};
 const tie=spreadDecision({...game,predictedMargin:0,marketHomeSpread:0});
 assert.equal(tie.modelLine,'Pick’em');assert.equal(tie.pick,null);assert.equal(tie.label,'No pick');
 const unlined=spreadDecision({...game,predictedMargin:4,marketHomeSpread:null,result:final});
 assert.equal(unlined.label,'No spread');assert.equal(unlined.pick,null);
 const paper=spreadDecision({...game,predictedMargin:4,side:'home',origin:'cfb-reconstructed-2026-09-26',paperWager:{kind:'synthetic-winner-even',homeSpread:0,odds:100,side:'home'},result:final});
 assert.equal(paper.label,'No spread');assert.equal(paper.pick,null);
});
test('only verified finals receive spread wins, losses or pushes; void remains void',()=>{
 const record={...game,predictedMargin:3,marketHomeSpread:-7,side:'away'};
 assert.equal(spreadDecision({...record,result:{status:'completed',homeScore:20,awayScore:13}}).label,'Push');
 assert.equal(spreadDecision({...record,result:{status:'completed',homeScore:20,awayScore:14}}).label,'Win');
 const learn=spreadDecision({...record,result:{status:'completed',homeScore:20,awayScore:12}});
 assert.equal(learn.label,'Learn');assert.equal(learn.outcome,'loss');
 assert.equal(spreadDecision({...record,result:{status:'live',homeScore:20,awayScore:14}}).label,'Pending');
 assert.equal(spreadDecision({...record,result:{status:'void'}}).label,'Void');
});
