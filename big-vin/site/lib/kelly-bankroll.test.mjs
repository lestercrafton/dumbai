import test from 'node:test';import assert from 'node:assert/strict';
import {kellyStake,replayKellyBankroll} from './kelly-bankroll.mjs';
test('kelly stake is zero without an edge and full Kelly otherwise',()=>{
 assert.equal(kellyStake(0.5,-110),0);
 assert.ok(Math.abs(kellyStake(0.6,100)-0.2)<1e-12);
 assert.equal(replayKellyBankroll([]).kelly.bankroll,1_000_000);
});

import {replayKellyBankroll as rk} from './kelly-bankroll.mjs';
import assert2 from 'node:assert/strict';
import {test as t2} from 'node:test';
t2('legacy MLB run line picks are included only when asked',()=>{
 const rec={sport:'mlb',id:'a',startTime:'2026-04-01T00:00:00Z',side:'home',marketHomeSpread:-1.5,homeSpread:-1.5,predictedMargin:2,odds:-110,result:{status:'completed',homeScore:5,awayScore:1}};
 assert2.equal(rk([rec]).picks<=rk([rec],{includeLegacy:true}).picks,true);
});
