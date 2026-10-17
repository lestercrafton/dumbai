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

export function summarizeSpreadPicks(records){
 const outcomes=records.map(gradeSpreadPick);
 const count=value=>outcomes.filter(row=>row.outcome===value).length;
 const wins=count('win'),losses=count('loss'),pushes=count('push');
 const synthetic=outcomes.filter(row=>row.basis==='synthetic-winner-even');
 return {recorded:records.length,offered:outcomes.filter(row=>row.basis&&row.basis!=='synthetic-winner-even').length,
  graded:wins+losses+pushes,wins,losses,pushes,winRate:wins+losses?wins/(wins+losses):null,
  pending:count('pending'),ungraded:outcomes.filter(row=>row.reason==='missing-final-margin').length,voids:count('void'),unlined:count('no-line'),unpriced:count('no-line'),
  syntheticGames:synthetic.length,syntheticFinals:records.filter((record,index)=>outcomes[index].basis==='synthetic-winner-even'&&record.result?.status==='completed').length};
}
