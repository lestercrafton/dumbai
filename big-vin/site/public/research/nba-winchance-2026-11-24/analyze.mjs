// Why did NBA's learned win chance run backwards (Nov 2026)? Read-only analysis.
// Uses the same tracked records and frozen signal as the live bankroll replay.
import fs from 'node:fs';
import {gradeSpreadPick,spreadOffer,breakEven,ASSUMED_ODDS} from '../../../lib/spread-record.mjs';
import {learnRankSignal,scoreGame,bucketOf} from '../../../lib/rank-signal.mjs';
import {kellyStake} from '../../../lib/kelly-bankroll.mjs';
import {ctDate} from '../../../lib/today-plays.mjs';
const DATA=process.env.DATA||'/workspace/bv-clv-data';
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
function corr(x,y){const mx=mean(x),my=mean(y);let a=0,b=0,c=0;for(let i=0;i<x.length;i++){a+=(x[i]-mx)*(y[i]-my);b+=(x[i]-mx)**2;c+=(y[i]-my)**2;}return b&&c?a/Math.sqrt(b*c):0;}
let seed=7;const rnd=()=>(seed=(seed*1103515245+12345)%2147483648)/2147483648;
const records=JSON.parse(fs.readFileSync(`${DATA}/records-nba.json`));
const graded=records.map(r=>({r,offer:spreadOffer(r),outcome:gradeSpreadPick(r).outcome}))
 .filter(x=>x.offer&&x.offer.basis!=='synthetic-winner-even'&&['win','loss','push'].includes(x.outcome)&&Number.isFinite(Date.parse(x.r.startTime)))
 .sort((a,b)=>Date.parse(a.r.startTime)-Date.parse(b.r.startTime)||String(a.r.id).localeCompare(String(b.r.id)));
const learnFrom=graded.map(x=>({...x.r,cohort:'live'}));
const variants={
 live:{filter:()=>true,opts:{}},
};
// Optional learner variants for the fix backtest.
export function learnVariant(list,t,{versionOnly=null,priorPicks=null}={}){
 const src=versionOnly?list.filter(r=>(r.modelVersion||'')===versionOnly):list;
 return learnRankSignal(src,{before:t,frozen:true});
}
const rows=graded.map(({r,offer,outcome})=>{
 const t=Date.parse(r.startTime),odds=finite(r.odds)&&Math.abs(r.odds)>=100?r.odds:ASSUMED_ODDS;
 const edge=finite(r.predictedMargin)?Math.abs(r.predictedMargin+offer.homeSpread):null;
 const q={side:offer.side,homeSpread:offer.homeSpread,edge,odds,sport:'nba'};
 const s=learnRankSignal(learnFrom,{before:t,frozen:true}),sc=scoreGame(s,q);
 const sv=learnVariant(learnFrom,t,{versionOnly:r.modelVersion});const scv=scoreGame(sv,q);
 // Model's own sign check: does the side agree with the predicted margin vs the line?
 const modelSide=finite(r.predictedMargin)?(r.predictedMargin+offer.homeSpread>0?'home':'away'):null;
 const taken=offer.side==='home'?offer.homeSpread:-offer.homeSpread;
 return {id:r.id,day:ctDate(r.startTime),t,version:r.modelVersion,outcome,win:outcome==='win'?1:outcome==='loss'?0:null,
  odds,be:breakEven(odds),edge,bucket:sc.bucket,p:sc.winChance,bucketN:sc.bucketGraded,signalN:s.graded,sportRate:s.sportRate,
  pVer:scv?.winChance,bucketNVer:scv?.bucketGraded,kelly:kellyStake(sc.winChance,odds),
  sideMatchesModel:modelSide===offer.side,pickRevSide:r.pickRevision?.side??null,recSide:r.side,offerSide:offer.side,taken,
  predictedMargin:r.predictedMargin,homeSpread:offer.homeSpread,margin:r.result?.actualMargin};
});
const W=rows.filter(x=>x.day>='2026-11-04'&&x.win!==null);
const out={};
// 1. Significance: permutation (shuffle wins) and day-block bootstrap.
const r0=corr(W.map(x=>x.p),W.map(x=>x.win));let ge=0;const N=10000;
for(let i=0;i<N;i++){const w=W.map(x=>x.win);for(let j=w.length-1;j>0;j--){const k=Math.floor(rnd()*(j+1));[w[j],w[k]]=[w[k],w[j]];}if(Math.abs(corr(W.map(x=>x.p),w))>=Math.abs(r0))ge++;}
const days=[...new Set(W.map(x=>x.day))],byDay=new Map(days.map(d=>[d,W.filter(x=>x.day===d)]));const boots=[];
for(let i=0;i<4000;i++){const s=[];for(let j=0;j<days.length;j++)s.push(...byDay.get(days[Math.floor(rnd()*days.length)]));boots.push(corr(s.map(x=>x.p),s.map(x=>x.win)));}
boots.sort((a,b)=>a-b);
out.significance={n:W.length,days:days.length,corr:+r0.toFixed(3),permutationP2sided:+(ge/N).toFixed(4),dayBootstrap95:[+boots[100].toFixed(3),+boots[3899].toFixed(3)],
 distinctP:new Set(W.map(x=>x.p.toFixed(4))).size,pRange:[Math.min(...W.map(x=>x.p)),Math.max(...W.map(x=>x.p))].map(v=>+v.toFixed(3))};
// By week.
const wk=d=>{const t=new Date(d+'T12:00:00Z');t.setUTCDate(t.getUTCDate()-((t.getUTCDay()+6)%7));return t.toISOString().slice(0,10);};
out.byWeek=[...new Set(W.map(x=>wk(x.day)))].map(w=>{const s=W.filter(x=>wk(x.day)===w);const hi=s.filter(x=>x.kelly>0);return {week:w,n:s.length,corr:+corr(s.map(x=>x.p),s.map(x=>x.win)).toFixed(3),win:+mean(s.map(x=>x.win)).toFixed(3),kellyPos:`${hi.filter(x=>x.win).length}-${hi.filter(x=>!x.win).length}`};});
// Bucket view: estimate, how many graded picks behind it, and what happened next.
const B={};for(const x of W){const b=B[x.bucket]??={n:0,w:0,pSum:0,nAtEst:[]};b.n++;b.w+=x.win;b.pSum+=x.p;b.nAtEst.push(x.bucketN);}
out.buckets=Object.fromEntries(Object.entries(B).map(([k,b])=>[k,{picks:b.n,record:`${b.w}-${b.n-b.w}`,winRate:+(b.w/b.n).toFixed(3),avgEstimate:+(b.pSum/b.n).toFixed(3),bucketPicksAtEstimate:[Math.min(...b.nAtEst),Math.max(...b.nAtEst)]}]));
// What the buckets had learned from before the window (and from which model version).
const pre=rows.filter(x=>x.day<'2026-11-04'&&x.win!==null);const P={};for(const x of pre){const b=P[x.bucket+' '+x.version]??={n:0,w:0};b.n++;b.w+=x.win;}
out.beforeWindowByBucketVersion=Object.fromEntries(Object.entries(P).sort().map(([k,b])=>[k,`${b.w}-${b.n-b.w} (${(b.w/b.n).toFixed(3)})`]));
// Sign/side sanity.
out.sideChecks={picksInWindow:W.length,sideMatchesModelSign:W.filter(x=>x.sideMatchesModel).length,pickRevisionSideDiffersFromOffer:W.filter(x=>x.pickRevSide&&x.pickRevSide!==x.offerSide).length,
 versionsInWindow:Object.fromEntries([...new Set(W.map(x=>x.version))].map(v=>[v,W.filter(x=>x.version===v).length]))};
// 3. Raw model edge vs covering in the window.
const tier=(lo,hi)=>{const s=W.filter(x=>x.edge>=lo&&x.edge<hi);return {n:s.length,record:`${s.filter(x=>x.win).length}-${s.filter(x=>!x.win).length}`,winRate:s.length?+mean(s.map(x=>x.win)).toFixed(3):null};};
out.rawEdge={corrEdgeWin:+corr(W.map(x=>x.edge),W.map(x=>x.win)).toFixed(3),'0-2':tier(0,2),'2-5':tier(2,5),'5+':tier(5,99),
 favorites:(s=>`${s.filter(x=>x.win).length}-${s.filter(x=>!x.win).length}`)(W.filter(x=>x.taken<0)),underdogs:(s=>`${s.filter(x=>x.win).length}-${s.filter(x=>!x.win).length}`)(W.filter(x=>x.taken>0))};
// Same-version learner (v2 picks learn only from v2 results).
out.sameVersionLearner={corr:+corr(W.map(x=>x.pVer),W.map(x=>x.win)).toFixed(3)};
fs.writeFileSync(new URL('./rows.json',import.meta.url),JSON.stringify(rows));
fs.writeFileSync(new URL('./analysis.json',import.meta.url),JSON.stringify(out,null,1));
console.log(JSON.stringify(out,null,1));
