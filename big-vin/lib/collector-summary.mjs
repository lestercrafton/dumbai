import fs from 'node:fs';
import path from 'node:path';

const easternDay=value=>new Date(value).toLocaleDateString('en-CA',{timeZone:'America/New_York'});
const coreBase='https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/events';
const summaryBase='https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary';
const eventId=value=>/^\d+$/.test(String(value))?String(value):null;
const listedEventId=ref=>{
 try{
  const url=new URL(ref);
  if(!['http:','https:'].includes(url.protocol)||url.hostname!=='sports.core.api.espn.com'||!/^\/v2\/sports\/football\/leagues\/college-football\/events\/\d+$/.test(url.pathname))return null;
  const id=url.pathname.split('/').at(-1);return eventId(id);
 }catch{return null;}
};
const hasBoardEvent=(boards,entry)=>boards.some(board=>new URL(board.sourceUrl).searchParams.get('groups')===entry.sourceGroup&&board.payload.events.some(event=>String(event.id)===String(entry.event.id)));
const coreEventUrl=id=>`${coreBase}/${id}?lang=en&region=us`;
const coreListUrl=(date,group,page=1)=>`${coreBase}?dates=${date.replaceAll('-','')}&limit=1000&groups=${group}${page>1?`&page=${page}`:''}`;

/** The core index is uncapped for our daily slate. A compact scoreboard alone
 * cannot establish that every game was seen. Failed dates remain auditable and
 * the previously archived schedule is still usable as a fallback.
 */
export async function discoverCollegeEvents(boards,known,startDate,endDate,read) {
 const listed=new Map(),failures=[];let enumerated=0,coreVerified=0;
 for(let ms=Date.parse(startDate+'T00:00:00Z');ms<=Date.parse(endDate+'T00:00:00Z');ms+=86400000){
  const date=new Date(ms).toISOString().slice(0,10);
  for(const group of ['80','81']){
   let page=1,expected=null,seen=0;
   try{
    do{
     const url=coreListUrl(date,group,page),data=await read(url);
     // ESPN reports an empty date as pageIndex 0/pageCount 0, even though
     // populated indexes start at page 1. Accept only that exact empty shape.
     const empty=page===1&&data?.count===0&&data.pageCount===0&&data.pageIndex===0&&Array.isArray(data.items)&&data.items.length===0;
     if(!empty&&(!Array.isArray(data?.items)||!Number.isInteger(data.count)||data.count<0||!Number.isInteger(data.pageCount)||data.pageCount<0||data.pageCount>20||data.pageIndex!==page))throw new Error('Malformed core event index.');
     if(expected===null)expected=data.count;
     if(data.count!==expected)throw new Error('Core event index changed during pagination.');
     for(const item of data.items){
      const id=listedEventId(item?.$ref);if(!id)throw new Error('Core event index has an invalid event reference.');
      seen++;const previous=listed.get(id);
      if(previous?.sourceGroup==='80'&&group==='81')continue;
      listed.set(id,{id,date,sourceGroup:group,scheduleSourceUrl:url,scheduleObservedAt:new Date().toISOString()});
     }
     if(page===data.pageCount||empty)break;
     page++;
    }while(page<=20);
    if(seen!==expected)throw new Error(`Core event index returned ${seen} of ${expected} events.`);
    enumerated+=seen;
   }catch(error){failures.push({date,group,sourceUrl:coreListUrl(date,group,page),error:error.message});}
  }
 }
 const archived=new Map(known.map(entry=>[String(entry.event.id),entry]));
 const events=new Map(known.map(entry=>[String(entry.event.id),entry]));
 const missing=[...listed.values()].filter(entry=>!hasBoardEvent(boards,{event:{id:entry.id},sourceGroup:entry.sourceGroup}));
 let index=0;
 await Promise.all(Array.from({length:Math.min(8,missing.length)},async()=>{
  while(index<missing.length){
   const entry=missing[index++],old=archived.get(entry.id);
   if(old){events.set(entry.id,{...old,date:entry.date,sourceGroup:entry.sourceGroup,scheduleSourceUrl:entry.scheduleSourceUrl,scheduleObservedAt:entry.scheduleObservedAt});continue;}
   const sourceUrl=coreEventUrl(entry.id);
   try{
    const core=await read(sourceUrl),competition=core?.competitions?.[0];
    const competitors=competition?.competitors;
    if(String(core?.id)!==entry.id||!Number.isFinite(Date.parse(core?.date))||easternDay(core.date)!==entry.date||!Array.isArray(competitors)||competitors.length!==2||new Set(competitors.map(c=>String(c.id))).size!==2||!['home','away'].every(side=>competitors.some(c=>c.homeAway===side&&eventId(c.id))))throw new Error('Core event identity/date/team membership is incomplete.');
    const event={id:entry.id,date:core.date,competitions:[{competitors:competitors.map(c=>({homeAway:c.homeAway,team:{id:String(c.id)}}))}]};
    events.set(entry.id,{event,date:entry.date,sourceGroup:entry.sourceGroup,scheduleSourceUrl:entry.scheduleSourceUrl,scheduleObservedAt:entry.scheduleObservedAt,coreEventSourceUrl:sourceUrl});
    coreVerified++;
   }catch(error){failures.push({date:entry.date,group:entry.sourceGroup,gameId:entry.id,sourceUrl,error:error.message});}
  }
 }));
 return {events:[...events.values()],failures,enumerated,discovered:listed.size,coreVerified};
}
export function knownCollegeEvents(root,startDate,endDate) {
 const events=new Map();
 const directories=fs.readdirSync(root,{withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>d.name).sort().slice(-45);
 for(const directory of directories)for(const name of fs.readdirSync(path.join(root,directory)).filter(n=>n.startsWith('cfb-')&&n.endsWith('.json'))) {
  const board=JSON.parse(fs.readFileSync(path.join(root,directory,name),'utf8'));
  const directGroup=new URL(board.sourceUrl||board.url).searchParams.get('groups');
  const archivedGroup=board.scheduleSourceUrl?new URL(board.scheduleSourceUrl).searchParams.get('groups'):null;
  const group=directGroup||(board.sourceGroup===archivedGroup?archivedGroup:null);
  if(!['80','81'].includes(group))continue;
  for(const event of board.payload?.events||[]) {
   const date=easternDay(event.date);if(date<startDate||date>endDate)continue;
   const prior=events.get(String(event.id));
   // FBS membership takes precedence for a game appearing in both groups.
   if(prior?.sourceGroup==='80'&&group==='81')continue;
   events.set(String(event.id),{event,date,sourceGroup:group,scheduleSourceUrl:board.scheduleSourceUrl||board.sourceUrl||board.url,scheduleObservedAt:board.scheduleObservedAt||board.observedAt});
  }
 }
 return [...events.values()];
}
export function adaptEventSummary(summary,known) {
 const header=summary.header,competition=header?.competitions?.[0];
 const teams=entry=>(entry?.competitors||[]).map(c=>`${c.homeAway}:${c.team?.id}`).sort().join('|');
 if(String(header?.id)!==String(known.event.id)||!competition||teams(competition)!==teams(known.event.competitions?.[0]))throw new Error('Summary game/team identity did not match its verified event source.');
 if(!Number.isFinite(Date.parse(competition.date)))throw new Error('Summary has no valid game date.');
 // Exact summaries are score-recovery sources. Their pickcenter is a current
 // or closing offer without a provable pre-kickoff capture, so never publish
 // it as a historical market quote.
 return {events:[{...header,date:competition.date,week:{number:header.week},competitions:[{...competition,odds:[]}]}]};
}
export async function recoverCollegeEvents(boards,known,read,archive=()=>{}) {
 const missing=known.filter(k=>!hasBoardEvent(boards,k));
 const recovered=[],failures=[];let index=0;
 await Promise.all(Array.from({length:Math.min(4,missing.length)},async()=>{
  while(index<missing.length) {
    const k=missing[index++];const sourceUrl=`${summaryBase}?event=${k.event.id}`;
   try {
    const summary=await read(sourceUrl);const payload=adaptEventSummary(summary,k);
    const board={date:easternDay(payload.events[0].date),sourceUrl,observedAt:new Date().toISOString(),sourceGroup:k.sourceGroup,scheduleSourceUrl:k.scheduleSourceUrl,scheduleObservedAt:k.scheduleObservedAt,coreEventSourceUrl:k.coreEventSourceUrl||null,payload,warnings:['Exact summary score recovered from a verified core event or archived schedule; unverified summary market offers excluded.']};
    await archive(board);recovered.push(board);
   }catch(e){failures.push({gameId:String(k.event.id),sourceUrl,error:e.message});}
  }
 }));
 recovered.sort((a,b)=>a.date.localeCompare(b.date)||a.sourceUrl.localeCompare(b.sourceUrl));
 return {boards:recovered,failures,knownGames:known.length,requested:missing.length};
}
