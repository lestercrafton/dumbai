/** Grade the selected side against a sportsbook line independently of payout.
 * Saved market lines and archived opening spreads share one ATS record.
 * Synthetic winner contracts remain in the bankroll and winner record only.
 */
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const sides=new Set(['home','away']);
const RECONSTRUCTED_ORIGIN='cfb-reconstructed-2026-09-26';

export function spreadOffer(record){
 const paper=record.origin===RECONSTRUCTED_ORIGIN?record.paperWager:null;
 if(paper&&['archived-opening-spread','synthetic-winner-even'].includes(paper.kind)&&sides.has(paper.side)&&finite(paper.homeSpread)&&
  (paper.kind!=='synthetic-winner-even'||paper.homeSpread===0&&paper.odds===100&&finite(record.predictedMargin)&&record.predictedMargin!==0&&paper.side===(record.predictedMargin>0?'home':'away'))){
  return {side:paper.side,homeSpread:paper.homeSpread,basis:paper.kind};
 }
 if(record.origin!==RECONSTRUCTED_ORIGIN&&sides.has(record.side)&&finite(record.marketHomeSpread))
  return {side:record.side,homeSpread:record.marketHomeSpread,basis:'saved-market'};
 return null;
}

export function gradeSpreadPick(record){
 const offer=spreadOffer(record);
 if(!offer)return {outcome:'no-line',basis:null};
 if(offer.basis==='synthetic-winner-even')return {outcome:'no-line',basis:offer.basis};
 if(record.result?.status==='void')return {outcome:'void',basis:offer.basis};
 if(record.result?.status!=='completed')return {outcome:'pending',basis:offer.basis};
 const result=record.result;
 const actualMargin=finite(result.actualMargin)?result.actualMargin:finite(result.homeScore)&&finite(result.awayScore)?result.homeScore-result.awayScore:null;
 if(actualMargin===null)return {outcome:'pending',basis:offer.basis,reason:'missing-final-margin'};
 const cover=(actualMargin+offer.homeSpread)*(offer.side==='home'?1:-1);
 return {outcome:Math.abs(cover)<1e-9?'push':cover>0?'win':'loss',basis:offer.basis};
}

/** Truth meter: a mixture of fixed-stake betting martingales against
 * "no better than break-even at the price taken". Each stake's log-wealth
 * adds across days, so period values can be summed and then mixed. */
export const TRUTH_STAKES=Object.freeze([0.01,0.02,0.05,0.1,0.2,0.3]);
export const ASSUMED_ODDS=-110;
const payout=odds=>odds>0?odds/100:100/-odds;
export const breakEven=odds=>1/(1+payout(odds));
export function truthMeter(logs){
 if(!Array.isArray(logs)||logs.length!==TRUTH_STAKES.length||!logs.every(finite))return null;
 return logs.reduce((sum,value)=>sum+Math.exp(value),0)/logs.length;
}
/** MLB picks moved from the +1.5 run line to the moneyline. The main MLB
 * record counts moneyline picks only; old run line picks are summarized apart. */
export const isLegacyRunLine=record=>record?.sport==='mlb'&&finite(spreadOffer(record)?.homeSpread)&&spreadOffer(record).homeSpread!==0;
export function summarizeSpreadPicks(records){
 if(records.some(isLegacyRunLine))return {...summarizePicks(records.filter(r=>!isLegacyRunLine(r))),legacyRunLine:summarizePicks(records.filter(isLegacyRunLine))};
 return summarizePicks(records);
}
function summarizePicks(records){
 const outcomes=records.map(gradeSpreadPick);
 const proof={units:0,risked:0,breakEvenSum:0,decided:0,truthLogs:TRUTH_STAKES.map(()=>0),clvSum:0,clvCount:0,assumedPrices:0};
 records.forEach((record,index)=>{
  const outcome=outcomes[index].outcome,offer=spreadOffer(record);
  if(offer&&offer.basis!=='synthetic-winner-even'&&finite(record.result?.closingHomeSpread)&&['win','loss','push'].includes(outcome)){
   // Points gained versus the close for the side taken: positive = the line moved our way.
   proof.clvSum+=(offer.side==='home'?1:-1)*(offer.homeSpread-record.result.closingHomeSpread);proof.clvCount++;
  }
  if(outcome!=='win'&&outcome!=='loss'&&outcome!=='push')return;
  const priced=finite(record.odds)&&Math.abs(record.odds)>=100,odds=priced?record.odds:ASSUMED_ODDS;
  if(!priced)proof.assumedPrices++;
  proof.risked++;
  if(outcome==='push')return;
  const p=breakEven(odds),won=outcome==='win';
  proof.units+=won?payout(odds):-1;proof.breakEvenSum+=p;proof.decided++;
  const x=(won?1/p:0)-1;
  proof.truthLogs=proof.truthLogs.map((log,i)=>log+Math.log(1+TRUTH_STAKES[i]*x));
 });
 const count=value=>outcomes.filter(row=>row.outcome===value).length;
 const wins=count('win'),losses=count('loss'),pushes=count('push');
 const synthetic=outcomes.filter(row=>row.basis==='synthetic-winner-even');
 return {recorded:records.length,offered:outcomes.filter(row=>row.basis&&row.basis!=='synthetic-winner-even').length,
  graded:wins+losses+pushes,wins,losses,pushes,winRate:wins+losses?wins/(wins+losses):null,
  pending:count('pending'),ungraded:outcomes.filter(row=>row.reason==='missing-final-margin').length,voids:count('void'),unlined:count('no-line'),unpriced:count('no-line'),
  syntheticGames:synthetic.length,syntheticFinals:records.filter((record,index)=>outcomes[index].basis==='synthetic-winner-even'&&record.result?.status==='completed').length,...proof};
}
