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

import {test as t4} from 'node:test';
import assert4 from 'node:assert/strict';
import {replayKellyBankroll as rk4} from './kelly-bankroll.mjs';
import {savedNeutralSite,pregameTotal} from './saved-game-context.mjs';
const pick=(id,startTime,win,extra={})=>({sport:'nfl',id,gameId:id,startTime,side:'home',marketHomeSpread:-3,predictedMargin:12,odds:-110,home:'H'+id,away:'A'+id,
 result:{status:'completed',homeScore:win?30:0,awayScore:win?0:30,observedAt:extra.observedAt??new Date(Date.parse(startTime)+4*3600e3).toISOString()},...extra});

t4('win chance only counts finals recorded before kickoff',()=>{
 // 120 earlier wins graded well before; one game whose final lands after the next kickoff.
 const history=Array.from({length:120},(_,i)=>pick('h'+i,new Date(Date.parse('2026-09-01T17:00:00Z')+i*3600e3).toISOString(),true));
 const late=pick('late','2026-10-01T17:00:00Z',false,{observedAt:'2026-10-03T00:00:00Z'});
 const next=pick('next','2026-10-02T17:00:00Z',true);
 const withLate=rk4([...history,late,next]).bets.find(b=>b.t===next.startTime);
 const without=rk4([...history,next]).bets.find(b=>b.t===next.startTime);
 assert4.equal(withLate.winChance,without.winChance);
});

t4('a day never risks more than its opening bankroll, sized like Today\'s plays',()=>{
 const history=Array.from({length:150},(_,i)=>pick('h'+i,new Date(Date.parse('2026-09-01T17:00:00Z')+i*3600e3).toISOString(),i%4!==0));
 const day=Array.from({length:12},(_,i)=>pick('d'+i,`2026-10-20T${String(12+i%8).padStart(2,'0')}:00:00Z`,i%2===0));
 const r=rk4([...history,...day]);
 const today=r.bets.filter(b=>b.t.startsWith('2026-10-20'));
 const opening=today[0].before;
 const risked=today.reduce((s,b)=>s+b.amount,0);
 assert4.ok(risked<=opening+1e-6);
 assert4.ok(today.some(b=>b.overBudget));
 for(const b of today)if(b.amount>0)assert4.ok(Math.abs(b.amount-opening*b.kelly)<1e-6);
});

t4('neutral site comes from the saved flag or the saved projection, never invented',()=>{
 assert4.equal(savedNeutralSite({neutralSite:true}),true);
 assert4.equal(savedNeutralSite({homeAdvantage:5.6,projection:{homeAdvantage:0}}),true);
 assert4.equal(savedNeutralSite({homeAdvantage:5.6,projection:{homeAdvantage:5.6}}),false);
 assert4.equal(savedNeutralSite({projection:{}}),false);
 assert4.equal(pregameTotal({games:{g:{edge:9,capturedAt:'2026-11-01T00:00:00Z'}}},{gameId:'g',startTime:'2026-11-01T01:00:00Z'}).edge,9);
 assert4.equal(pregameTotal({games:{g:{edge:9,capturedAt:'2026-11-01T02:00:00Z'}}},{gameId:'g',startTime:'2026-11-01T01:00:00Z'}),null);
});

t4('a CBB neutral-site star after Nov 4 is staked when Kelly is positive',()=>{
 const cbb=(id,startTime,win,extra={})=>({...pick(id,startTime,win,extra),sport:'cbb',homeAdvantage:5.6,projection:{homeAdvantage:extra.neutral?0:5.6}});
 const history=Array.from({length:150},(_,i)=>cbb('h'+i,new Date(Date.parse('2026-10-01T17:00:00Z')+i*3600e3).toISOString(),i%3!==0));
 const neutral=cbb('n','2026-11-10T20:00:00Z',true,{neutral:true}),home=cbb('x','2026-11-11T20:00:00Z',true);
 const r=rk4([...history,neutral,home]);
 assert4.ok(r.bets.find(b=>b.t===neutral.startTime).stake>0);
 assert4.equal(r.bets.find(b=>b.t===home.startTime).stake,0);
});
