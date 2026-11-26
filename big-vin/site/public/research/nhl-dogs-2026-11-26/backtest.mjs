import fs from 'node:fs';
const rows=JSON.parse(fs.readFileSync('rows.json'));
const recs=JSON.parse(fs.readFileSync('/workspace/bv-clv-data/records-nhl.json'));
const pb='/workspace/bv-nhl-dog/odds/';
const snaps={};for(const f of fs.readdirSync(pb))for(const l of fs.readFileSync(pb+f,'utf8').split('\n')){if(!l.trim())continue;const o=JSON.parse(l);if(o.type!=='odds')continue;(snaps[o.gameId]??=[]).push(o);}
const fin=x=>typeof x==='number'&&Number.isFinite(x);
const pay=o=>o>0?o/100:100/-o, be=o=>1/(1+pay(o));
const erf=x=>{const t=1/(1+0.3275911*Math.abs(x));const y=1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-0.284496736)*t+0.254829592)*t*Math.exp(-x*x);return x<0?-y:y;};
const Phi=z=>0.5*(1+erf(z/Math.SQRT2));const S=2.6;
const ev=(p,o)=>p*pay(o)-(1-p);
const g=rows.filter(r=>r.win!==null&&fin(r.oppPrice)&&fin(r.price)&&Math.abs(r.taken)===1.5);
const recById=Object.fromEntries(recs.map(r=>[r.id,r]));
const out={window:[g.map(r=>r.start).sort()[0],g.map(r=>r.start).sort().at(-1)],n:g.length};
function evalSel(name,list){ // list of {p? ,win,price}
 const n=list.length,w=list.reduce((s,x)=>s+x.win,0),pl=list.reduce((s,x)=>s+(x.win?pay(x.price):-1),0);
 const be_=n?list.reduce((s,x)=>s+be(x.price),0)/n:0;
 const se=n?Math.sqrt(list.reduce((s,x)=>s+(x.win?pay(x.price):-1)**2,0)/n-(pl/n)**2)/Math.sqrt(n):0;
 const dogs=list.filter(x=>x.dog).length;
 return {name,n,w,l:n-w,winPct:n?+(w/n).toFixed(3):null,avgBE:+be_.toFixed(3),flatROI:n?+(pl/n).toFixed(3):null,roiSE:+se.toFixed(3),dogShare:n?+(dogs/n).toFixed(3):null};
}
const res=[];
// current
res.push(evalSel('Current: margin vs puck line (price-blind)',g.map(r=>({win:r.win,price:r.price,dog:r.dog}))));
// per game: home perspective
const games=g.map(r=>{const hs=r.hs,homePrice=r.side==='home'?r.price:r.oppPrice,awayPrice=r.side==='home'?r.oppPrice:r.price;
 const homeWin=r.side==='home'?r.win:1-r.win; // home covered
 const pModel=Phi((r.homeMargin+hs)/S); const a=be(homePrice),b=be(awayPrice),pMkt=a/(a+b);
 return {r,hs,homePrice,awayPrice,homeCover:homeWin,pModel,pMkt};});
const pick=(G,pf,thr)=>G.map(x=>{const p=pf(x);const eh=ev(p,x.homePrice),ea=ev(1-p,x.awayPrice);const home=eh>=ea;const e=home?eh:ea;if(e<thr)return null;
 return {win:home?x.homeCover:1-x.homeCover,price:home?x.homePrice:x.awayPrice,dog:home?x.hs>0:x.hs<0,ev:e};}).filter(Boolean);
for(const [lab,pf] of [['model normal σ2.6',x=>x.pModel],['50/50 model+market',x=>(x.pModel+x.pMkt)/2],['25 model/75 market',x=>0.25*x.pModel+0.75*x.pMkt]])
 for(const thr of [-1,0,0.03,0.05])res.push(evalSel(`Puck line, side by EV, ${lab}, EV ≥ ${thr<0?'any':thr}`,pick(games,pf,thr)));
// Brier
const brier=(f)=>games.reduce((s,x)=>s+(f(x)-x.homeCover)**2,0)/games.length;
out.puckLineBrier={model:+brier(x=>x.pModel).toFixed(4),market:+brier(x=>x.pMkt).toFixed(4),blend:+brier(x=>(x.pModel+x.pMkt)/2).toFixed(4)};
// moneyline: last snapshot before pick lock (or start) with moneylines
const ml=[];for(const r of g){const rec=recById[r.id];const lock=Date.parse(rec?.result?.pickRecordedAt||rec?.marketObservedAt||r.start);const ss=(snaps[rec.gameId]||[]).filter(s=>fin(s.market?.homeMoneyline)&&fin(s.market?.awayMoneyline)&&Date.parse(s.at)<=Math.max(lock,Date.parse(r.start)-60000)&&Date.parse(s.at)<Date.parse(r.start)).sort((a,b)=>a.at.localeCompare(b.at));const s=ss.at(-1);if(!s)continue;
 const hm=s.market.homeMoneyline,am=s.market.awayMoneyline,a=be(hm),b=be(am);const homeWon=r.actual>0?1:0;
 ml.push({hm,am,pMkt:a/(a+b),pModel:Phi(r.homeMargin/S),homeWon,start:r.start});}
out.moneylineGames={n:ml.length,from:ml.map(x=>x.start).sort()[0],to:ml.map(x=>x.start).sort().at(-1)};
const mlPick=(pf,thr)=>ml.map(x=>{const p=pf(x);const eh=ev(p,x.hm),ea=ev(1-p,x.am);const home=eh>=ea;const e=home?eh:ea;if(e<thr)return null;const price=home?x.hm:x.am;return {win:home?x.homeWon:1-x.homeWon,price,dog:price>0};}).filter(Boolean);
for(const [lab,pf] of [['model normal σ2.6',x=>x.pModel],['50/50 model+market',x=>(x.pModel+x.pMkt)/2]])for(const thr of [-1,0,0.03,0.05])res.push(evalSel(`Moneyline, side by EV, ${lab}, EV ≥ ${thr<0?'any':thr}`,mlPick(pf,thr)));
res.push(evalSel('Moneyline: model straight-up winner, any price',ml.map(x=>{const home=x.pModel>=0.5;return {win:home?x.homeWon:1-x.homeWon,price:home?x.hm:x.am,dog:(home?x.hm:x.am)>0};})));
res.push(evalSel('Moneyline: market favorite every game',ml.map(x=>{const home=x.pMkt>=0.5;return {win:home?x.homeWon:1-x.homeWon,price:home?x.hm:x.am,dog:false};})));
const mb=f=>ml.reduce((s,x)=>s+(f(x)-x.homeWon)**2,0)/ml.length;
out.moneylineBrier={model:+mb(x=>x.pModel).toFixed(4),market:+mb(x=>x.pMkt).toFixed(4),blend:+mb(x=>(x.pModel+x.pMkt)/2).toFixed(4)};
out.mlModelVsMarket={avgAbsDiff:+(ml.reduce((s,x)=>s+Math.abs(x.pModel-x.pMkt),0)/ml.length).toFixed(3),
 favShading:+(ml.reduce((s,x)=>{const f=x.pMkt>=.5;return s+((f?x.pModel:1-x.pModel)-(f?x.pMkt:1-x.pMkt));},0)/ml.length).toFixed(3),
 mktFavActualWin:+(ml.reduce((s,x)=>s+((x.pMkt>=.5)===(x.homeWon===1)?1:0),0)/ml.length).toFixed(3),
 mktFavAvgVigFree:+(ml.reduce((s,x)=>s+Math.max(x.pMkt,1-x.pMkt),0)/ml.length).toFixed(3),
 modelFavAvg:+(ml.reduce((s,x)=>s+(x.pMkt>=.5?x.pModel:1-x.pModel),0)/ml.length).toFixed(3)};
out.results=res;
fs.writeFileSync('backtest.json',JSON.stringify(out,null,1));
console.log(JSON.stringify({...out,results:undefined},null,1));console.table(res);
