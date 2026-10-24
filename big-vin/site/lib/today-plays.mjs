/** Today's full-Kelly plays from board games and each sport's current bankroll.
 * Uses the board's pregame pick and win chance; once a game starts its pick is
 * the locked kickoff revision, so live games keep the stake they had at lock.
 * Cover status uses the same livePickStatus function as the game cards. */
import {kellyStake} from './kelly-bankroll.mjs';
import {compareKelly,pickPrice} from './kelly-rank.mjs';
import {livePickStatus,liveTotalStatus,coverToOutcome,provisionalFinalLabel,totalPickOutcome} from './live-pick-status.mjs';
import {liveGameProgress,clockBadge} from './live-game-progress.mjs';
import {visibleOutcome} from './presentation.mjs';
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const payout=o=>o>0?o/100:100/-o;
const abbr=t=>t?.abbreviation||t?.name?.split(/\s+/).pop()?.slice(0,4)?.toUpperCase()||'?';
export function ctDate(t){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t));}
export function playCover(g,now=Date.now()){
 if(g.result?.status==='completed'||g.completed&&g.result){
  const o=g.result?.outcome||g.decision?.outcome;
  const label=({win:'Win',loss:'Loss',push:'Push'})[o]||visibleOutcome({outcome:o});
  return {state:o==='win'?'covering':o==='loss'?'not-covering':'push',label,final:true};
 }
 const s=livePickStatus(g,{now});
 if(g.finalPendingGrade&&s.provisional){
  const label=provisionalFinalLabel(s.state,{short:true});
  return {state:s.state,label:label||s.label,final:true};
 }
 if(!s.provisional)return {state:'unavailable',label:g.finalPendingGrade||g.statusDescription==='Final'?'Final':'—',final:!!g.finalPendingGrade};
 return {state:s.state,label:s.label,final:false};
}
export function scoreClock(g,now=Date.now()){
 const home=Number.isFinite(g.liveHomeScore)?g.liveHomeScore:g.homeScore;
 const away=Number.isFinite(g.liveAwayScore)?g.liveAwayScore:g.awayScore;
 if(!Number.isFinite(home)||!Number.isFinite(away))return null;
 const score=`${abbr(g.away)} ${away}–${home} ${abbr(g.home)}`;
 const clock=clockBadge(g,{now});
 return {score,clock};
}
export function todayPlays(games,bankrolls,today,now=Date.now()){
 const rows=[];
 for(const g of games){
  if(!g?.startTime||ctDate(g.startTime)!==today)continue;
  const live=g.status==='live'||!!g.finalPendingGrade;
  const done=g.completed||g.status==='completed'||g.result?.status==='completed'||g.status==='final';
  if(!live&&!done&&g.status!=='scheduled')continue;
  const pick=g.pickRevision??{};const side=pick.side??g.side;if(side!=='home'&&side!=='away')continue;
  const homeSpread=finite(pick.marketHomeSpread)?pick.marketHomeSpread:g.market?.homeSpread;
  const odds=pickPrice(g);const p=g.rankSignal?.winChance;const bankroll=bankrolls[g.sport];
  const ok=finite(odds)&&Math.abs(odds)>=100&&finite(p)&&finite(bankroll);
  const stake=ok?kellyStake(p,odds):0,wager=ok?bankroll*stake:0;
  const moneyline=g.sport==='mlb';const cover=playCover(g,now);
  let totalCover=null;
  if(g.overUnder?.side){
   const graded=totalPickOutcome(g);
   if(graded)
    totalCover={state:graded==='win'?'covering':graded==='loss'?'not-covering':'push',label:({win:'Win',loss:'Loss',push:'Push'})[graded],final:true};
   else if(g.finalPendingGrade){const t=liveTotalStatus(g,{now});if(t.provisional)totalCover={state:t.state,label:provisionalFinalLabel(t.state,{short:true}),final:true};}
   else {const t=liveTotalStatus(g,{now});if(t.provisional)totalCover={state:t.state,label:t.label,final:false};}
  }
  rows.push({game_:g,id:`${g.sport}:${g.id}`,sport:g.sport,startTime:g.startTime,live,done:!!done||!!g.finalPendingGrade,
   game:`${g.away?.name??'Away'} @ ${g.home?.name??'Home'}`,pick:side==='home'?g.home?.name:g.away?.name,
   line:moneyline?null:finite(homeSpread)?(side==='home'?homeSpread:-homeSpread):null,odds:finite(odds)?odds:null,
   winChance:finite(p)?p:null,stake,wager,toWin:ok?wager*payout(odds):0,scoreClock:scoreClock(g,now),cover,totalCover});
 }
 rows.sort((a,b)=>a.sport===b.sport?compareKelly(a.game_,b.game_):(b.wager-a.wager||compareKelly(a.game_,b.game_)));
 for(const r of rows)delete r.game_;
 const bySport={};for(const r of rows){bySport[r.sport]=(bySport[r.sport]??0)+r.wager;}
 return {rows,bySport,total:rows.reduce((a,r)=>a+r.wager,0)};
}
