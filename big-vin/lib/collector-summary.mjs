import fs from 'node:fs';
import path from 'node:path';

const easternDay=value=>new Date(value).toLocaleDateString('en-CA',{timeZone:'America/New_York'});
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
 if(String(header?.id)!==String(known.event.id)||!competition||teams(competition)!==teams(known.event.competitions?.[0]))throw new Error('Summary game/team identity did not match its archived schedule.');
 if(!Number.isFinite(Date.parse(competition.date)))throw new Error('Summary has no valid game date.');
 return {events:[{...header,date:competition.date,week:{number:header.week},competitions:[{...competition,odds:Array.isArray(summary.pickcenter)?summary.pickcenter:[]}]}]};
}
export async function recoverCollegeEvents(boards,known,read,archive=()=>{}) {
 const missing=known.filter(k=>!boards.some(b=>(new URL(b.sourceUrl).searchParams.get('groups')===k.sourceGroup)&&b.payload.events.some(e=>String(e.id)===String(k.event.id))));
 const recovered=[],failures=[];let index=0;
 await Promise.all(Array.from({length:Math.min(4,missing.length)},async()=>{
  while(index<missing.length) {
   const k=missing[index++];const sourceUrl=`https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=${k.event.id}`;
   try {
    const summary=await read(sourceUrl);const payload=adaptEventSummary(summary,k);
    const board={date:easternDay(payload.events[0].date),sourceUrl,observedAt:new Date().toISOString(),sourceGroup:k.sourceGroup,scheduleSourceUrl:k.scheduleSourceUrl,scheduleObservedAt:k.scheduleObservedAt,payload,rawSummary:summary,warnings:['Known omitted game refreshed individually; newly added games may still be missing from the capped schedule feed.']};
    await archive(board);recovered.push(board);
   }catch(e){failures.push({gameId:String(k.event.id),sourceUrl,error:e.message});}
  }
 }));
 recovered.sort((a,b)=>a.date.localeCompare(b.date)||a.sourceUrl.localeCompare(b.sourceUrl));
 return {boards:recovered,failures,knownGames:known.length,requested:missing.length};
}
