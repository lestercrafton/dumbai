import test from 'node:test';
import assert from 'node:assert/strict';
import {replayBankroll,CAPITAL_ADJUSTMENTS,SIMULATION_EXPOSURE_POLICIES} from './bankroll.mjs';

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

test('settles a moved winning game on its verified played day without changing the saved forecast',()=>{
 const moved=forecast('moved','2026-09-27T19:05:00Z',100/176,{result:{status:'completed',pnl:100/176,playedAt:'2026-09-25T17:05:00Z'}});
 const next=forecast('next','2026-09-26T20:00:00Z',null);
 const replay=replayBankroll([moved,next]);
 assert.equal(moved.startTime,'2026-09-27T19:05:00Z');
 assert.equal(replay.plays.moved.date,'2026-09-25');
 near(replay.days[0].closingBankroll,500+10*100/176);
 near(replay.days[1].stake,(500+10*100/176)*0.02);
});

test('an unpriced pending schedule change cannot hold up a priced day',()=>{
 const unpriced=forecast('unpriced','2026-09-25T20:00:00Z',null,{odds:null});
 const priced=forecast('priced','2026-09-25T21:00:00Z',100/110);
 const replay=replayBankroll([unpriced,priced,forecast('next','2026-09-26T20:00:00Z',null)]);
 assert.equal(replay.days[0].pending,0);
 assert.equal(replay.days[0].status,'complete');
 assert.equal(replay.days[1].status,'pending');
 assert.equal(replay.blockedBy,'2026-09-26');
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

const paperForecast=(id,actualMargin=null,wager={kind:'archived-opening-spread',side:'home',homeSpread:-3.5,odds:-120,sourceUrl:'https://example.org/opening-line',retrievedAt:'2026-09-27T00:30:00Z'})=>({
 id,sport:'cfb',cohort:'live',modelVersion:'cfb-weekly-tuned-2026-09-14',origin:'cfb-reconstructed-2026-09-26',
 startTime:'2026-09-26T20:00:00Z',predictedMargin:7,marketHomeSpread:null,side:null,odds:null,paperWager:wager,
 result:actualMargin===null?null:{status:'completed',actualMargin,pnl:null,outcome:'no-line'}
});
const exactPaperCard=()=>[...Array.from({length:80},(_,i)=>paperForecast(`paper-${i}`)),...Array.from({length:36},(_,i)=>fundedForecast(`saved-${i}`,'2026-09-26',null))];

test('archived spread and synthetic winner offers settle from verified margins without altering official price fields',()=>{
 const paper=[paperForecast('win',7),paperForecast('loss',2),paperForecast('push',3,{kind:'archived-opening-spread',side:'home',homeSpread:-3,odds:-110,sourceUrl:'https://example.org',retrievedAt:'2026-09-27T00:30:00Z'}),paperForecast('away',-4,{kind:'archived-opening-spread',side:'away',homeSpread:-6.5,odds:130,sourceUrl:'https://example.org',retrievedAt:'2026-09-27T00:30:00Z'}),paperForecast('even',4,{kind:'synthetic-winner-even',side:'home',homeSpread:0,odds:100,sourceUrl:null,retrievedAt:null})];
 const before=structuredClone(paper),r=replayBankroll(paper);
 assert.deepEqual(paper,before);
 near(r.plays.win.profit,10*100/120);near(r.plays.loss.profit,-10);near(r.plays.push.profit,0);near(r.plays.away.profit,13);near(r.plays.even.profit,10);
 assert.deepEqual(paper.map(row=>r.plays[row.id].outcome),['win','loss','push','win','win']);
 assert.equal(r.paperFinals,5);assert.equal(r.days[0].savedPricedFinals,0);assert.equal(r.days[0].paperGames,5);
 assert.equal(r.plays.even.priceBasis,'synthetic-winner-even');assert.equal(r.plays.even.paper,true);assert.equal(paper[0].result.pnl,null);assert.equal(paper[0].marketHomeSpread,null);
});

test('the exact September 26 card risks 2% on all 116 plays with simulation exposure, not cash funding',()=>{
 const card=exactPaperCard();card[0].result={status:'completed',actualMargin:7,pnl:null,outcome:'no-line'};card[80].result={status:'completed',actualMargin:0,pnl:-1,outcome:'loss'};
 const later=fundedForecast('later','2026-09-27',1),r=replayBankroll([...card,later]),day=r.days[0];
 assert.equal(day.date,'2026-09-26');near(day.openingBankroll,500);near(day.stake,10);near(day.plannedRisk,1160);near(day.riskFraction,2.32);
 assert.equal(day.pricedGames,116);assert.equal(day.savedPricedGames,36);assert.equal(day.paperGames,80);assert.equal(day.pricedFinals,2);assert.equal(day.paperFinals,1);
 assert.equal(day.simulationExposure,true);assert.equal(r.simulationExposure,true);assert.equal(day.overBudget,true);assert.equal(day.fundingConfirmed,false);assert.equal(day.fundingRequired,false);
 assert.equal(day.status,'partial');assert.equal(day.pending,114);assert.equal(day.closingBankroll,null);assert.equal(r.blockedBy,'2026-09-26');
 near(r.balance,500+10*100/120-10);near(r.plays['paper-0'].stake,10);near(r.plays['saved-0'].stake,10);assert.equal(r.plays['paper-1'].outcome,'pending');assert.equal(r.plays.later.stake,null);
});

test('simulation exposure is restricted to the complete 80-paper plus 36-saved card',()=>{
 for(const card of [exactPaperCard().slice(1),[...exactPaperCard(),fundedForecast('extra','2026-09-26',null)]]){
  const r=replayBankroll(card),day=r.days[0];
  assert.equal(day.overBudget,true);assert.equal(day.simulationExposure,false);assert.equal(day.fundingConfirmed,false);assert.equal(day.fundingRequired,true);assert.equal(day.status,'over-budget');
  assert.equal(r.pricedFinals,0);near(r.balance,500);
 }
});

const prospectiveCard=()=>[
 ...Array.from({length:106},(_,i)=>fundedForecast(`future-${i}`,'2026-10-03',null)),
 fundedForecast('unpriced-final','2026-10-03',null,{odds:null,result:{status:'completed',pnl:null}}),
 fundedForecast('unpriced-pending','2026-10-03',null,{odds:null})
];

test('the prospective 106-priced full card retains 2% paper stakes without inventing cash funding or prices',()=>{
 const card=prospectiveCard(),before=structuredClone(card),r=replayBankroll(card),day=r.days[0];
 assert.deepEqual(card,before);near(day.openingBankroll,500);near(day.stake,10);near(day.plannedRisk,1060);near(day.riskFraction,2.12);
 assert.equal(day.pricedGames,106);assert.equal(day.savedPricedGames,106);assert.equal(day.paperGames,0);assert.equal(day.excludedFinals,1);assert.equal(day.pending,106);
 assert.equal(day.simulationExposure,true);assert.equal(day.simulationExposurePolicy,SIMULATION_EXPOSURE_POLICIES[0]);assert.equal(day.simulationExposurePolicy.dateFrom,'2026-10-02');assert.equal(day.simulationExposurePolicy.depositAmount,null);
 assert.equal(day.overBudget,true);assert.equal(day.fundingRequired,false);assert.equal(day.fundingConfirmed,false);assert.equal(day.fundingAuthorization,null);assert.equal(day.capitalAdjustment,null);near(r.capitalAdded,0);near(r.totalCapital,500);
 assert.equal(day.status,'pending');assert.equal(r.blockedBy,'2026-10-03');assert.equal(r.profit,null);
 for(const row of card.slice(0,106)){near(r.plays[row.id].stake,10);assert.equal(r.plays[row.id].simulationExposure,true);assert.equal(r.plays[row.id].fundingConfirmed,false);}
 for(const id of ['unpriced-final','unpriced-pending']){assert.equal(r.plays[id].stake,null);assert.equal(r.plays[id].status,'unpriced');}
});

test('completed prospective full cards compound the next day after settling every priced result',()=>{
 const card=prospectiveCard();
 for(const [i,row] of card.slice(0,106).entries())row.result={status:'completed',pnl:i<60?100/110:-1};
 const r=replayBankroll([...card,fundedForecast('next','2026-10-04',null)]),closing=500+10*(60*100/110-46);
 assert.equal(r.days[0].status,'complete');assert.equal(r.days[0].pending,0);assert.equal(r.days[0].pricedFinals,106);assert.equal(r.days[0].excludedFinals,1);near(r.days[0].closingBankroll,closing);
 near(r.balance,closing);near(r.profit,closing-500);near(r.days[1].openingBankroll,closing);near(r.plays.next.stake,closing*0.02);
 assert.equal(r.days[1].status,'pending');assert.equal(r.days[1].simulationExposure,false);assert.equal(r.days[1].simulationExposurePolicy,null);assert.equal(r.days[1].fundingConfirmed,false);near(r.capitalAdded,0);
});

test('prospective exposure authorization is limited to the exact sport, cohort, formula and effective date',()=>{
 for(const extra of [{sport:'nfl'},{cohort:'recovered'},{modelVersion:'ridge-v1'},{startTime:'2026-10-01T20:00:00Z'}]){
  const r=replayBankroll(Array.from({length:51},(_,i)=>fundedForecast(String(i),'2026-10-03',1,extra))),day=r.days[0];
  assert.equal(day.simulationExposure,false);assert.equal(day.simulationExposurePolicy,null);assert.equal(day.fundingConfirmed,false);assert.equal(day.fundingRequired,true);assert.equal(day.status,'over-budget');assert.equal(r.pricedFinals,0);near(r.balance,500);
 }
 const normal=replayBankroll(Array.from({length:50},(_,i)=>fundedForecast(String(i),'2026-10-02',1))).days[0];
 assert.equal(normal.overBudget,false);assert.equal(normal.simulationExposure,false);assert.equal(normal.simulationExposurePolicy,null);assert.equal(normal.status,'complete');
 const effective=replayBankroll(Array.from({length:51},(_,i)=>fundedForecast(String(i),'2026-10-02',1))).days[0];
 assert.equal(effective.simulationExposure,true);assert.equal(effective.fundingRequired,false);assert.equal(effective.status,'complete');
});

test('prospective paper exposure still waits for genuine prior pending results',()=>{
 const card=prospectiveCard(),prior=fundedForecast('prior','2026-10-02',null);
 const r=replayBankroll([prior,...card]),day=r.days[1];
 assert.equal(day.simulationExposure,true);assert.equal(day.fundingRequired,false);assert.equal(day.status,'waiting-prior');assert.equal(day.blockedBy,'2026-10-02');assert.equal(day.openingBankroll,null);assert.equal(day.stake,null);assert.equal(r.plays['future-0'].stake,null);near(r.balance,500);
 prior.result={status:'completed',pnl:1};const settled=replayBankroll([prior,...card]);
 assert.equal(settled.days[1].status,'pending');near(settled.days[1].openingBankroll,510);near(settled.plays['future-0'].stake,10.2);assert.equal(settled.days[1].fundingConfirmed,false);
});

test('prospective paper exposure never assigns zero or negative stakes after depletion',()=>{
 for(const losses of [50,51]){
  const prior=Array.from({length:losses},(_,i)=>fundedForecast(`loss-${i}`,'2026-10-02',-1));
  const r=replayBankroll([...prior,...prospectiveCard(),fundedForecast('later','2026-10-04',1)]);
  near(r.balance,500-losses*10);assert.equal(r.days[1].status,'bankroll-depleted');assert.equal(r.days[1].simulationExposure,true);assert.equal(r.days[1].plannedRisk,null);assert.equal(r.plays['future-0'].stake,null);assert.equal(r.plays['future-0'].profit,null);assert.equal(r.plays.later.stake,null);assert.equal(r.plays.later.profit,null);
 }
});

test('corrected final changes paper P/L, not its 2% opening stake or official result P/L',()=>{
 const card=exactPaperCard();card[0].result={status:'completed',actualMargin:7,pnl:null,outcome:'no-line'};
 const first=replayBankroll(card);near(first.plays['paper-0'].profit,10*100/120);near(first.plays['paper-0'].stake,10);
 card[0].result.actualMargin=1;
 const corrected=replayBankroll(card);near(corrected.plays['paper-0'].profit,-10);near(corrected.plays['paper-0'].stake,10);
 near(first.balance-corrected.balance,10*(1+100/120));assert.equal(card[0].result.pnl,null);
});

test('a missing or invalid paper offer is excluded rather than supplied with invented odds',()=>{
 const row=paperForecast('bad',7,{kind:'archived-opening-spread',side:'home',homeSpread:-3,odds:null,sourceUrl:null,retrievedAt:null});
 const r=replayBankroll([row]);assert.equal(r.plays.bad.stake,null);assert.equal(r.excludedFinals,1);assert.equal(r.pricedFinals,0);
});
