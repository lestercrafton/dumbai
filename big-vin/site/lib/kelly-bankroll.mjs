/** Bankroll replay of graded tracked picks, in kickoff order.
 * Kelly sizing uses only information known before each game: the win chance
 * learned from picks graded before that kickoff (rank-signal buckets, pulled
 * toward break-even) and the price taken. Flat sizing is replayed alongside. */
import {gradeSpreadPick,spreadOffer,breakEven,ASSUMED_ODDS,isLegacyRunLine} from './spread-record.mjs';
import {learnRankSignal,scoreGame} from './rank-signal.mjs';

export const START_BANKROLL=1_000_000;
export const KELLY_FRACTION=1;
export const MAX_STAKE=1;
export const FLAT_STAKE=0.01;
export const REUP_FLOOR=100_000;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const payout=odds=>odds>0?odds/100:100/-odds;

export function kellyStake(p,odds,{fraction=KELLY_FRACTION,cap=MAX_STAKE}={}){
 if(!finite(p))return 0;
 const b=payout(odds),full=(p*(b+1)-1)/b;
 return full>0?Math.min(cap,fraction*full):0;
}

export function replayKellyBankroll(records,{start=START_BANKROLL,includeLegacy=false}={}){
 const graded=records.filter(r=>includeLegacy||!isLegacyRunLine(r)).map(r=>({r,offer:spreadOffer(r),outcome:gradeSpreadPick(r).outcome}))
  .filter(x=>x.offer&&x.offer.basis!=='synthetic-winner-even'&&['win','loss','push'].includes(x.outcome)&&Number.isFinite(Date.parse(x.r.startTime)))
  .sort((a,b)=>Date.parse(a.r.startTime)-Date.parse(b.r.startTime)||String(a.r.id).localeCompare(String(b.r.id)));
 const rows=[],bets_=[];let kelly=start,flat=start,peak=start,maxDrawdown=0,bets=0,staked=0,maxStake=0,maxStakeDollars=0,reups=0,putIn=start;
 const series=[{t:graded[0]?.r.startTime??null,kelly,flat,reup:false}];
 const learnFrom=graded.map(x=>({...x.r,cohort:'live'}));
 for(const {r,offer,outcome} of graded){
  const odds=finite(r.odds)&&Math.abs(r.odds)>=100?r.odds:ASSUMED_ODDS;
  const signal=learnRankSignal(learnFrom,{before:Date.parse(r.startTime)});
  const edge=finite(r.predictedMargin)?Math.abs(r.predictedMargin+offer.homeSpread):null;
  const p=scoreGame(signal,{side:offer.side,homeSpread:offer.homeSpread,edge,odds,sport:r.sport})?.winChance;
  const f=kellyStake(p,odds);
  if(outcome!=='push')rows.push({t:r.startTime,p,be:breakEven(odds),odds,edge,dog:(offer.side==='home'?offer.homeSpread:-offer.homeSpread)>0,win:outcome==='win'?1:0});
  const ret=outcome==='win'?payout(odds):outcome==='loss'?-1:0;
  if(f>0){bets++;staked+=f;if(f>maxStake)maxStake=f;maxStakeDollars=Math.max(maxStakeDollars,kelly*f);}
  const before=kelly,amount=kelly*f,pl=amount*ret;
  kelly+=kelly*f*ret;flat+=flat*FLAT_STAKE*ret;
  peak=Math.max(peak,kelly);maxDrawdown=Math.max(maxDrawdown,(peak-kelly)/peak);
  series.push({t:r.startTime,kelly,flat,reup:false});
  // Re-up: when the bankroll falls under the floor, top it back up to the start.
  const pickTeam=offer.side==='home'?r.home:r.away,line=offer.side==='home'?offer.homeSpread:-offer.homeSpread;
  const bet={t:r.startTime,betType:r.sport==='mlb'?(isLegacyRunLine(r)?'Run line':'Moneyline'):'Spread',game:`${r.away??'Away'} @ ${r.home??'Home'}`,pick:pickTeam??offer.side,line,odds,edge,winChance:finite(p)?p:null,stake:f,amount,outcome,pl,before,after:kelly,reup:false};
  if(kelly<REUP_FLOOR){putIn+=start-kelly;kelly=start;reups++;peak=start;bet.reup=true;bet.afterReup=kelly;series.push({t:r.startTime,kelly,flat,reup:true});}
  bets_.push(bet);
 }
 let fpeak=start,flatDrawdown=0;for(const s of series){fpeak=Math.max(fpeak,s.flat);flatDrawdown=Math.max(flatDrawdown,(fpeak-s.flat)/fpeak);}
 return {start,picks:graded.length,bets,averageStake:bets?staked/bets:0,maxStake,maxStakeDollars,
  kelly:{bankroll:kelly,change:kelly/start-1,maxDrawdown,putIn,net:kelly-putIn,reups},flat:{bankroll:flat,change:flat/start-1,maxDrawdown:flatDrawdown},
  series,rows,bets:bets_,breakEven:breakEven(ASSUMED_ODDS)};
}
