/** Board ranking signal learned from graded history, not from gap size alone.
 * Win chance: graded spread picks for this sport, split into honest buckets
 * (favorite or underdog × small/medium/large gap), each pulled toward the
 * sport rate, which is itself pulled toward break-even at −110. With little
 * data every bucket sits near break-even, so the gap cannot drive the order
 * unless the record supports it. Once a sport has CLV_SWITCH graded picks with
 * a saved closing line, it ranks by expected line movement instead. */
import {gradeSpreadPick,spreadOffer,breakEven,ASSUMED_ODDS} from './spread-record.mjs';
export const CLV_SWITCH=100;
export const PRIOR_PICKS=100;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const BE=breakEven(ASSUMED_ODDS);
const CUTS={nhl:[0.3,0.7],mlb:[0.4,1]};
export function bucketOf({side,homeSpread,edge,sport}){
 const [low,high]=CUTS[sport]??[2,5];
 const taken=side==='home'?homeSpread:-homeSpread;
 const role=taken>0?'underdog':'favorite';
 const size=!finite(edge)?'small':edge<low?'small':edge<high?'medium':'large';
 return role+':'+size;
}
const shrink=(sum,n,prior,k=PRIOR_PICKS)=>(sum+k*prior)/(n+k);
export function learnRankSignal(records,{before=Date.now()}={}){
 const seen=new Set(),rows=[];
 for(const f of records){
  if(f.cohort!=='live'||Date.parse(f.startTime)>=before)continue;
  const offer=spreadOffer(f);if(!offer||offer.basis==='synthetic-winner-even'||!finite(f.predictedMargin))continue;
  const key=f.gameId+':'+(f.modelVersion||'');if(seen.has(key))continue;
  const outcome=gradeSpreadPick(f).outcome;if(outcome!=='win'&&outcome!=='loss')continue;seen.add(key);
  const edge=Math.abs(f.predictedMargin+offer.homeSpread);
  const clv=finite(f.result?.closingHomeSpread)?(offer.side==='home'?1:-1)*(offer.homeSpread-f.result.closingHomeSpread):null;
  rows.push({bucket:bucketOf({side:offer.side,homeSpread:offer.homeSpread,edge,sport:f.sport}),win:outcome==='win'?1:0,clv});
 }
 const wins=rows.reduce((s,r)=>s+r.win,0),sportRate=shrink(wins,rows.length,BE);
 const clvRows=rows.filter(r=>r.clv!==null),clvMean=shrink(clvRows.reduce((s,r)=>s+r.clv,0),clvRows.length,0);
 const buckets={};
 for(const r of rows){const b=buckets[r.bucket]??={n:0,wins:0,clvN:0,clvSum:0};b.n++;b.wins+=r.win;if(r.clv!==null){b.clvN++;b.clvSum+=r.clv;}}
 for(const b of Object.values(buckets)){b.winChance=shrink(b.wins,b.n,sportRate);b.expectedClv=shrink(b.clvSum,b.clvN,clvMean);}
 return {basis:clvRows.length>=CLV_SWITCH?'clv':'win',graded:rows.length,closingLines:clvRows.length,sportRate,clvMean,buckets};
}
/** Score one board game; higher ranks first. */
export function scoreGame(signal,{side,homeSpread,edge,odds,sport}){
 if(!signal||!side||!finite(homeSpread))return null;
 const b=signal.buckets[bucketOf({side,homeSpread,edge,sport})];
 const winChance=b?.winChance??signal.sportRate,expectedClv=b?.expectedClv??signal.clvMean;
 return {basis:signal.basis,value:signal.basis==='clv'?expectedClv:winChance,winChance,expectedClv,breakEven:breakEven(finite(odds)&&Math.abs(odds)>=100?odds:ASSUMED_ODDS)};
}
/** Higher signal first; ties go to the cheaper price, then the earlier kickoff. */
export function compareSignal(a,b){
 const av=a.rankSignal?.value??-Infinity,bv=b.rankSignal?.value??-Infinity;
 if(av===-Infinity&&bv===-Infinity)return (b.edge??-1)-(a.edge??-1)||String(a.startTime).localeCompare(String(b.startTime))||String(a.id).localeCompare(String(b.id));
 if(Math.abs(av-bv)>1e-9)return bv-av;
 return (a.rankSignal?.breakEven??1)-(b.rankSignal?.breakEven??1)||String(a.startTime).localeCompare(String(b.startTime))||String(a.id).localeCompare(String(b.id));
}
/** Tiny card label and its hover text. */
export function rankLabel(signal){
 if(!signal)return null;
 const clv=signal.basis==='clv',value=clv?`${signal.value>=0?'+':''}${signal.value.toFixed(1)} pts`:`${Math.round(signal.value*100)}%`;
 return {short:value,title:clv?`Ranked by expected line movement: ${value}`:`Ranked by chance to win: ${value}`};
}
