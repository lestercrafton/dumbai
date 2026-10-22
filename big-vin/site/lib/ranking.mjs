import {winProbability} from './moneyline.mjs';
/** Rankings depend only on forecast inputs, never scores or outcomes. */
export function forecastEdge(f){
 const spread=f.paperWager?.kind==='archived-opening-spread'?f.paperWager.homeSpread:f.marketHomeSpread;
 return Number.isFinite(f.predictedMargin)&&Number.isFinite(spread)?Math.abs(f.predictedMargin+spread):null;
}
/** Model chance the selected side covers: normal model of the final margin
 * around our line, using each sport's frozen margin spread. */
export function coverProbability(f,edge=forecastEdge(f)){
 return Number.isFinite(edge)?winProbability(edge,f.sport):null;
}
export function hasUnratedPrior(f){
 const coverage=f.ratingCoverage??f.projection?.ratingCoverage;
 return coverage==='one-prior'||coverage==='both-prior';
}
/** The existing model flags fewer than five time-weighted games for either
 * team. This is a coverage rule, not a filter based on an outcome or edge. */
export function hasLimitedData(f){
 return hasUnratedPrior(f)||(f.sport==='cfb'&&f.projection?.sparseSample===true);
}
export function rankForecasts(records){
 const sorted=records.map(f=>{const edge=forecastEdge(f);return {...f,edge,coverProbability:coverProbability(f,edge)};}).sort((a,b)=>
  (hasLimitedData(a)?1:0)-(hasLimitedData(b)?1:0)||(b.coverProbability??-1)-(a.coverProbability??-1)||(b.edge??-1)-(a.edge??-1)||String(a.startTime).localeCompare(String(b.startTime))||a.id.localeCompare(b.id));
 let rank=0;
 return sorted.map(f=>({...f,lowEvidence:hasLimitedData(f),cardRank:f.edge!==null&&!hasLimitedData(f)?++rank:null,rankReason:hasLimitedData(f)?'Picks with limited data':f.edge!==null?null:f.paperWager?.kind==='synthetic-winner-even'?'Paper winner · no sportsbook spread':Number.isFinite(f.predictedMargin)?'No saved market line':'No saved model forecast'}));
}
