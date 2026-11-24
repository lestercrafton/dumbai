// Walk-forward backtest: rank/stake Big Vin picks by Kelly % (current) vs by
// expected line movement (CLV) vs a blend. Every pick only sees what was known
// before its kickoff: the frozen rank signal (finals recorded before kickoff),
// the pick's own line and price. Closing lines are used only to grade CLV after
// the fact, and to learn expected CLV from games already graded.
// Run: node merge.mjs && node validate.mjs && node backtest.mjs
import fs from 'node:fs';
import {gradeSpreadPick,spreadOffer,breakEven,ASSUMED_ODDS,isLegacyRunLine} from '../../../lib/spread-record.mjs';
import {learnRankSignal,scoreGame,advantageRule,CLV_SWITCH} from '../../../lib/rank-signal.mjs';
import {STAR_ONLY_FROM,kellyStake,START_BANKROLL} from '../../../lib/kelly-bankroll.mjs';
import {ctDate,fitSequentialKelly} from '../../../lib/today-plays.mjs';
import {savedNeutralSite,pregameTotal} from '../../../lib/saved-game-context.mjs';
const DATA=process.env.DATA||'/workspace/bv-clv-data';
const OUT=new URL('./out/',import.meta.url);fs.mkdirSync(OUT,{recursive:true});
const totalsNba=JSON.parse(fs.readFileSync(new URL('../../../../data/totals/nba.json',import.meta.url)));
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const payout=o=>o>0?o/100:100/-o;
const SPORTS=['cfb','cbb','nba','nfl','nhl','mlb','wnba'];
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
function corr(xs,ys){const n=xs.length;if(n<3)return null;const mx=mean(xs),my=mean(ys);let sxy=0,sx=0,sy=0;for(let i=0;i<n;i++){sxy+=(xs[i]-mx)*(ys[i]-my);sx+=(xs[i]-mx)**2;sy+=(ys[i]-my)**2;}return sx&&sy?sxy/Math.sqrt(sx*sy):null;}
// Normal approximation: one point of line value is worth phi(0)/sigma of cover chance,
// sigma = spread of (final margin vs closing-or-taken line) over games graded before kickoff.
const PHI0=0.3989;

function rows(sport){
 const records=JSON.parse(fs.readFileSync(`${DATA}/records-${sport}.json`));
 const graded=records.filter(r=>sport==='mlb'||!isLegacyRunLine(r)).map(r=>({r,offer:spreadOffer(r),outcome:gradeSpreadPick(r).outcome}))
  .filter(x=>x.offer&&x.offer.basis!=='synthetic-winner-even'&&['win','loss','push'].includes(x.outcome)&&Number.isFinite(Date.parse(x.r.startTime)))
  .sort((a,b)=>Date.parse(a.r.startTime)-Date.parse(b.r.startTime)||String(a.r.id).localeCompare(String(b.r.id)));
 const learnFrom=graded.map(x=>({...x.r,cohort:'live'}));
 const sigs=new Map(),sig=t=>{if(!sigs.has(t))sigs.set(t,learnRankSignal(learnFrom,{before:t,frozen:true}));return sigs.get(t);};
 const totals=sport==='nba'?totalsNba:null;
 return graded.map(({r,offer,outcome})=>{
  const t=Date.parse(r.startTime),day=ctDate(r.startTime);
  const odds=finite(r.odds)&&Math.abs(r.odds)>=100?r.odds:ASSUMED_ODDS;
  const edge=finite(r.predictedMargin)?Math.abs(r.predictedMargin+offer.homeSpread):null;
  const s=sig(t),score=scoreGame(s,{side:offer.side,homeSpread:offer.homeSpread,edge,odds,sport});
  const star=day<STAR_ONLY_FROM||!!advantageRule(sport,{neutralSite:savedNeutralSite(r),edge,overUnder:r.overUnder??pregameTotal(totals,r)},score);
  const close=r.result?.closingHomeSpread,dir=offer.side==='home'?1:-1;
  const clv=finite(close)?dir*(offer.homeSpread-close):null;
  // Pregame sigma: games graded (frozen) before kickoff.
  const recorded=Date.parse(r.result?.pickRecordedAt??r.capturedAt??'');
  return {sport,id:r.id,t,day,odds,edge,outcome,win:outcome==='win'?1:outcome==='loss'?0:null,ret:outcome==='win'?payout(odds):outcome==='loss'?-1:0,
   be:breakEven(odds),bucket:score?.bucket,p:score?.winChance??null,expClv:score?.expectedClv??null,closingLinesKnown:s.closingLines,star,clv,
   pregame:Number.isFinite(recorded)&&recorded<t,margin:r.result?.actualMargin,line:offer.homeSpread,side:offer.side};
 });
}
// Walk-forward sigma per pick (sd of cover margin vs the line taken, games finished before kickoff).
function addSigma(list){
 for(const x of list){const prior=list.filter(y=>y.t<x.t&&finite(y.margin));const d=prior.map(y=>(y.margin+y.line)*(y.side==='home'?1:-1));
  const m=mean(d);x.sigma=d.length>=30?Math.sqrt(mean(d.map(v=>(v-m)**2))):null;}
}
// Strategies: each returns {score (order within the day), p used for Kelly}.
const STRATS={
 A_current:x=>({order:kellyStake(x.p,x.odds),p:x.p}),
 B1_rankClv_stakeKelly:x=>({order:x.useClv?x.expClv:kellyStake(x.p,x.odds),p:x.p}),
 B2_kelly_onlyPositiveExpClv:x=>({order:kellyStake(x.p,x.odds),p:x.useClv&&!(x.expClv>0)?0:x.p}),
 C_blend_pPlusClv:x=>{const p=x.useClv&&finite(x.sigma)?Math.min(0.99,Math.max(0.01,x.p+x.expClv*PHI0/x.sigma)):x.p;return {order:kellyStake(p,x.odds),p};},
};
function replay(list,strat,{starOnly=true}={}){
 let bank=START_BANKROLL,peak=bank,maxDD=0,bets=0,won=0,lost=0,risked=0,pl=0;const days=[...new Set(list.map(x=>x.day))];
 for(const d of days){const dayPicks=list.filter(x=>x.day===d);const opening=bank;
  const fit=dayPicks.map(x=>{const s=strat(x);const f=(starOnly?x.star:true)&&finite(s.p)?kellyStake(s.p,x.odds):0;return {x,sport:'day',stake:f,order:s.order??0,edge:x.edge,t:x.t,id:x.id};}).filter(r=>r.stake>0)
   .sort((a,b)=>b.order-a.order||b.stake-a.stake||(b.edge??-1)-(a.edge??-1)||a.t-b.t||a.id.localeCompare(b.id));
  fitSequentialKelly(fit,{day:opening});
  const w=new Map(fit.map(r=>[r.x,r.wager]));
  for(const x of dayPicks.sort((a,b)=>a.t-b.t||a.id.localeCompare(b.id))){const a=w.get(x)??0;if(!(a>0))continue;bets++;risked+=a;const g=a*x.ret;pl+=g;bank+=g;if(x.outcome==='win')won++;else if(x.outcome==='loss')lost++;
   peak=Math.max(peak,bank);maxDD=Math.max(maxDD,(peak-bank)/peak);}
 }
 return {end:bank,maxDD,bets,won,lost,roiRisked:risked?pl/risked:null};
}
function flat(sel){const d=sel.filter(x=>x.win!==null);const units=sel.reduce((s,x)=>s+x.ret,0);const c=sel.filter(x=>finite(x.clv));
 return {n:sel.length,wins:d.filter(x=>x.win).length,losses:d.filter(x=>!x.win).length,winPct:d.length?d.filter(x=>x.win).length/d.length:null,flatPer1:sel.length?units/sel.length:null,clvN:c.length,clvMean:mean(c.map(x=>x.clv))};}
const fmt=(v,d=3)=>v===null||v===undefined?'':typeof v==='number'?Number(v.toFixed(d)):v;
const report={generatedAt:new Date().toISOString(),clvSwitch:CLV_SWITCH,sports:{}};
const csv=['sport,id,day,star,p,expClv,closingLinesKnown,useClv,sigma,clv,outcome,odds,pregame'];
for(const sport of SPORTS){
 const list=rows(sport);addSigma(list);
 for(const x of list)x.useClv=x.closingLinesKnown>=CLV_SWITCH&&finite(x.expClv);
 for(const x of list)csv.push([sport,x.id,x.day,x.star,fmt(x.p,4),fmt(x.expClv,3),x.closingLinesKnown,x.useClv,fmt(x.sigma,2),fmt(x.clv,2),x.outcome,x.odds,x.pregame].join(','));
 const withClose=list.filter(x=>finite(x.clv));
 const oos=list.filter(x=>x.useClv); // picks where the CLV signal had >=100 prior closing lines
 const oosC=oos.filter(x=>finite(x.clv));
 const counts={graded:list.length,withClosingLine:withClose.length,pickedBeforeKickoff:list.filter(x=>x.pregame).length,pickedBeforeKickoffWithClose:withClose.filter(x=>x.pregame).length,
  eligibleOutOfSample:oos.length,eligibleWithClose:oosC.length,firstEligibleDay:oos[0]?.day??null};
 // Does expected CLV predict realized CLV / wins? (out-of-sample picks only)
 const dec=oos.filter(x=>x.win!==null);
 const predict={corrExpClvRealClv:fmt(corr(oosC.map(x=>x.expClv),oosC.map(x=>x.clv))),corrExpClvWin:fmt(corr(dec.map(x=>x.expClv),dec.map(x=>x.win))),corrPWin:fmt(corr(dec.map(x=>x.p),dec.map(x=>x.win))),
  corrRealClvWin:fmt(corr(withClose.filter(x=>x.win!==null).map(x=>x.clv),withClose.filter(x=>x.win!==null).map(x=>x.win))),
  overallRealizedClv:flat(withClose),
  expClvPositive:flat(oos.filter(x=>x.expClv>0)),expClvNonPositive:flat(oos.filter(x=>!(x.expClv>0))),
  kellyPositive:flat(oos.filter(x=>kellyStake(x.p,x.odds)>0)),kellyZero:flat(oos.filter(x=>!(kellyStake(x.p,x.odds)>0))),
  byBucket:Object.fromEntries([...new Set(oos.map(x=>x.bucket))].sort().map(b=>[b,flat(oos.filter(x=>x.bucket===b))]))};
 // Top of each day's card in the out-of-sample window: Kelly order vs expected-CLV order vs blend.
 const top={};
 for(const K of [3,5,10]){const pick={A_current:[],B_rankClv:[],C_blend:[]};
  for(const d of [...new Set(oos.map(x=>x.day))]){const dp=oos.filter(x=>x.day===d);
   const by=f=>[...dp].sort((a,b)=>f(b)-f(a)||(b.edge??-1)-(a.edge??-1)||a.t-b.t).slice(0,K);
   pick.A_current.push(...by(x=>kellyStake(x.p,x.odds)));pick.B_rankClv.push(...by(x=>x.expClv));pick.C_blend.push(...by(x=>finite(x.sigma)?kellyStake(Math.min(.99,Math.max(.01,x.p+x.expClv*PHI0/x.sigma)),x.odds):kellyStake(x.p,x.odds)));}
  top['top'+K]=Object.fromEntries(Object.entries(pick).map(([k,v])=>[k,flat(v)]));
  // Paired day bootstrap (2,000 resamples, fixed seed): 95% interval for the flat
  // profit per $1 of CLV order minus Kelly order on the same days.
  const days=[...new Set(oos.map(x=>x.day))],per=new Map(days.map(d=>[d,{a:0,b:0,n:0}]));
  for(const x of pick.A_current){const e=per.get(x.day);e.a+=x.ret;e.n++;}for(const x of pick.B_rankClv)per.get(x.day).b+=x.ret;
  let seed=12345;const rnd=()=>(seed=(seed*1103515245+12345)%2147483648)/2147483648;const diffs=[];
  for(let i=0;i<2000;i++){let a=0,b=0,n=0;for(let j=0;j<days.length;j++){const e=per.get(days[Math.floor(rnd()*days.length)]);a+=e.a;b+=e.b;n+=e.n;}diffs.push(n?(b-a)/n:0);}
  diffs.sort((x,y)=>x-y);top['top'+K].clvMinusKellyFlatPer1={diff:fmt(top['top'+K].B_rankClv.flatPer1-top['top'+K].A_current.flatPer1),ci95:[fmt(diffs[50]),fmt(diffs[1949])],days:days.length};}
 // Bankroll replays: live rules (stars only from Nov 4) over the whole season, and
 // over the out-of-sample window only, plus an all-picks variant (no star gate).
 const fromOos=oos.length?list.filter(x=>x.day>=oos[0].day):[];
 const bank={};for(const [k,f] of Object.entries(STRATS)){bank[k]={season:replay(list,f),oosWindow:fromOos.length?replay(fromOos,f):null,oosWindowAllPicks:fromOos.length?replay(fromOos,f,{starOnly:false}):null};}
 report.sports[sport]={counts,predict,top,bank};
 console.log(sport,JSON.stringify(counts));
}
fs.writeFileSync(new URL('report.json',OUT),JSON.stringify(report,null,1));
fs.writeFileSync(new URL('pick-rows.csv',OUT),csv.join('\n')+'\n');
