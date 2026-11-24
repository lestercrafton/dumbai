// Candidate fixes for NBA's learned win chance, walk-forward on the same picks.
// Each variant re-learns the bucket win chance before every kickoff (finals recorded
// before kickoff only) and is scored on the Nov 4 – Nov 23 window.
import fs from 'node:fs';
import {bucketOf} from '../../../lib/rank-signal.mjs';
import {kellyStake} from '../../../lib/kelly-bankroll.mjs';
import {breakEven,ASSUMED_ODDS} from '../../../lib/spread-record.mjs';
const rows=JSON.parse(fs.readFileSync(new URL('./rows.json',import.meta.url)));
const recs=new Map(JSON.parse(fs.readFileSync((process.env.DATA||'/workspace/bv-clv-data')+'/records-nba.json')).map(r=>[r.id,r]));
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
function corr(x,y){const mx=mean(x),my=mean(y);let a=0,b=0,c=0;for(let i=0;i<x.length;i++){a+=(x[i]-mx)*(y[i]-my);b+=(x[i]-mx)**2;c+=(y[i]-my)**2;}return b&&c?a/Math.sqrt(b*c):0;}
const BE=breakEven(ASSUMED_ODDS),LAG=36*3600e3;
const gradedAt=x=>{const g=Date.parse(recs.get(x.id)?.result?.observedAt??'');return Number.isFinite(g)?g:x.t+LAG;};
function learn(before,{k=100,sameVersion=null,buckets=true,prior=BE}){
 const src=rows.filter(x=>x.win!==null&&x.t<before&&gradedAt(x)<before&&(!sameVersion||x.version===sameVersion));
 const shrink=(s,n,p)=>(s+k*p)/(n+k);
 const rate=shrink(src.reduce((s,x)=>s+x.win,0),src.length,prior);
 if(!buckets)return ()=>rate;
 const b={};for(const x of src){const e=b[x.bucket]??={n:0,w:0};e.n++;e.w+=x.win;}
 return bucket=>b[bucket]?shrink(b[bucket].w,b[bucket].n,rate):rate;
}
const V={
 'live (all versions, k=100, buckets)':{},
 'same model version only':{same:true},
 'stronger prior k=300':{k:300},
 'same version + k=300':{same:true,k:300},
 'no buckets (sport rate only)':{buckets:false},
 // Prior = NBA v2's 2025-26 holdout cover rate vs the opener (655-667, 49.5%), big-vin/data/research/nba-backtest-2026-11-01.json
 'same version + k=300 + backtest prior 49.5%':{same:true,k:300,prior:0.495},
};
const W=rows.filter(x=>x.day>='2026-11-04'&&x.win!==null);
const rec=s=>`${s.filter(x=>x.win).length}-${s.filter(x=>!x.win).length}`;
const out={};
for(const [name,o] of Object.entries(V)){
 const ps=W.map(x=>learn(x.t,{k:o.k??100,sameVersion:o.same?x.version:null,buckets:o.buckets!==false,prior:o.prior??BE})(x.bucket));
 const kp=W.filter((x,i)=>kellyStake(ps[i],x.odds)>0);
 // top 3 per day by Kelly, ties by bigger edge (as the board does)
 const top=[];for(const d of [...new Set(W.map(x=>x.day))]){const ix=W.map((x,i)=>i).filter(i=>W[i].day===d).sort((a,b)=>kellyStake(ps[b],W[b].odds)-kellyStake(ps[a],W[a].odds)||(W[b].edge??-1)-(W[a].edge??-1)||W[a].t-W[b].t).slice(0,3);top.push(...ix.map(i=>W[i]));}
 const flat=s=>s.length?+(s.reduce((a,x)=>a+(x.win?(x.odds>0?x.odds/100:100/-x.odds):-1),0)/s.length).toFixed(3):null;
 out[name]={corrWithWin:+corr(ps,W.map(x=>x.win)).toFixed(3),estimateRange:[Math.min(...ps),Math.max(...ps)].map(v=>+v.toFixed(3)),
  kellyPositive:{record:rec(kp),flatPer1:flat(kp)},top3PerDay:{record:rec(top),flatPer1:flat(top)}};
}
fs.writeFileSync(new URL('./fixes.json',import.meta.url),JSON.stringify(out,null,1));console.log(JSON.stringify(out,null,1));
