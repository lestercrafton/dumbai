import test from 'node:test';import assert from 'node:assert/strict';
import {summarizeSpreadPicks,truthMeter,breakEven} from './spread-record.mjs';
const pick=(outcome,extra={})=>({side:'home',marketHomeSpread:-3,odds:-110,result:{status:'completed',actualMargin:outcome==='win'?7:outcome==='push'?3:0,...extra}});
test('profit, break-even and line movement follow the prices taken',()=>{
 const s=summarizeSpreadPicks([pick('win',{closingHomeSpread:-5}),pick('loss'),pick('push')]);
 assert.equal(s.risked,3);assert.ok(Math.abs(s.units-(100/110-1))<1e-9);
 assert.ok(Math.abs(s.breakEvenSum/s.decided-breakEven(-110))<1e-9);assert.equal(s.clvCount,1);assert.equal(s.clvSum,2);
});
test('truth meter starts at 1 and grows only with sustained wins',()=>{
 assert.equal(truthMeter(summarizeSpreadPicks([]).truthLogs),1);
 const wins=summarizeSpreadPicks(Array.from({length:60},(_,i)=>pick(i%4===3?'loss':'win')));
 assert.ok(truthMeter(wins.truthLogs)>20);
 const coin=summarizeSpreadPicks(Array.from({length:60},(_,i)=>pick(i%2?'loss':'win')));
 assert.ok(truthMeter(coin.truthLogs)<1);
});
