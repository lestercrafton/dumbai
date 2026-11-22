/** Bankroll replay of graded tracked picks, in kickoff order.
 * Kelly sizing uses only information known before each game: the win chance
 * learned from picks whose final was recorded before that kickoff (rank-signal
 * buckets, pulled toward break-even; the same frozen signal the board shows for
 * a started game) and the price taken. Flat sizing is replayed alongside.
 *
 * Each Central day is sized the way Today's plays sizes it (fitSequentialKelly):
 * Kelly % of that sport's bankroll at the start of the day, taken in Kelly order
 * only while it fits in the dollars left for the day, so a day never risks more
 * than 100% of its opening bankroll. Results then settle in kickoff order.
 * (Bug fixes, Nov 22 2026: before this, the win chance could use finals recorded
 * after kickoff, every bet compounded with no daily limit, and CBB/NBA stars were
 * never staked because the neutral-site flag and totals edge were not replayed.)
 *
 * applyFrom (YYYY-MM-DD America/Chicago): still learn from earlier graded
 * picks, but only stake / P&L / re-ups / series / drawdown on that day forward.
 * Used by My Bankroll so History starts when the visitor arrived, not day one. */
import {gradeSpreadPick,spreadOffer,breakEven,ASSUMED_ODDS,isLegacyRunLine} from './spread-record.mjs';
import {learnRankSignal,scoreGame,advantageRule} from './rank-signal.mjs';
/** Every sport stakes only starred picks from this Central date on (owner decision, Nov 4 2026). */
export const STAR_ONLY_FROM='2026-11-04';
import {ctDate,fitSequentialKelly} from './today-plays.mjs';
import {savedNeutralSite,pregameTotal} from './saved-game-context.mjs';

export const START_BANKROLL=1_000_000;
export const KELLY_FRACTION=1;
export const MAX_STAKE=1;
export const FLAT_STAKE=0.01;
export const REUP_FLOOR=100_000;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const payout=odds=>odds>0?odds/100:100/-odds;

/** Later of arrived CT day and optional override effective_from (both YYYY-MM-DD). */
export function bankrollApplyFrom(arrivedCtDay,effectiveFrom){
 const a=typeof arrivedCtDay==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(arrivedCtDay)?arrivedCtDay:null;
 const e=typeof effectiveFrom==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)?effectiveFrom:null;
 if(!a&&!e)return null;
 if(!a)return e;
 if(!e)return a;
 return a>e?a:e;
}

export function kellyStake(p,odds,{fraction=KELLY_FRACTION,cap=MAX_STAKE}={}){
 if(!finite(p))return 0;
 const b=payout(odds),full=(p*(b+1)-1)/b;
 return full>0?Math.min(cap,fraction*full):0;
}

/**
 * @param {any[]} records
 * @param {{start?: number, reupFloor?: number, includeLegacy?: boolean, applyFrom?: string|null, totals?: any}} [opts]
 * totals: the sport's over/under table (big-vin/data/totals/<sport>.json), used for the NBA star.
 */
export function replayKellyBankroll(records,{start=START_BANKROLL,reupFloor,includeLegacy=false,applyFrom=null,totals=null}={}){
 const floor=finite(reupFloor)&&reupFloor>0?reupFloor:start*0.1;
 const graded=records.filter(r=>includeLegacy||!isLegacyRunLine(r)).map(r=>({r,offer:spreadOffer(r),outcome:gradeSpreadPick(r).outcome}))
  .filter(x=>x.offer&&x.offer.basis!=='synthetic-winner-even'&&['win','loss','push'].includes(x.outcome)&&Number.isFinite(Date.parse(x.r.startTime)))
  .sort((a,b)=>Date.parse(a.r.startTime)-Date.parse(b.r.startTime)||String(a.r.id).localeCompare(String(b.r.id)));
 const applyDay=typeof applyFrom==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(applyFrom)?applyFrom:null;
 const rows=[],bets_=[];let kelly=start,flat=start,peak=start,maxDrawdown=0,bets=0,staked=0,maxStake=0,maxStakeDollars=0,reups=0,putIn=start,applied=0;
 const firstActive=graded.find(x=>!applyDay||ctDate(x.r.startTime)>=applyDay);
 const series=[{t:firstActive?.r.startTime??null,kelly,flat,reup:false}];
 const learnFrom=graded.map(x=>({...x.r,cohort:'live'}));
 const signals=new Map();
 const signalAt=t=>{if(!signals.has(t))signals.set(t,learnRankSignal(learnFrom,{before:t,frozen:true}));return signals.get(t);};
 // Pass 1: each pick's pregame win chance, star and full-Kelly share.
 const picks=graded.map(({r,offer,outcome})=>{
  const odds=finite(r.odds)&&Math.abs(r.odds)>=100?r.odds:ASSUMED_ODDS;
  const edge=finite(r.predictedMargin)?Math.abs(r.predictedMargin+offer.homeSpread):null;
  const score=scoreGame(signalAt(Date.parse(r.startTime)),{side:offer.side,homeSpread:offer.homeSpread,edge,odds,sport:r.sport});
  const p=score?.winChance;
  const day=ctDate(r.startTime);
  // From STAR_ONLY_FROM on, every sport stakes only starred (advantage) picks; earlier history is unchanged.
  const starred=day<STAR_ONLY_FROM||!!advantageRule(r.sport,{neutralSite:savedNeutralSite(r),edge,overUnder:r.overUnder??pregameTotal(totals,r)},score);
  return {r,offer,outcome,odds,edge,p,day,f:starred?kellyStake(p,odds):0};
 });
 // Pass 2: one Central day at a time, sized like Today's plays, settled in kickoff order.
 for(let i=0;i<picks.length;){
  let j=i;while(j<picks.length&&picks[j].day===picks[i].day)j++;
  const dayPicks=picks.slice(i,j);i=j;
  // Pre-arrival / pre-override games inform the signal only — no personal stake.
  if(applyDay&&dayPicks[0].day<applyDay)continue;
  const opening=kelly;
  const fit=dayPicks.filter(x=>x.f>0).map(x=>({x,sport:'day',stake:x.f,odds:x.odds,edge:x.edge,t:Date.parse(x.r.startTime),id:String(x.r.id)}))
   .sort((a,b)=>b.stake-a.stake||(finite(b.edge)?b.edge:-1)-(finite(a.edge)?a.edge:-1)||a.t-b.t||a.id.localeCompare(b.id));
  fitSequentialKelly(fit,{day:opening});
  const wager=new Map(fit.map(row=>[row.x,row.wager]));
  for(const x of dayPicks){
   const {r,offer,outcome,odds,edge,p,f}=x;
   applied++;
   if(outcome!=='push')rows.push({t:r.startTime,p,be:breakEven(odds),odds,edge,dog:(offer.side==='home'?offer.homeSpread:-offer.homeSpread)>0,win:outcome==='win'?1:0});
   const ret=outcome==='win'?payout(odds):outcome==='loss'?-1:0;
   const amount=wager.get(x)??0,stake=amount>0&&opening>0?amount/opening:0;
   if(amount>0){bets++;staked+=stake;if(stake>maxStake)maxStake=stake;maxStakeDollars=Math.max(maxStakeDollars,amount);}
   const before=kelly,pl=amount*ret;
   kelly+=pl;flat+=flat*FLAT_STAKE*ret;
   peak=Math.max(peak,kelly);maxDrawdown=Math.max(maxDrawdown,(peak-kelly)/peak);
   series.push({t:r.startTime,kelly,flat,reup:false});
   // Re-up: when the bankroll falls under the floor, top it back up to the start.
   const pickTeam=offer.side==='home'?r.home:r.away,line=offer.side==='home'?offer.homeSpread:-offer.homeSpread;
   const bet={t:r.startTime,betType:r.sport==='mlb'?(isLegacyRunLine(r)?'Run line':'Moneyline'):'Spread',game:`${r.away??'Away'} @ ${r.home??'Home'}`,pick:pickTeam??offer.side,line,odds,edge,winChance:finite(p)?p:null,stake,kelly:f,...(f>0&&!(amount>0)?{overBudget:true}:{}),amount,outcome,pl,before,after:kelly,reup:false};
   if(kelly<floor){putIn+=start-kelly;kelly=start;reups++;peak=start;bet.reup=true;bet.afterReup=kelly;series.push({t:r.startTime,kelly,flat,reup:true});}
   bets_.push(bet);
  }
 }
 let fpeak=start,flatDrawdown=0;for(const s of series){fpeak=Math.max(fpeak,s.flat);flatDrawdown=Math.max(flatDrawdown,(fpeak-s.flat)/fpeak);}
 return {start,picks:applied,betCount:bets,averageStake:bets?staked/bets:0,maxStake,maxStakeDollars,applyFrom:applyDay,
  kelly:{bankroll:kelly,change:kelly/start-1,maxDrawdown,putIn,net:kelly-putIn,reups},flat:{bankroll:flat,change:flat/start-1,maxDrawdown:flatDrawdown},
  series,rows,bets:bets_,breakEven:breakEven(ASSUMED_ODDS)};
}
