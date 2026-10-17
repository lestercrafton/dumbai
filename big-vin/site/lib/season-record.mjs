import {rankCardHistory} from './ranked-card-summary.mjs';
import {summarizeForecasts} from './results.mjs';
import {summarizeSpreadPicks} from './spread-record.mjs';

/** A season is the provider's explicit integer identity, never a date cutoff.
 * @param {unknown} value
 * @returns {number|null}
 */
export function validSeason(value){
 const candidate=typeof value==='number'?value:typeof value==='string'&&/^\d+$/.test(value.trim())?Number(value.trim()):null;
 return candidate!==null&&Number.isSafeInteger(candidate)&&candidate>0?candidate:null;
}

const easternDate=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
const savedDay=record=>{
 const value=record.result?.status==='completed'&&record.result.playedAt||record.startTime;
 return Number.isFinite(Date.parse(value))?easternDate.format(new Date(value)):null;
};
const originalProfit=(records,bankroll)=>{
 const total=field=>{
  const values=records.map(record=>bankroll?.plays?.[record.id]?.[field]).filter(value=>typeof value==='number'&&Number.isFinite(value));
  return values.length?values.reduce((sum,value)=>sum+value,0):null;
 };
 return {profit:total('profit'),profitUnits:total('profitUnits')};
};

/** Summarize only an explicit provider season within the caller's existing
 * sport/cohort/formula scope. Rank the whole scope before selecting a season,
 * so a seasonal view cannot promote a pick into an original Top N card.
 * Prices, grades, forecasts and full-card bankroll stakes are never changed.
 * @param {any[]} records Already scoped to one sport, cohort and formula.
 * @param {number|string|null} season Explicit provider season identity.
 * @param {{rankPeriod?:string,rankAnchor?:string|null,bankroll?:any}} [options]
 */
export function summarizeSavedSeason(records,season,{rankPeriod='week',rankAnchor=null,bankroll=null}={}){
 const selectedSeason=validSeason(season);
 if(selectedSeason===null)return null;
 const ranked=rankCardHistory(records,{rankPeriod,rankAnchor});
 const summaryOf=cardRecords=>{
  const seasonal=cardRecords.filter(record=>validSeason(record.season)===selectedSeason);
  const dates=seasonal.map(savedDay).filter(date=>date!==null).sort();
  return {
   overall:{...summarizeForecasts(seasonal),...originalProfit(seasonal,bankroll)},
   spreadOverall:summarizeSpreadPicks(seasonal),
   coverage:{saved:seasonal.length,seasonUnknownCount:cardRecords.filter(record=>validSeason(record.season)===null).length,
    firstDate:dates[0]??null,lastDate:dates.at(-1)??null,complete:false}
  };
 };
 const rankedCards=Object.fromEntries(['3','8','10'].map(card=>[card,summaryOf(ranked.filter(record=>Number.isInteger(record.cardRank)&&record.cardRank>0&&record.cardRank<=Number(card)))]));
 return {season:selectedSeason,...summaryOf(ranked),rankedCards};
}
