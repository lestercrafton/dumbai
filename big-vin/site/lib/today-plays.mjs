/** Today's full-Kelly plays from board games and each sport's current bankroll.
 * Uses the board's pregame pick and win chance; once a game starts its pick is
 * the locked kickoff revision, so live games keep the stake they had at lock. */
import {kellyStake} from './kelly-bankroll.mjs';
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const payout=o=>o>0?o/100:100/-o;
export function ctDate(t){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t));}
export function todayPlays(games,bankrolls,today){
 const rows=[];
 for(const g of games){
  if(!g?.startTime||ctDate(g.startTime)!==today||g.completed||g.status==='final'||g.result)continue;
  if(!['scheduled','live'].includes(g.status))continue;
  const pick=g.pickRevision??{};const side=pick.side??g.side;if(side!=='home'&&side!=='away')continue;
  const homeSpread=finite(pick.marketHomeSpread)?pick.marketHomeSpread:g.market?.homeSpread;
  const odds=finite(pick.odds)?pick.odds:side==='home'?g.market?.homeSpreadPrice:g.market?.awaySpreadPrice;
  const p=g.rankSignal?.winChance;const bankroll=bankrolls[g.sport];
  const ok=finite(odds)&&Math.abs(odds)>=100&&finite(p)&&finite(bankroll);
  const stake=ok?kellyStake(p,odds):0,wager=ok?bankroll*stake:0;
  const moneyline=g.sport==='mlb';
  rows.push({id:`${g.sport}:${g.id}`,sport:g.sport,startTime:g.startTime,live:g.status==='live',
   game:`${g.away?.name??'Away'} @ ${g.home?.name??'Home'}`,pick:side==='home'?g.home?.name:g.away?.name,
   line:moneyline?null:finite(homeSpread)?(side==='home'?homeSpread:-homeSpread):null,odds:finite(odds)?odds:null,
   winChance:finite(p)?p:null,stake,wager,toWin:ok?wager*payout(odds):0});
 }
 rows.sort((a,b)=>b.wager-a.wager||(b.winChance??0)-(a.winChance??0)||Date.parse(a.startTime)-Date.parse(b.startTime));
 const bySport={};for(const r of rows){bySport[r.sport]=(bySport[r.sport]??0)+r.wager;}
 return {rows,bySport,total:rows.reduce((a,r)=>a+r.wager,0)};
}
