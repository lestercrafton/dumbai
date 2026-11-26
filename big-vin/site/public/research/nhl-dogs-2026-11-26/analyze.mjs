import fs from 'node:fs';
const recs=JSON.parse(fs.readFileSync('/workspace/bv-clv-data/records-nhl.json'));
const bank=JSON.parse(fs.readFileSync('/workspace/bv-clv-data/bankroll-nhl.json')).sports[0];
const fin=x=>typeof x==='number'&&Number.isFinite(x);
const pay=o=>o>0?o/100:100/-o, be=o=>1/(1+pay(o));
const erf=x=>{const t=1/(1+0.3275911*Math.abs(x));const y=1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-0.284496736)*t+0.254829592)*t*Math.exp(-x*x);return x<0?-y:y;};
const Phi=z=>0.5*(1+erf(z/Math.SQRT2));
const out={};
const rows=[];
const seen=new Set();
for(const r of recs){
 if(r.cohort!=='live'||!fin(r.marketHomeSpread)||!['home','away'].includes(r.side))continue;
 const k=r.gameId+':'+r.modelVersion; if(seen.has(k))continue; seen.add(k);
 const hs=r.marketHomeSpread, taken=r.side==='home'?hs:-hs, dog=taken>0;
 const hp=r.marketHomePrice, ap=r.marketAwayPrice;
 const pickPrice=r.odds, oppPrice=r.side==='home'?ap:hp;
 let mktP=null; if(fin(hp)&&fin(ap)){const a=be(pickPrice),b=be(oppPrice);mktP=a/(a+b);}
 const mPick=r.side==='home'?r.predictedMargin:-r.predictedMargin; // model margin for picked team
 const mFav=Math.abs(r.predictedMargin);
 // model P(pick covers) using live sigma 2.6 normal (continuity: line ±1.5 is half-goal so no correction)
 const pCoverNormal=Phi((mPick+taken)/2.6);
 const res=r.result; const done=res?.status==='completed'&&fin(res.actualMargin);
 let win=null; if(done){const c=(res.actualMargin+hs)*(r.side==='home'?1:-1);win=c>0?1:0;}
 rows.push({id:r.id,start:r.startTime,week:r.weekKey,ver:r.modelVersion,hs,taken,dog,side:r.side,price:pickPrice,oppPrice,mktP,pred:r.predictedMargin,mPick,mFav,edge:Math.abs(r.predictedMargin+hs),pCoverNormal,win,actual:done?res.actualMargin:null,pnl:done?(win?pay(pickPrice):-1):null,
   // model favorite on ML: does model predicted-winner = market favorite (the -1.5 side)?
   modelFavIsMktFav: Math.sign(r.predictedMargin)===Math.sign(-hs), homeMargin:r.predictedMargin});
}
fs.writeFileSync('rows.json',JSON.stringify(rows,null,0));
const g=rows.filter(r=>r.win!==null);
const sum=(a,f)=>a.reduce((s,x)=>s+f(x),0);
const summ=a=>({n:a.length,w:sum(a,r=>r.win),l:a.length-sum(a,r=>r.win),winPct:+(sum(a,r=>r.win)/a.length).toFixed(3),avgBE:+(sum(a,r=>be(r.price))/a.length).toFixed(3),avgMktVigFree:+(sum(a.filter(r=>r.mktP!=null),r=>r.mktP)/a.filter(r=>r.mktP!=null).length).toFixed(3),flatROI:+(sum(a,r=>r.pnl)/a.length).toFixed(3),avgPrice:Math.round(sum(a,r=>r.price)/a.length),avgModelPcover:+(sum(a,r=>r.pCoverNormal)/a.length).toFixed(3)});
out.allPicks={n:rows.length,dog:rows.filter(r=>r.dog).length,lines:Object.entries(rows.reduce((m,r)=>(m[r.taken]=(m[r.taken]||0)+1,m),{}))};
out.graded={all:summ(g),dog:summ(g.filter(r=>r.dog)),fav:summ(g.filter(r=>!r.dog))};
// by week
out.byWeek={};for(const w of [...new Set(rows.map(r=>r.week))].sort()){const a=rows.filter(r=>r.week===w),gg=a.filter(r=>r.win!==null);out.byWeek[w]={picks:a.length,dogShare:+(a.filter(r=>r.dog).length/a.length).toFixed(3),graded:gg.length,w:sum(gg,r=>r.win),roi:gg.length?+(sum(gg,r=>r.pnl)/gg.length).toFixed(3):null};}
// predicted margin distribution
const q=(a,p)=>{const s=[...a].sort((x,y)=>x-y);return +s[Math.min(s.length-1,Math.floor(p*s.length))].toFixed(2)};
const mf=rows.map(r=>r.mFav);out.absPredMargin={p10:q(mf,.1),p50:q(mf,.5),p90:q(mf,.9),max:q(mf,1),shareAbove1_5:+(mf.filter(x=>x>1.5).length/mf.length).toFixed(3)};
// fav picks: when?
out.favPicks=rows.filter(r=>!r.dog).map(r=>({start:r.start.slice(0,10),taken:r.taken,pred:+r.mPick.toFixed(2),price:r.price,win:r.win}));
// model vs actual margins: regression slope of actual on predicted
const gm=g.filter(r=>fin(r.actual));const mx=sum(gm,r=>r.homeMargin)/gm.length,my=sum(gm,r=>r.actual)/gm.length;
const slope=sum(gm,r=>(r.homeMargin-mx)*(r.actual-my))/sum(gm,r=>(r.homeMargin-mx)**2);
const rmse=Math.sqrt(sum(gm,r=>(r.actual-r.homeMargin)**2)/gm.length);
const sdAct=Math.sqrt(sum(gm,r=>(r.actual-my)**2)/gm.length);
const corr=sum(gm,r=>(r.homeMargin-mx)*(r.actual-my))/Math.sqrt(sum(gm,r=>(r.homeMargin-mx)**2)*sum(gm,r=>(r.actual-my)**2));
out.marginFit={n:gm.length,meanPredHome:+mx.toFixed(3),meanActualHome:+my.toFixed(3),slopeActualOnPred:+slope.toFixed(2),corr:+corr.toFixed(3),rmse:+rmse.toFixed(2),sdActual:+sdAct.toFixed(2)};
// actual distribution of market-favorite margin (from -1.5 side perspective)
const favM=gm.map(r=>r.actual*(r.hs<0?1:-1));
const dist={};for(const m of favM){const k=m>=3?'>=3':m<=-3?'<=-3':String(m);dist[k]=(dist[k]||0)+1;}
out.mktFavMarginDist=dist; out.mktFavCoverRate=+(favM.filter(m=>m>=2).length/favM.length).toFixed(3);
// calibration: model normal P(cover) and market vig-free P vs actual, for dog picks
const bins=(a,f,edges)=>edges.slice(0,-1).map((lo,i)=>{const hi=edges[i+1];const s=a.filter(r=>f(r)>=lo&&f(r)<hi);return {bin:`${lo}-${hi}`,n:s.length,pred:s.length?+(sum(s,f)/s.length).toFixed(3):null,actual:s.length?+(sum(s,r=>r.win)/s.length).toFixed(3):null,roi:s.length?+(sum(s,r=>r.pnl)/s.length).toFixed(3):null};});
const dg=g.filter(r=>r.dog&&r.mktP!=null);
out.calibDogs_marketVigFree=bins(dg,r=>r.mktP,[0.5,0.6,0.65,0.7,0.75,0.9]);
out.calibDogs_modelNormal=bins(dg,r=>r.pCoverNormal,[0.5,0.6,0.65,0.7,0.75,0.9]);
out.dogModelMinusMarket=+(sum(dg,r=>r.pCoverNormal-r.mktP)/dg.length).toFixed(3);
// by edge (bucket cuts .3/.7) for dogs
out.dogByEdge=bins(g.filter(r=>r.dog),r=>r.edge,[0,0.3,0.7,1,1.25,2]).map(b=>({...b}));
// by dog price
out.dogByPrice=[[-1000,-220],[-220,-180],[-180,-150],[-150,-100],[100,1000]].map(([lo,hi])=>{const s=g.filter(r=>r.dog&&r.price>=lo&&r.price<hi);return {price:`${lo}..${hi}`,n:s.length,winPct:s.length?+(sum(s,r=>r.win)/s.length).toFixed(3):null,avgBE:s.length?+(sum(s,r=>be(r.price))/s.length).toFixed(3):null,roi:s.length?+(sum(s,r=>r.pnl)/s.length).toFixed(3):null};});
// home-dog vs road-dog
out.homeDog=summ(g.filter(r=>r.dog&&r.side==='home'));out.roadDog=summ(g.filter(r=>r.dog&&r.side==='away'));
// does the model's ML winner agree with market favorite?
out.modelPicksMktFavToWinML=+(rows.filter(r=>r.modelFavIsMktFav).length/rows.length).toFixed(3);
// counterfactual: other side of every pick (-1.5 fav) at opposing price
const opp=g.filter(r=>fin(r.oppPrice));out.oppositeSide={n:opp.length,w:sum(opp,r=>1-r.win),roi:+(sum(opp,r=>r.win?-1:pay(r.oppPrice))/opp.length).toFixed(3),avgBE:+(sum(opp,r=>be(r.oppPrice))/opp.length).toFixed(3)};
// bankroll bets
const bets=bank.bets.filter(b=>b.stake>0);
out.bankroll={picks:bank.picks,betCount:bank.betCount,kelly:bank.kelly,flat:bank.flat,
 staked:{n:bets.length,w:bets.filter(b=>b.outcome==='win').length,l:bets.filter(b=>b.outcome==='loss').length,avgWinChance:+(sum(bets,b=>b.winChance)/bets.length).toFixed(3),avgBE:+(sum(bets,b=>be(b.odds))/bets.length).toFixed(3),avgOdds:Math.round(sum(bets,b=>b.odds)/bets.length),dogShare:+(bets.filter(b=>b.line>0).length/bets.length).toFixed(3),flatROI:+(sum(bets,b=>b.outcome==='win'?pay(b.odds):b.outcome==='loss'?-1:0)/bets.length).toFixed(3),firstBet:bets[0]?.t,lastBet:bets.at(-1)?.t}};
// winChance over time for staked bets
out.bankroll.byMonth={};for(const b of bets){const m=b.t.slice(0,7);const o=out.bankroll.byMonth[m]??={n:0,w:0,wc:0,be:0,pl:0};o.n++;o.w+=b.outcome==='win'?1:0;o.wc+=b.winChance;o.be+=be(b.odds);o.pl+=b.pl;}
for(const o of Object.values(out.bankroll.byMonth)){o.wc=+(o.wc/o.n).toFixed(3);o.be=+(o.be/o.n).toFixed(3);o.pl=Math.round(o.pl);}
// all bets list winChance range
const allb=bank.bets;out.bankroll.winChanceRange=[Math.min(...allb.map(b=>b.winChance??1)),Math.max(...allb.map(b=>b.winChance??0))].map(x=>+x.toFixed(3));
fs.writeFileSync('analysis.json',JSON.stringify(out,null,1));
console.log(JSON.stringify(out,null,1));
