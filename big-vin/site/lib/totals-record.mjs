/** Over/under pick record — flat $1 at the price taken, same proof math as ATS. */
import {ASSUMED_ODDS,TRUTH_STAKES,breakEven} from './spread-record.mjs';

export const TOTALS_RECORD_SPORTS=Object.freeze(['nfl','cfb','nba','wnba','cbb']);
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const payout=odds=>odds>0?odds/100:100/-odds;
const sides=new Set(['over','under']);

/** @param {any[]} games Rows from data/totals/{sport}.json games map values (or enriched with startTime). */
export function summarizeTotalGames(games){
 const picks=(games||[]).filter(g=>g&&sides.has(g.side));
 const proof={units:0,risked:0,breakEvenSum:0,decided:0,truthLogs:TRUTH_STAKES.map(()=>0),assumedPrices:0,clvSum:0,clvCount:0};
 let wins=0,losses=0,pushes=0,pending=0;
 for(const g of picks){
  const result=g.result;
  if(result!=='win'&&result!=='loss'&&result!=='push'){pending++;continue;}
  const priced=finite(g.price)&&Math.abs(g.price)>=100,odds=priced?g.price:ASSUMED_ODDS;
  if(!priced)proof.assumedPrices++;
  proof.risked++;
  if(result==='push'){pushes++;continue;}
  if(result==='win')wins++;else losses++;
  const p=breakEven(odds),won=result==='win';
  proof.units+=won?payout(odds):-1;proof.breakEvenSum+=p;proof.decided++;
  const x=(won?1/p:0)-1;
  proof.truthLogs=proof.truthLogs.map((log,i)=>log+Math.log(1+TRUTH_STAKES[i]*x));
 }
 const graded=wins+losses+pushes;
 return {recorded:picks.length,offered:picks.length,graded,wins,losses,pushes,
  winRate:wins+losses?wins/(wins+losses):null,pending,voids:0,unlined:0,ungraded:0,...proof};
}

/** Bucket games by Eastern sports day of kickoff, newest first. */
export function totalsRecordDays(games,dayOf){
 const byDay=new Map();
 for(const g of games||[]){
  if(!g?.startTime||!sides.has(g.side))continue;
  const date=dayOf(g.startTime);
  const list=byDay.get(date)??[];list.push(g);byDay.set(date,list);
 }
 return [...byDay].sort(([a],[b])=>b.localeCompare(a)).map(([date,rows])=>({date,...summarizeTotalGames(rows)}));
}

export function totalsHasPicks(table){
 if(!table?.games)return false;
 return Object.values(table.games).some(g=>g&&sides.has(g.side));
}
