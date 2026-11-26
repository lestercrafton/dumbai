import test from 'node:test';
import assert from 'node:assert/strict';
import {NHL_PRICE_AWARE_FROM,nhlPriceAware,nhlCoverChance,nhlMarketChance,nhlSelection,nhlWinChance} from './nhl-pricing.mjs';
import {spreadSelection,quotePrices,withPickState,PICK_PROTOCOL} from './pick-revisions.mjs';
import {scoreGame,advantageRule} from './rank-signal.mjs';

const after='2026-11-28T00:00:00.000Z',before='2026-11-20T00:00:00.000Z';
const signal={basis:'win',sportRate:0.64,clvMean:0,buckets:{'favorite:large':{n:20,wins:13,winChance:0.61,expectedClv:0}}};

test('gate applies only to NHL from the effective time',()=>{
 assert.equal(nhlPriceAware('nhl',NHL_PRICE_AWARE_FROM),true);
 assert.equal(nhlPriceAware('nhl',before),false);
 assert.equal(nhlPriceAware('nba',after),false);
 assert.equal(nhlPriceAware('nhl',null),false);
});

test('cover chance and no-vig market chance',()=>{
 const home=nhlCoverChance(0.7,-1.5,'home'),away=nhlCoverChance(0.7,-1.5,'away');
 assert.ok(Math.abs(home+away-1)<1e-12);
 assert.ok(home>0.37&&home<0.40,String(home));
 const m=nhlMarketChance('away',124,-148);
 assert.ok(m>0.57&&m<0.58,String(m));
 assert.equal(nhlMarketChance('home',null,-148),null);
});

test('price-aware side can take the -1.5 favorite when its price is long enough',()=>{
 // Model home by 0.7 goals; home -1.5 at +200 covers ~39% vs 33% break-even.
 const pick=nhlSelection(0.7,-1.5,200,-250);
 assert.equal(pick.side,'home');
 // At +124 the -1.5 is not worth it; the +1.5 at -148 is not either, but it is the better of the two.
 assert.equal(nhlSelection(0.7,-1.5,124,-148).side,'away');
});

test('spreadSelection: NHL after the date uses prices; before the date and other sports unchanged',()=>{
 const q={homeSpreadPrice:200,awaySpreadPrice:-250};
 assert.equal(spreadSelection(0.7,-1.5,quotePrices('nhl',{...q,observedAt:after})).side,'home');
 assert.equal(spreadSelection(0.7,-1.5,quotePrices('nhl',{...q,observedAt:before})).side,'away');
 assert.equal(spreadSelection(0.7,-1.5,quotePrices('nba',{...q,observedAt:after})).side,'away');
 // Missing a price keeps the old rule.
 assert.equal(spreadSelection(0.7,-1.5,quotePrices('nhl',{homeSpreadPrice:200,observedAt:after})).side,'away');
});

test('NHL win chance blends model and market 50/50 and replaces the bucket after the date',()=>{
 const w=nhlWinChance({margin:0.7,homeSpread:-1.5,side:'home',homePrice:114,awayPrice:-135});
 assert.ok(Math.abs(w.winChance-(w.modelChance+w.marketChance)/2)<1e-12);
 const args={side:'home',homeSpread:-1.5,edge:0.8,odds:114,sport:'nhl',margin:0.7,homePrice:114,awayPrice:-135};
 const old=scoreGame(signal,{...args,startTime:before});
 assert.equal(old.winChance,0.61); // the price-blind bucket
 const fixed=scoreGame(signal,{...args,startTime:after});
 assert.ok(fixed.winChance<0.45,String(fixed.winChance));
 assert.equal(fixed.method,'nhl-price-aware');
 // Other sports ignore the new arguments.
 const nba=scoreGame(signal,{...args,sport:'nba',edge:6,startTime:after});
 assert.equal(nba.method,undefined);
});

test('no NHL stars from the date; earlier NHL star rule unchanged',()=>{
 const score={winChance:0.7,breakEven:0.5};
 assert.equal(advantageRule('nhl',{edge:1,startTime:after},score),null);
 assert.ok(advantageRule('nhl',{edge:1,startTime:before},score));
});

test('withPickState keeps an NHL revision saved under the old rule',()=>{
 const f={id:'ridge-v1:nhl:1',gameId:'1',sport:'nhl',origin:'collector',homeId:'a',awayId:'b',cohort:'live',modelVersion:'ridge-v1',predictedMargin:0.7,startTime:'2026-11-29T00:00:00.000Z',capturedAt:'2026-11-27T10:00:00.000Z',marketHomeSpread:null,side:null};
 const r={id:'x',forecastId:f.id,gameId:'1',homeId:'a',awayId:'b',modelVersion:'ridge-v1',predictedMargin:0.7,marketHomeSpread:-1.5,marketHomePrice:200,marketAwayPrice:-250,side:'away',odds:-250,observedAt:'2026-11-28T10:00:00.000Z',recordedAt:'2026-11-28T10:00:01.000Z',provider:'DK'};
 const state={protocol:PICK_PROTOCOL,forecastId:f.id,revisions:[r],lockAt:f.startTime,closedAt:null,verifiedAt:r.observedAt};
 const out=withPickState(f,state);
 assert.equal(out.pickRevision?.side,'away');
});

test('bankroll replay never stakes NHL from the date, even at a big Kelly %',async()=>{
 const {replayKellyBankroll}=await import('./kelly-bankroll.mjs');
 const rec=(id,start,side,odds)=>({id:'ridge-v1:nhl:'+id,gameId:String(id),sport:'nhl',cohort:'live',origin:'collector',modelVersion:'ridge-v1',homeId:'a',awayId:'b',home:'A',away:'B',
  predictedMargin:1.4,marketHomeSpread:-1.5,marketHomePrice:250,marketAwayPrice:-320,side,odds,startTime:start,capturedAt:'2026-11-01T00:00:00.000Z',
  result:{status:'completed',homeScore:4,awayScore:1,actualMargin:3,observedAt:new Date(Date.parse(start)+4*3600e3).toISOString()}});
 const r=replayKellyBankroll([rec(1,'2026-11-28T00:00:00.000Z','home',250),rec(2,'2026-11-29T00:00:00.000Z','home',250)]);
 assert.equal(r.betCount,0);
 assert.equal(r.kelly.bankroll,r.start);
 assert.ok(r.bets.every(b=>b.winChance>0.35&&b.winChance<0.4)); // 0.5×48.5% model + 0.5×27.3% no-vig
});
