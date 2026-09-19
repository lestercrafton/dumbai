import test from 'node:test';
import assert from 'node:assert/strict';
import {replayBankroll,CAPITAL_ADJUSTMENTS} from './bankroll.mjs';

const forecast=(id,startTime,pnl,extra={})=>({id,sport:'mlb',cohort:'live',modelVersion:'test',startTime,marketHomeSpread:1.5,side:'home',odds:-110,result:pnl===null?null:{status:'completed',pnl},...extra});
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-9,`${actual} != ${expected}`);

test('matches the original $500 → $484 → $9.68 formula without intraday compounding',()=>{
 const games=Array.from({length:10},(_,i)=>forecast(String(i),'2026-09-14T20:00:00Z',i<3?-1:0.2,{odds:-500}));
 const replay=replayBankroll([...games,forecast('tomorrow','2026-09-15T20:00:00Z',null)]);
 near(replay.days[0].stake,10);near(replay.days[0].closingBankroll,484);near(replay.days[1].stake,9.68);
 assert.equal(new Set(games.map(f=>replay.plays[f.id].stake)).size,1);
});

test('preserves fractional precision across daily stakes and initial-unit returns',()=>{
 const replay=replayBankroll([forecast('a','2026-09-14T20:00:00Z',100/137),forecast('b','2026-09-15T20:00:00Z',100/164)]);
 const first=500+10*100/137;near(replay.days[1].stake,first*0.02);
 near(replay.balance,first+first*0.02*100/164);near(replay.profitUnits,(replay.balance-500)/10);
});

test('groups after-midnight UTC games into the preceding Eastern game day',()=>{
 const replay=replayBankroll([forecast('a','2026-09-15T00:30:00Z',1),forecast('b','2026-09-14T20:00:00Z',-1)]);
 assert.equal(replay.days.length,1);assert.equal(replay.days[0].date,'2026-09-14');near(replay.balance,500);
});

test('excludes missing odds and preserves zero from pushes without charging voids',()=>{
 const replay=replayBankroll([forecast('missing','2026-09-14T20:00:00Z',null,{odds:null,result:{status:'completed',pnl:null}}),forecast('push','2026-09-14T20:00:00Z',0),forecast('void','2026-09-14T20:00:00Z',null,{result:{status:'void',pnl:null}})]);
 assert.equal(replay.excludedFinals,1);assert.equal(replay.pricedFinals,1);near(replay.profit,0);assert.equal(replay.plays.missing.stake,null);assert.equal(replay.plays.void.stake,null);near(replay.days[0].plannedRisk,10);
});

test('keeps a partial day’s stake fixed and defers later graded results until it settles',()=>{
 const replay=replayBankroll([forecast('a','2026-09-14T20:00:00Z',1),forecast('b','2026-09-14T21:00:00Z',null),forecast('later','2026-09-15T20:00:00Z',1)]);
 near(replay.balance,510);near(replay.plays.b.stake,10);assert.equal(replay.days[0].closingBankroll,null);assert.equal(replay.days[1].status,'waiting-prior');assert.equal(replay.plays.later.profit,null);
});

test('pauses an unfunded full card without resizing or choosing a subset',()=>{
 const replay=replayBankroll([...Array.from({length:51},(_,i)=>forecast(String(i),'2026-09-14T20:00:00Z',-1)),forecast('later','2026-09-15T20:00:00Z',1)]);
 assert.equal(replay.days[0].status,'over-budget');near(replay.days[0].riskFraction,1.02);assert.equal(replay.days[0].closingBankroll,null);assert.equal(replay.pricedFinals,0);assert.equal(replay.plays.later.stake,null);near(replay.balance,500);
});

test('empty records do not invent returns; mixed formulas are rejected',()=>{
 assert.equal(replayBankroll([]).profit,null);
 assert.throws(()=>replayBankroll([forecast('a','2026-09-14T20:00:00Z',1),forecast('b','2026-09-14T20:00:00Z',1,{modelVersion:'other'})]),/one sport/);
});

const fundedForecast=(id,date,pnl,extra={})=>forecast(id,date+'T20:00:00Z',pnl,{sport:'cfb',modelVersion:'cfb-weekly-tuned-2026-09-14',...extra});
const added=CAPITAL_ADJUSTMENTS[0].amount;
test('owner-confirmed card retains 2% stakes and 192% exposure while separating added capital',()=>{
 const prior=fundedForecast('prior','2026-09-18',-1);
 const games=Array.from({length:96},(_,i)=>fundedForecast(String(i),'2026-09-19',i===0?1:null));
 const records=[prior,...games];const before=structuredClone(records);const r=replayBankroll(records),day=r.days[1];
 assert.deepEqual(records,before);near(day.openingBankroll,490+added);near(day.stake,(490+added)*0.02);near(day.plannedRisk,(490+added)*1.92);near(day.riskFraction,1.92);
 assert.equal(day.overBudget,true);assert.equal(day.fundingRequired,false);assert.equal(day.fundingConfirmed,true);assert.equal(day.status,'partial');
 assert.equal(day.fundingAuthorization.depositAmount,null);near(r.balance,490+added+day.stake);near(r.profit,-10+day.stake);near(r.capitalAdded,added);near(r.totalCapital,500+added);near(r.returnRate,r.profit/r.totalCapital);
 assert.equal(new Set(games.map(f=>r.plays[f.id].stake)).size,1);assert.equal(r.days[0].fundingConfirmed,false);
});
test('confirmation is isolated to the exact sport, cohort, model and Eastern date',()=>{
 for(const extra of [{sport:'mlb'},{cohort:'recovered'},{modelVersion:'ridge-v1'},{startTime:'2026-09-20T20:00:00Z'}]){
  const r=replayBankroll(Array.from({length:51},(_,i)=>fundedForecast(String(i),'2026-09-19',1,extra)));
  assert.equal(r.days[0].status,'over-budget');assert.equal(r.days[0].fundingConfirmed,false);assert.equal(r.pricedFinals,0);near(r.balance,500);near(r.capitalAdded,0);
 }
});
test('confirmed funding never bypasses unresolved prior results or missing saved prices',()=>{
 const pending=replayBankroll([fundedForecast('prior','2026-09-18',null),fundedForecast('today','2026-09-19',1)]);
 assert.equal(pending.days[1].fundingConfirmed,true);assert.equal(pending.days[1].status,'waiting-prior');assert.equal(pending.plays.today.stake,null);near(pending.capitalAdded,0);
 const r=replayBankroll([fundedForecast('missing','2026-09-19',null,{odds:null,result:{status:'completed',pnl:null}}),fundedForecast('void','2026-09-19',null,{result:{status:'void',pnl:null}})]);
 assert.equal(r.plays.missing.stake,null);assert.equal(r.plays.missing.status,'unpriced');assert.equal(r.plays.void.stake,null);assert.equal(r.plays.void.status,'void');assert.equal(r.profit,null);near(r.balance,500+added);
});
test('a settled funded card compounds the next day normally without extending authorization',()=>{
 const r=replayBankroll([...Array.from({length:51},(_,i)=>fundedForecast(String(i),'2026-09-19',i%2?1:-1)),fundedForecast('next','2026-09-20',null)]);
 assert.equal(r.days[0].status,'complete');near(r.days[0].closingBankroll,(500+added)*0.98);near(r.days[1].stake,(500+added)*0.98*0.02);assert.equal(r.days[1].fundingConfirmed,false);
});
test('negative balance never creates negative stakes or reverses later P&L',()=>{
 for(const count of [51,96]){
  const r=replayBankroll([...Array.from({length:count},(_,i)=>fundedForecast(String(i),'2026-09-19',-1)),fundedForecast('next','2026-09-20',-1),fundedForecast('later','2026-09-21',1)]);
  near(r.balance,(500+added)*(1-count*0.02));near(r.profit,-count*(500+added)*0.02);assert.equal(r.days[1].status,'bankroll-depleted');assert.equal(r.days[1].plannedRisk,null);assert.equal(r.plays.next.stake,null);assert.equal(r.plays.next.profit,null);assert.equal(r.plays.later.stake,null);
 }
});

test('capital addition doubles the verified closing balance once and never becomes a win',()=>{
 const records=[fundedForecast('prior','2026-09-18',(added-500)/10),fundedForecast('today','2026-09-19',null)];
 const r=replayBankroll(records);near(r.days[1].openingBankroll,2*added);near(r.days[1].stake,2*added*0.02);near(r.profit,added-500);assert.deepEqual(replayBankroll(records),r);
 records[0].result.pnl=1;const corrected=replayBankroll(records);near(corrected.capitalAdded,added);near(corrected.days[1].openingBankroll,510+added);near(corrected.profit,10);
});
test('an exactly depleted unfunded bankroll produces no zero stakes',()=>{
 const r=replayBankroll([...Array.from({length:50},(_,i)=>forecast(String(i),'2026-09-14T20:00:00Z',-1)),forecast('next','2026-09-15T20:00:00Z',1)]);
 near(r.balance,0);assert.equal(r.days[1].status,'bankroll-depleted');assert.equal(r.plays.next.stake,null);assert.equal(r.plays.next.profit,null);
});
