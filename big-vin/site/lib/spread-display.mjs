import {gradeSpreadPick} from './spread-record.mjs';
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const name=team=>typeof team==='string'?team:team?.abbreviation||team?.name||'Team';
export const handicap=value=>!finite(value)?'—':Math.abs(value)<0.05?'PK':`${value>0?'+':'−'}${Math.abs(value).toFixed(1)}`;

/** One set of sign conventions for the board and saved scorecard. A model's
 * projected winner can differ from its ATS selection. Synthetic winner-only
 * contracts never produce an ATS result. */
export function spreadDecision(record){
 const home=name(record.home),away=name(record.away);
 const margin=record.predictedMargin??record.projection?.predictedHomeMargin;
 const paper=record.paperWager;
 const synthetic=paper?.kind==='synthetic-winner-even';
 const spread=synthetic?null:paper?.kind==='archived-opening-spread'?paper.homeSpread:record.marketHomeSpread??record.market?.homeSpread;
 const edge=finite(margin)&&finite(spread)?margin+spread:null;
 const side=synthetic?null:record.side??(edge===null||Math.abs(edge)<1e-9?null:edge>0?'home':'away');
 const modelTeam=finite(margin)&&Math.abs(margin)>=0.05?(margin>0?home:away):null;
 const modelLine=finite(margin)?modelTeam?`${modelTeam} ${handicap(-Math.abs(margin))}`:'Pick’em':null;
 const pick=finite(spread)&&side?`${side==='home'?home:away} ${handicap(side==='home'?spread:-spread)}`:null;
 const result=record.result;
 const grade=gradeSpreadPick({...record,origin:record.origin??record.forecastOrigin,predictedMargin:margin,marketHomeSpread:spread,side});
 const outcome=!finite(spread)?'no-line':!pick?'no-pick':grade.outcome;
 const label=({'win':'Win','loss':'Learn','push':'Push','void':'Void','pending':'Pending','no-line':'No spread','no-pick':'No pick'})[outcome];
 const score=result?.status==='completed'&&finite(result.awayScore)&&finite(result.homeScore)?`${result.awayScore}–${result.homeScore}`:null;
 return {home,away,side,edge,market:finite(spread)?[`${away} ${handicap(-spread)}`,`${home} ${handicap(spread)}`]:[],modelLine,
  modelWinner:modelTeam?`${modelTeam} by ${Math.abs(margin).toFixed(1)}`:finite(margin)?'No winner call':null,
  pick,difference:edge===null?null:Math.abs(edge),outcome,label,score,color:outcome==='win'?'green':outcome==='loss'?'red':'muted'};
}
