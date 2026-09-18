import {scoreboardUrls} from './feeds/adapter.mjs';

export function rangeDates(start, end = start) {
 const dates=[];
 for(let ms=Date.parse(start+'T00:00:00Z');ms<=Date.parse(end+'T00:00:00Z');ms+=86400000)dates.push(new Date(ms).toISOString().slice(0,10));
 return dates;
}
export function boardDates(boards) {
 return [...new Set(boards.flatMap(b=>rangeDates(b.date,b.endDate||b.date)))].sort();
}
export function boardBatches(boards, limit=30) {
 const batches=[];for(let i=0;i<boards.length;i+=limit)batches.push(boards.slice(i,i+limit));return batches;
}
// A missing event is not a cancellation. Retained observations keep their own
// timestamps and quotes; only actually observed events receive fresh data.
export function mergeSavedBoard(previous, current) {
 const fresh=new Set(current.games.map(g=>g.id));
 const retained=(previous?.games||[]).filter(g=>!fresh.has(g.id));
 return {...current,games:[...retained,...current.games],warnings:[...new Set([
  ...(current.warnings||[]),...(retained.length?[`${retained.length} previously observed games were omitted by this response; their dated observations are retained.`]:[]),
 ])]};
}

/** Bounded range fallback. Never discard successful dates after another fails. */
export async function collectSourceRange(sport, range, read, archive=()=>{}) {
 if(sport==='wnba'&&range.endDate&&range.endDate!==range.date){
  const combined={boards:[],failures:[],warnings:[],missing:[]};
  for(const date of rangeDates(range.date,range.endDate)){
   const result=await collectSourceRange(sport,{date},read,archive);
   for(const key of Object.keys(combined))combined[key].push(...result[key]);
  }
  return combined;
 }
 const boards=[],failures=[],warnings=[];
 async function attempt(url,part,partial=false) {
  try {
   const payload=await read(url);
   if(!Array.isArray(payload.events))throw new Error('Source response has no events array.');
   const warning=partial?'CFB compact-date fallback can omit games (observed 25-event cap); schedule coverage is incomplete/unverified.':null;
   const board={...part,sourceUrl:url,observedAt:new Date().toISOString(),payload,warnings:warning?[warning]:[]};
   await archive(board);boards.push(board);if(warning)warnings.push(warning);return true;
  }catch(e){failures.push({url,date:part.date,endDate:part.endDate||part.date,error:e.message});return false;}
 }
 for(const url of scoreboardUrls(sport,{startDate:range.date,endDate:range.endDate})) {
  if(await attempt(url,range))continue;
  let recovered=true;
  for(const date of rangeDates(range.date,range.endDate||range.date)) {
   const single=new URL(url);const compact=date.replaceAll('-','');
   single.searchParams.set('dates',sport==='cfb'?`${compact}-${compact}`:compact);
   // The already failed same-day URL needs no duplicate request.
   if(single.toString()!==url&&await attempt(single.toString(),{date}))continue;
   if(sport==='cfb') {
    single.searchParams.set('dates',compact);
    if(await attempt(single.toString(),{date},true))continue;
   }
   recovered=false;
  }
  if(recovered)warnings.push(`Recovered failed range using individual dates: ${url}`);
 }
 const expected=rangeDates(range.date,range.endDate||range.date).flatMap(date=>scoreboardUrls(sport,{startDate:date}).map(url=>({date,group:new URL(url).searchParams.get('groups')})));
 const missing=expected.filter(e=>!boards.some(b=>boardDates([b]).includes(e.date)&&new URL(b.sourceUrl).searchParams.get('groups')===e.group));
 return {boards,failures,warnings:[...new Set(warnings)],missing};
}
