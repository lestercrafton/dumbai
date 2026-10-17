import {rankForecasts} from './ranking.mjs';
import {summarizeForecasts} from './results.mjs';
import {summarizeSpreadPicks} from './spread-record.mjs';

export const CARD_LABELS=Object.freeze({all:'Full card','3':'Top 3','8':'Easy 8','10':'Top 10'});
const easternDate=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
const dayOf=value=>easternDate.format(new Date(value));
const settlementDay=record=>dayOf(record.result?.status==='completed'&&record.result.playedAt||record.startTime);
const DAY=86400000;
const groups=(records,keyOf)=>{
 const grouped=new Map();
 for(const record of records){const key=keyOf(record);if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(record);}
 return grouped;
};
const profitOf=(records,bankroll)=>{
 const settled=records.map(record=>bankroll?.plays?.[record.id]).filter(play=>Number.isFinite(play?.profit));
 return {profit:settled.length?settled.reduce((sum,play)=>sum+play.profit,0):null,
  profitUnits:settled.length?settled.reduce((sum,play)=>sum+play.profitUnits,0):null};
};

/** A rolling seven-day board keeps the same weekday boundaries in history.
 * @param {any[]} records
 * @param {{rankPeriod?:string,rankAnchor?:string|null}} [options]
 */
export function rankCardHistory(records,{rankPeriod='week',rankAnchor=null}={}){
 const anchor=rankAnchor&&/^\d{4}-\d{2}-\d{2}$/.test(rankAnchor)?Date.parse(rankAnchor+'T00:00:00Z'):null;
 const keyOf=record=>{
  const date=dayOf(record.startTime);
  if(rankPeriod==='day')return date;
  if(Number.isFinite(anchor))return new Date(anchor+Math.floor((Date.parse(date+'T00:00:00Z')-anchor)/(7*DAY))*7*DAY).toISOString().slice(0,10);
  return record.weekKey;
 };
 return [...groups(records,keyOf).values()].flatMap(rankForecasts);
}

/** Use the board's ranking period and frozen model/market inputs. A final can
 * change a grade or its settlement day, but cannot promote a pick into Top N.
 * Returns describe contributions at the original full-card stakes; no replay.
 * @param {any[]} records
 * @param {string|null} selectedWeek
 * @param {any} bankroll
 * @param {{rankPeriod?:string,rankAnchor?:string|null}} [options]
 */
export function summarizeRankedCards(records,selectedWeek,bankroll,{rankPeriod='week',rankAnchor=null}={}){
 const ranked=rankCardHistory(records,{rankPeriod,rankAnchor});
 const days=groups(ranked,settlementDay),weeks=groups(ranked,record=>record.weekKey);
 const summaryOf=rows=>({...summarizeForecasts(rows),...profitOf(rows,bankroll)});
 return Object.fromEntries(['3','8','10'].map(card=>{
  const choose=rows=>rows.filter(record=>Number.isInteger(record.cardRank)&&record.cardRank>0&&record.cardRank<=Number(card));
  const chosen=choose(ranked),selected=chosen.filter(record=>record.weekKey===selectedWeek);
  return [card,{
   rankPeriod,
   days:[...days].sort(([a],[b])=>b.localeCompare(a)).map(([date,rows])=>({date,...summaryOf(choose(rows))})),
   spreadDays:[...days].sort(([a],[b])=>b.localeCompare(a)).map(([date,rows])=>({date,...summarizeSpreadPicks(choose(rows))})),
   spreadWeeks:[...weeks].sort(([a],[b])=>b.localeCompare(a)).map(([key,rows])=>({key,...summarizeSpreadPicks(choose(rows))})),
   summary:summaryOf(selected),overall:summaryOf(chosen),
   spreadRecord:summarizeSpreadPicks(selected),spreadOverall:summarizeSpreadPicks(chosen)
  }];
 }));
}
