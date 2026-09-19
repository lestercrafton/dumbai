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
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const dateFormatter=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
const gameDay=value=>{const parts=dateFormatter.formatToParts(new Date(value));return ['year','month','day'].map(type=>parts.find(p=>p.type===type).value).join('-');};

export function replayBankroll(records){
 const scopes=new Set(records.map(f=>`${f.sport}:${f.cohort}:${f.modelVersion||'ridge-v1'}`));
 if(scopes.size>1)throw new Error('Bankroll replay requires one sport, cohort and formula.');
 const groups=new Map();
 for(const f of records){const date=gameDay(f.startTime);if(!groups.has(date))groups.set(date,[]);groups.get(date).push(f);}
 let balance=BANKROLL_POLICY.startingBankroll,capitalAdded=0,blockedBy=null,pricedFinals=0,excludedFinals=0;
 const days=[];
 /** @type {Record<string,any>} */
 const plays={};
 for(const [date,forecasts] of [...groups].sort(([a],[b])=>a.localeCompare(b))){
  const eligible=f=>finite(f.odds)&&Math.abs(f.odds)>=100&&finite(f.marketHomeSpread)&&['home','away'].includes(f.side)&&f.result?.status!=='void';
  const priced=forecasts.filter(eligible);
  const pending=forecasts.filter(f=>!f.result).length;
  const finals=priced.filter(f=>f.result?.status==='completed'&&finite(f.result.pnl));
  const missing=forecasts.filter(f=>f.result?.status==='completed'&&!finite(f.result.pnl)).length;
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
  const fundingRequired=overBudget&&!fundingConfirmed;
  const bankrollDepleted=openingBankroll!==null&&openingBankroll<=0;
  const status=blockedBy?'waiting-prior':bankrollDepleted?'bankroll-depleted':fundingRequired?'over-budget':pending?(finals.length?'partial':'pending'):'complete';
  const funded=stake!==null&&!bankrollDepleted&&!fundingRequired;
  const profit=funded&&finals.length?finals.reduce((sum,f)=>sum+f.result.pnl*stake,0):null;
  const balanceAfterFinals=funded?openingBankroll+(profit??0):null;
  const row={date,balanceBeforeFunding,capitalAdded:dayCapitalAdded,capitalAdjustment,openingBankroll,stake:funded?stake:null,plannedRisk:bankrollDepleted?null:plannedRisk,riskFraction,overBudget,fundingConfirmed,fundingRequired,fundingAuthorization,pricedGames:priced.length,pricedFinals:funded?finals.length:0,excludedFinals:missing,pending,profit,profitUnits:profit===null?null:profit/BANKROLL_POLICY.initialUnit,balanceAfterFinals,closingBankroll:status==='complete'?balanceAfterFinals:null,status,blockedBy};
  days.push(row);
  for(const f of forecasts){const priceKnown=eligible(f),risk=funded&&priceKnown?stake:null;const pnl=risk!==null&&f.result?.status==='completed'&&finite(f.result.pnl)?risk*f.result.pnl:null;plays[f.id]={date,stake:risk,riskUnits:risk===null?null:risk/BANKROLL_POLICY.initialUnit,profit:pnl,profitUnits:pnl===null?null:pnl/BANKROLL_POLICY.initialUnit,fundingConfirmed,blockedBy,status:f.result?.status==='void'?'void':!priceKnown?'unpriced':!funded?status:f.result?.status==='completed'?'settled':'pending'};}
  excludedFinals+=missing;
  if(funded){balance=balanceAfterFinals;pricedFinals+=finals.length;}
  if(!blockedBy&&(pending||fundingRequired||bankrollDepleted))blockedBy=date;
 }
 const totalCapital=BANKROLL_POLICY.startingBankroll+capitalAdded;
 const profit=pricedFinals?balance-totalCapital:null;
 return {policy:BANKROLL_POLICY,days,plays,balance,capitalAdded,totalCapital,profit,profitUnits:profit===null?null:profit/BANKROLL_POLICY.initialUnit,returnRate:profit===null?null:profit/totalCapital,pricedFinals,excludedFinals,blockedBy};
}
