/** Walk-forward spread backtest for basketball versions against the market.
 * Daily refits use only games before each date. Lines: ESPN BET opening and
 * closing home spreads (data/spreads/history-<sport>.json). CLV is points the
 * line moved toward the side picked at the opener.
 * Usage: node scripts/basketball-backtest.mjs nba */
import fs from 'node:fs';
import {fitRatings,projectGame} from '../site/lib/ratings.mjs';
import {fatigueMap,withFatigue} from '../site/lib/basketball-fatigue.mjs';
const sport=process.argv[2]||'nba',key=sport==='cbb'?'ncaab':sport;
const games=JSON.parse(fs.readFileSync(`data/totals/history-${sport}.json`)).games.sort((a,b)=>a.startTime.localeCompare(b.startTime));
const lines=JSON.parse(fs.readFileSync(`data/spreads/history-${sport}.json`)).lines;
const versions=JSON.parse(process.env.VERSIONS||'null')||{
 'ridge-v1':null,
 'nba-v2':{lookbackDays:730,halfLifeDays:45,ratingPenalty:2,homePenalty:30,restPenalty:100,homePrior:2.5,useRest:false,useFatigue:true},
};
const fat=sport==='nba'?fatigueMap(games):null;const all=fat?games.map(g=>withFatigue(g,fat)):games;
const windows=JSON.parse(process.env.WINDOWS||'null')||{'select 2024-25':['2024-12-01','2025-10-01'],'holdout 2025-26':['2025-10-21','2026-10-01'],'live 2026-27':['2026-10-20','2027-01-01']};
const out={};
for(const [name,params] of Object.entries(versions)){
 const preds=[];let cache=new Map();
 for(const g of all){
  if(g.date<'2024-12-01')continue;const l=lines[g.id];if(!l||!Number.isFinite(l.open)||!Number.isFinite(l.close))continue;
  if(!cache.has(g.date))cache=new Map([[g.date,fitRatings(all,{sport:key,asOf:g.date,parameters:params||undefined})]]);
  const p=projectGame(g,cache.get(g.date)).predictedHomeMargin;if(!Number.isFinite(p))continue;
  preds.push({g,p,open:l.open,close:l.close,y:g.homeScore-g.awayScore});
 }
 for(const [w,[a,b]] of Object.entries(windows)){
  const r=preds.filter(x=>x.g.date>=a&&x.g.date<b);if(!r.length)continue;
  const mean=f=>r.reduce((s,x)=>s+f(x),0)/r.length;
  const tier=th=>{let w=0,l=0,clv=0,n=0;for(const x of r){const e=x.p+x.open;if(Math.abs(e)<=th||e===0)continue;const s=Math.sign(e);n++;clv+=s*(x.open-x.close);const c=(x.y+x.open)*s;if(c>0)w++;else if(c<0)l++;}return {picks:n,wins:w,losses:l,hitRate:+(w/Math.max(1,w+l)).toFixed(3),clv:+(clv/Math.max(1,n)).toFixed(3)};};
  let cw=0,cl=0;for(const x of r){const e=x.p+x.close,c=x.y+x.close;if(!e||!c)continue;if(e*c>0)cw++;else cl++;}
  out[`${name} · ${w}`]={games:r.length,modelMae:+mean(x=>Math.abs(x.y-x.p)).toFixed(3),openMae:+mean(x=>Math.abs(x.y+x.open)).toFixed(3),closeMae:+mean(x=>Math.abs(x.y+x.close)).toFixed(3),sigma:+Math.sqrt(mean(x=>(x.y-x.p)**2)).toFixed(2),vsOpen:{all:tier(0),edge2:tier(2),edge3:tier(3),edge5:tier(5)},vsClose:{wins:cw,losses:cl,hitRate:+(cw/Math.max(1,cw+cl)).toFixed(3)}};
 }
}
console.log(JSON.stringify(out,null,1));
