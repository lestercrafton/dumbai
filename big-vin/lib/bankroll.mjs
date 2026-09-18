/** Replay the original calculator: C4=B4*0.02; B5=B4+D4; C5=B5*0.02.
 * This is a hypothetical overlay on frozen forecasts, not a wager ledger.
 * Preserve spreadsheet precision; round only when displaying money.
 */
export const BANKROLL_POLICY=Object.freeze({id:'sheet-daily-2pct-v1',startingBankroll:500,fraction:0.02,initialUnit:10,sourceUrl:'https://docs.google.com/spreadsheets/d/1zABY01XJsVkXW_ZoqVXay1Q65SMQVJHxGqx6t6aexx4/edit',sourceCells:'Sheet1!B4:C5',verifiedOn:'2026-09-16'});
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const dateFormatter=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
const gameDay=value=>{const parts=dateFormatter.formatToParts(new Date(value));return ['year','month','day'].map(type=>parts.find(p=>p.type===type).value).join('-');};

export function replayBankroll(records){
 const scopes=new Set(records.map(f=>`${f.sport}:${f.cohort}:${f.modelVersion||'ridge-v1'}`));
 if(scopes.size>1)throw new Error('Bankroll replay requires one sport, cohort and formula.');
 const groups=new Map();
 for(const f of records){const date=gameDay(f.startTime);if(!groups.has(date))groups.set(date,[]);groups.get(date).push(f);}
 let balance=BANKROLL_POLICY.startingBankroll,blockedBy=null,pricedFinals=0,excludedFinals=0;
 const days=[];
 /** @type {Record<string,any>} */
 const plays={};
 for(const [date,forecasts] of [...groups].sort(([a],[b])=>a.localeCompare(b))){
  const eligible=f=>finite(f.odds)&&Math.abs(f.odds)>=100&&finite(f.marketHomeSpread)&&['home','away'].includes(f.side)&&f.result?.status!=='void';
  const priced=forecasts.filter(eligible);
  const pending=forecasts.filter(f=>!f.result).length;
  const finals=priced.filter(f=>f.result?.status==='completed'&&finite(f.result.pnl));
  const missing=forecasts.filter(f=>f.result?.status==='completed'&&!finite(f.result.pnl)).length;
  const openingBankroll=blockedBy?null:balance;
  const stake=openingBankroll===null?null:openingBankroll*BANKROLL_POLICY.fraction;
  const plannedRisk=stake===null?null:priced.length*stake;
  const riskFraction=priced.length*BANKROLL_POLICY.fraction;
  const overBudget=riskFraction>1+1e-8;
  const status=blockedBy?'waiting-prior':overBudget?'over-budget':pending?(finals.length?'partial':'pending'):'complete';
  const funded=stake!==null&&!overBudget;
  const profit=funded&&finals.length?finals.reduce((sum,f)=>sum+f.result.pnl*stake,0):null;
  const balanceAfterFinals=funded?openingBankroll+(profit??0):null;
  const row={date,openingBankroll,stake:funded?stake:null,plannedRisk,riskFraction,overBudget,pricedGames:priced.length,pricedFinals:funded?finals.length:0,excludedFinals:missing,pending,profit,profitUnits:profit===null?null:profit/BANKROLL_POLICY.initialUnit,balanceAfterFinals,closingBankroll:status==='complete'?balanceAfterFinals:null,status,blockedBy};
  days.push(row);
  for(const f of forecasts){const priceKnown=eligible(f),risk=funded&&priceKnown?stake:null;const pnl=risk!==null&&f.result?.status==='completed'&&finite(f.result.pnl)?risk*f.result.pnl:null;plays[f.id]={date,stake:risk,riskUnits:risk===null?null:risk/BANKROLL_POLICY.initialUnit,profit:pnl,profitUnits:pnl===null?null:pnl/BANKROLL_POLICY.initialUnit,status:!funded?status:f.result?.status==='void'?'void':!priceKnown?'unpriced':f.result?.status==='completed'?'settled':'pending'};}
  excludedFinals+=missing;
  if(funded){balance=balanceAfterFinals;pricedFinals+=finals.length;}
  if(!blockedBy&&(pending||overBudget))blockedBy=date;
 }
 const profit=pricedFinals?balance-BANKROLL_POLICY.startingBankroll:null;
 return {policy:BANKROLL_POLICY,days,plays,balance,profit,profitUnits:profit===null?null:profit/BANKROLL_POLICY.initialUnit,returnRate:profit===null?null:profit/BANKROLL_POLICY.startingBankroll,pricedFinals,excludedFinals,blockedBy};
}
