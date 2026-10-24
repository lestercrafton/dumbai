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

import {bankrollApplyFrom,replayKellyBankroll as rk2} from './kelly-bankroll.mjs';
import {test as t3} from 'node:test';
import assert3 from 'node:assert/strict';

t3('bankrollApplyFrom takes the later of arrived and effective_from',()=>{
 assert3.equal(bankrollApplyFrom('2026-10-20',null),'2026-10-20');
 assert3.equal(bankrollApplyFrom(null,'2026-10-22'),'2026-10-22');
 assert3.equal(bankrollApplyFrom('2026-10-20','2026-10-22'),'2026-10-22');
 assert3.equal(bankrollApplyFrom('2026-10-25','2026-10-22'),'2026-10-25');
 assert3.equal(bankrollApplyFrom(null,null),null);
});

t3('applyFrom skips pre-arrival P&L but keeps start and learns from earlier picks',()=>{
 const early={sport:'nfl',id:'early',startTime:'2026-09-01T17:00:00Z',side:'home',marketHomeSpread:-3,homeSpread:-3,predictedMargin:10,odds:-110,
  home:'H1',away:'A1',result:{status:'completed',homeScore:30,awayScore:10}};
 const lateWin={sport:'nfl',id:'late',startTime:'2026-10-23T17:00:00Z',side:'home',marketHomeSpread:-3,homeSpread:-3,predictedMargin:10,odds:-110,
  home:'H2',away:'A2',result:{status:'completed',homeScore:30,awayScore:10}};
 const lateLoss={sport:'nfl',id:'late2',startTime:'2026-10-24T17:00:00Z',side:'home',marketHomeSpread:-3,homeSpread:-3,predictedMargin:10,odds:-110,
  home:'H3',away:'A3',result:{status:'completed',homeScore:0,awayScore:30}};
 const full=rk2([early,lateWin,lateLoss],{start:1000});
 const since=rk2([early,lateWin,lateLoss],{start:1000,applyFrom:'2026-10-23'});
 assert3.equal(full.picks,3);
 assert3.equal(since.picks,2);
 assert3.equal(since.applyFrom,'2026-10-23');
 assert3.equal(since.kelly.putIn,1000);
 // Booked bets are only post-arrival games (early kickoff never appears).
 assert3.deepEqual(since.bets.map(b=>b.t),[lateWin.startTime,lateLoss.startTime]);
 assert3.equal(since.bets.some(b=>b.t===early.startTime),false);
 // With no plays in window, bankroll stays at start.
 const empty=rk2([early],{start:2500,applyFrom:'2026-10-23'});
 assert3.equal(empty.kelly.bankroll,2500);
 assert3.equal(empty.picks,0);
 assert3.equal(empty.betCount,0);
 assert3.equal(empty.kelly.net,0);
});
