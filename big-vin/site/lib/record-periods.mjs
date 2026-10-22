/** Record display periods operate on the API's saved, scoped day summaries.
 * They never select visible games, re-rank picks, replay stakes, or pool versions.
 */
const countFields=['recorded','graded','wins','losses','pushes','pending','voids','offered','pricedGames','unlined','ungraded','units','risked','breakEvenSum','decided','clvSum','clvCount','assumedPrices'];
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const isoDay=date=>typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date+'T12:00:00Z'))&&new Date(date+'T12:00:00Z').toISOString().slice(0,10)===date;

/** Monday–Sunday reporting window, inclusive, in existing Eastern day keys. */
export function calendarRecordWeek(date){
 if(!isoDay(date))return null;
 const start=new Date(date+'T12:00:00Z');
 start.setUTCDate(start.getUTCDate()-(start.getUTCDay()+6)%7);
 const end=new Date(start);end.setUTCDate(end.getUTCDate()+6);
 return {start:start.toISOString().slice(0,10),end:end.toISOString().slice(0,10)};
}

/** Sum counts, then calculate wins / (wins + losses); never average rates.
 * @param {any[]} days Already scoped to one sport, cohort, version and card.
 * @param {{start:string,end:string}|null} period Inclusive saved-day range.
 */
export function aggregateRecordDays(days,period){
 const selected=period?days.filter(day=>day.date>=period.start&&day.date<=period.end):[];
 const counts=Object.fromEntries(countFields.map(key=>[key,selected.reduce((sum,day)=>sum+(finite(day[key])?day[key]:0),0)]));
 const nullableTotal=key=>{const values=selected.map(day=>day[key]).filter(finite);return values.length?values.reduce((sum,value)=>sum+value,0):null;};
 const logs=selected.map(day=>day.truthLogs).filter(Array.isArray);
 const truthLogs=logs.length?logs[0].map((_,i)=>logs.reduce((sum,row)=>sum+(finite(row[i])?row[i]:0),0)):null;
 return {...counts,truthLogs,recorded:counts.recorded,graded:counts.graded,wins:counts.wins,losses:counts.losses,pushes:counts.pushes,pending:counts.pending,voids:counts.voids,
  winRate:counts.wins+counts.losses?counts.wins/(counts.wins+counts.losses):null,profit:nullableTotal('profit'),profitUnits:nullableTotal('profitUnits')};
}
