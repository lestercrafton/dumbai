/** Replay the original calculator: C4=B4*0.02; B5=B4+D4; C5=B5*0.02.
 * This is a hypothetical overlay on frozen forecasts, not a wager ledger.
 * Preserve spreadsheet precision; round only when displaying money.
 */
export const BANKROLL_POLICY=Object.freeze({id:'sheet-daily-2pct-v1',startingBankroll:500,fraction:0.02,initialUnit:10,sourceUrl:'https://docs.google.com/spreadsheets/d/1zABY01XJsVkXW_ZoqVXay1Q65SMQVJHxGqx6t6aexx4/edit',sourceCells:'Sheet1!B4:C5',verifiedOn:'2026-09-16'});
// Owner confirmation applies to this experiment's exact card, not a deposit,
// an executed wager, another formula, or permission to fund future dates.
export const FUNDING_CONFIRMATIONS=Object.freeze([Object.freeze({
 id:'owner-cfb-live-tuned-2026-09-19',sport:'cfb',cohort:'live',
 modelVersion:'cfb-weekly-tuned-2026-09-14',date:'2026-09-19',
 recordedAt:'2026-09-19T15:08:27Z',source:'Owner: Consider this funded.',
 stakeBasis:'2% of daily opening bankroll',depositAmount:null
})]);
// Fixed at the verified Sep 18 closing balance when the owner doubled today's
// bankroll. Replays and later score corrections must not resize this addition.
export const CAPITAL_ADJUSTMENTS=Object.freeze([Object.freeze({
 id:'owner-double-cfb-live-tuned-2026-09-19',sport:'cfb',cohort:'live',
 modelVersion:'cfb-weekly-tuned-2026-09-14',date:'2026-09-19',
 recordedAt:'2026-09-19T15:11:18Z',amount:499.0740740740741,
 source:'Owner: you can double my bankroll',kind:'experiment-capital-addition'
})]);
// Prospective full-card paper exposure preserves the owner's spreadsheet stake
// even when a day's combined hypothetical risk exceeds its opening balance.
// This authorizes simulation exposure, not cash funding or additional capital.
export const SIMULATION_EXPOSURE_POLICIES=Object.freeze([Object.freeze({
 id:'owner-cfb-live-tuned-full-card-paper-2026-10-02',sport:'cfb',cohort:'live',
 modelVersion:'cfb-weekly-tuned-2026-09-14',dateFrom:'2026-10-02',
 recordedOn:'2026-10-02',kind:'paper-full-card-exposure',
 source:'User paper-experiment authorization: "We\'re not betting real money. This is just an experiment." and "Put it all in my bankroll."',
 stakeBasis:'2% of daily opening bankroll',depositAmount:null
})]);
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const dateFormatter=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
const gameDay=value=>{const parts=dateFormatter.formatToParts(new Date(value));return ['year','month','day'].map(type=>parts.find(p=>p.type===type).value).join('-');};
const RECONSTRUCTED_ORIGIN='cfb-reconstructed-2026-09-26';
const RECONSTRUCTED_VERSION='cfb-weekly-tuned-2026-09-14';
const validOdds=value=>Number.isInteger(value)&&Math.abs(value)>=100;
const savedPrice=f=>f.origin!==RECONSTRUCTED_ORIGIN&&finite(f.odds)&&validOdds(f.odds)&&finite(f.marketHomeSpread)&&['home','away'].includes(f.side);
const paperPrice=f=>f.origin===RECONSTRUCTED_ORIGIN&&f.sport==='cfb'&&f.cohort==='live'&&f.modelVersion===RECONSTRUCTED_VERSION&&gameDay(f.startTime)==='2026-09-26'&&
 ['archived-opening-spread','synthetic-winner-even'].includes(f.paperWager?.kind)&&['home','away'].includes(f.paperWager?.side)&&finite(f.paperWager?.homeSpread)&&validOdds(f.paperWager?.odds)&&
 (f.paperWager.kind!=='synthetic-winner-even'||f.paperWager.homeSpread===0&&f.paperWager.odds===100&&finite(f.predictedMargin)&&f.predictedMargin!==0&&f.paperWager.side===(f.predictedMargin>0?'home':'away'));
const stakeable=f=>f.result?.status!=='void'&&(savedPrice(f)||paperPrice(f));
const unitReturn=f=>{
 if(f.result?.status!=='completed')return null;
 if(paperPrice(f)){
  if(!finite(f.result.actualMargin))return null;
  const cover=(f.result.actualMargin+f.paperWager.homeSpread)*(f.paperWager.side==='home'?1:-1);
  return Math.abs(cover)<1e-9?0:cover<0?-1:f.paperWager.odds>0?f.paperWager.odds/100:100/-f.paperWager.odds;
 }
 return savedPrice(f)&&finite(f.result.pnl)?f.result.pnl:null;
};
const paperOutcome=f=>{
 if(f.result?.status==='void')return 'void';
 if(f.result?.status!=='completed'||!finite(f.result.actualMargin))return 'pending';
 const cover=(f.result.actualMargin+f.paperWager.homeSpread)*(f.paperWager.side==='home'?1:-1);
 return Math.abs(cover)<1e-9?'push':cover>0?'win':'loss';
};

export function replayBankroll(records){
 const scopes=new Set(records.map(f=>`${f.sport}:${f.cohort}:${f.modelVersion||'ridge-v1'}`));
 if(scopes.size>1)throw new Error('Bankroll replay requires one sport, cohort and formula.');
 const groups=new Map();
 for(const f of records){const date=gameDay(f.result?.status==='completed'&&f.result.playedAt||f.startTime);if(!groups.has(date))groups.set(date,[]);groups.get(date).push(f);}
 let balance=BANKROLL_POLICY.startingBankroll,capitalAdded=0,blockedBy=null,pricedFinals=0,excludedFinals=0,paperFinals=0,paperProfit=0;
 const days=[];
 /** @type {Record<string,any>} */
 const plays={};
 for(const [date,forecasts] of [...groups].sort(([a],[b])=>a.localeCompare(b))){
  const priced=forecasts.filter(stakeable);
  // Paper wagers use a separately labeled historical/synthetic offer. The
  // verified forecast's original market and result P/L remain untouched.
  const pending=priced.filter(f=>!f.result||f.result.status==='completed'&&!finite(unitReturn(f))).length;
  const finals=priced.filter(f=>finite(unitReturn(f)));
  const paper=forecasts.filter(paperPrice);
  const paperSettled=finals.filter(paperPrice);
  const savedPriced=forecasts.filter(savedPrice);
  const missing=forecasts.filter(f=>f.result?.status==='completed'&&!finite(unitReturn(f))).length;
  const scope=forecasts[0];
  const matchesScope=a=>a.date===date&&a.sport===scope.sport&&a.cohort===scope.cohort&&a.modelVersion===(scope.modelVersion||'ridge-v1');
  const capitalAdjustment=CAPITAL_ADJUSTMENTS.find(matchesScope)??null;
  const balanceBeforeFunding=blockedBy?null:balance;
  const dayCapitalAdded=blockedBy?0:capitalAdjustment?.amount??0;
  if(!blockedBy){balance+=dayCapitalAdded;capitalAdded+=dayCapitalAdded;}
  const openingBankroll=blockedBy?null:balance;
  const stake=openingBankroll===null?null:openingBankroll*BANKROLL_POLICY.fraction;
  const plannedRisk=stake===null?null:priced.length*stake;
  const riskFraction=priced.length*BANKROLL_POLICY.fraction;
  const overBudget=riskFraction>1+1e-8;
  const fundingAuthorization=FUNDING_CONFIRMATIONS.find(matchesScope)??null;
  const fundingConfirmed=fundingAuthorization!==null;
  // This exact 116-pick, 232%-exposure experiment is authorized as a paper
  // simulation. It is not a statement that the owner deposited or risked cash.
  const historicalSimulationExposure=date==='2026-09-26'&&scope.sport==='cfb'&&scope.cohort==='live'&&scope.modelVersion===RECONSTRUCTED_VERSION&&forecasts.length===116&&paper.length===80&&savedPriced.length===36;
  const simulationExposurePolicy=overBudget?SIMULATION_EXPOSURE_POLICIES.find(a=>date>=a.dateFrom&&a.sport===scope.sport&&a.cohort===scope.cohort&&a.modelVersion===(scope.modelVersion||'ridge-v1'))??null:null;
  const simulationExposure=historicalSimulationExposure||simulationExposurePolicy!==null;
  const fundingRequired=overBudget&&!fundingConfirmed&&!simulationExposure;
  const bankrollDepleted=openingBankroll!==null&&openingBankroll<=0;
  const status=blockedBy?'waiting-prior':bankrollDepleted?'bankroll-depleted':fundingRequired?'over-budget':pending?(finals.length?'partial':'pending'):'complete';
  const funded=stake!==null&&!bankrollDepleted&&!fundingRequired;
  const profit=funded&&finals.length?finals.reduce((sum,f)=>sum+unitReturn(f)*stake,0):null;
  const dayPaperProfit=funded&&paperSettled.length?paperSettled.reduce((sum,f)=>sum+unitReturn(f)*stake,0):null;
  const balanceAfterFinals=funded?openingBankroll+(profit??0):null;
  const row={date,balanceBeforeFunding,capitalAdded:dayCapitalAdded,capitalAdjustment,openingBankroll,stake:funded?stake:null,plannedRisk:bankrollDepleted?null:plannedRisk,riskFraction,overBudget,fundingConfirmed,fundingRequired,fundingAuthorization,simulationExposure,simulationExposurePolicy,pricedGames:priced.length,savedPricedGames:savedPriced.length,paperGames:paper.length,pricedFinals:funded?finals.length:0,savedPricedFinals:funded?finals.length-paperSettled.length:0,paperFinals:funded?paperSettled.length:0,paperProfit:dayPaperProfit,excludedFinals:missing,pending,profit,profitUnits:profit===null?null:profit/BANKROLL_POLICY.initialUnit,balanceAfterFinals,closingBankroll:status==='complete'?balanceAfterFinals:null,status,blockedBy};
  days.push(row);
  for(const f of forecasts){const priceKnown=stakeable(f),risk=funded&&priceKnown?stake:null;const unit=unitReturn(f),pnl=risk!==null&&finite(unit)?risk*unit:null,isPaper=paperPrice(f);plays[f.id]={date,stake:risk,riskUnits:risk===null?null:risk/BANKROLL_POLICY.initialUnit,profit:pnl,profitUnits:pnl===null?null:pnl/BANKROLL_POLICY.initialUnit,priceBasis:isPaper?f.paperWager.kind:savedPrice(f)?'saved-market':null,paper:isPaper,outcome:isPaper?paperOutcome(f):f.result?.outcome??(f.result?.status==='void'?'void':'pending'),simulationExposure,fundingConfirmed,blockedBy,status:f.result?.status==='void'?'void':!priceKnown?'unpriced':!funded?status:finite(unit)?'settled':'pending'};}
  excludedFinals+=missing;
  if(funded){balance=balanceAfterFinals;pricedFinals+=finals.length;paperFinals+=paperSettled.length;paperProfit+=dayPaperProfit??0;}
  if(!blockedBy&&(pending||fundingRequired||bankrollDepleted))blockedBy=date;
 }
 const totalCapital=BANKROLL_POLICY.startingBankroll+capitalAdded;
 const profit=pricedFinals?balance-totalCapital:null;
 return {policy:BANKROLL_POLICY,days,plays,balance,capitalAdded,totalCapital,profit,profitUnits:profit===null?null:profit/BANKROLL_POLICY.initialUnit,returnRate:profit===null?null:profit/totalCapital,pricedFinals,paperFinals,paperProfit,excludedFinals,blockedBy,simulationExposure:days.some(day=>day.simulationExposure)};
}
