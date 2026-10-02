import {normalizeScoreboard} from './feeds/adapter.mjs';

const base='https://sports.core.api.espn.com/v2/sports/football/leagues/college-football';
const easternDay=value=>new Date(value).toLocaleDateString('en-CA',{timeZone:'America/New_York'});
const id=value=>/^\d+$/.test(String(value))?String(value):null;
const numeric=value=>typeof value==='number'&&Number.isFinite(value)?value:typeof value==='string'&&/^[+-]?\d+(?:\.\d+)?$/.test(value.trim())?Number(value):null;
const american=value=>{const n=numeric(value);return n!==null&&Number.isInteger(n)&&Math.abs(n)>=100?n:null;};
function referencePath(value){
 try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&url.hostname==='sports.core.api.espn.com'?url.pathname:null;}catch{return null;}
}
function identity(event){
 const competition=event?.competitions?.[0];
 const competitors=competition?.competitors;
 if(!id(event?.id)||!id(competition?.id)||!Array.isArray(competitors)||competitors.length!==2)return null;
 const home=competitors.find(c=>c.homeAway==='home'),away=competitors.find(c=>c.homeAway==='away');
 if(!id(home?.team?.id)||!id(away?.team?.id)||String(home.team.id)===String(away.team.id))return null;
 return {eventId:String(event.id),competitionId:String(competition.id),homeId:String(home.team.id),awayId:String(away.team.id),season:Number(event.season?.year),competition};
}
function pregame(event,observedAt,now){
 const start=Date.parse(event?.date),observed=Date.parse(observedAt);
 const status={...event?.competitions?.[0]?.status?.type,...event?.status?.type};
 return Number.isFinite(start)&&start>now+60000&&Number.isFinite(observed)&&observed<=now+5000&&now-observed<=30*60000&&status.state==='pre'&&status.completed!==true&&!/cancel|postpon|suspend|delay/i.test(`${status.name||''} ${status.description||''}`);
}

/** Only explicit CURRENT, reciprocal, identity-bound prices are eligible.
 * Open/closing quotes and generic unsigned spread fields are never substituted.
 */
export function adaptCurrentCoreOdds(payload,event,{observedAt=new Date().toISOString(),now=Date.now()}={}){
 const known=identity(event);
 if(!known||!pregame(event,observedAt,now))return [];
 if(!Array.isArray(payload?.items)||payload.count!==payload.items.length||payload.pageCount!==1||payload.pageIndex!==1)return [];
 const eventPath=`/v2/sports/football/leagues/college-football/events/${known.eventId}/competitions/${known.competitionId}/odds/`;
 return payload.items.flatMap(offer=>{
  const providerId=id(offer?.provider?.id);
  if(!providerId||referencePath(offer.$ref)!==eventPath+providerId)return [];
  for(const [side,teamId] of [['home',known.homeId],['away',known.awayId]]){
   const odds=offer[side+'TeamOdds'];
   if(referencePath(odds?.team?.$ref)!==`/v2/sports/football/leagues/college-football/seasons/${known.season}/teams/${teamId}`)return [];
  }
  const home=offer.homeTeamOdds.current,away=offer.awayTeamOdds.current;
  const homeLine=numeric(home?.pointSpread?.american),awayLine=numeric(away?.pointSpread?.american);
  const homePrice=american(home?.spread?.american),awayPrice=american(away?.spread?.american);
  if(homeLine===null||awayLine===null||Math.abs(homeLine+awayLine)>1e-9||homePrice===null||awayPrice===null)return [];
  // If ESPN supplies a provider timestamp, it must also be a pregame observation.
  const updated=offer.lastUpdated??offer.lastUpdate;
  if(updated&&(!Number.isFinite(Date.parse(updated))||Date.parse(updated)>now+5000||Date.parse(updated)>=Date.parse(event.date)))return [];
  return [{provider:{id:providerId,name:offer.provider.name},lastUpdated:updated??null,pointSpread:{home:{close:{line:homeLine,odds:homePrice}},away:{close:{line:awayLine,odds:awayPrice}}}}];
 });
}

/** Fill only uncaptured pregame spreads from the exact event's live core odds.
 * Historical summary recovery remains score-only. Each quote gets its own
 * retrieval time/source archive and does not replace the frozen model margin.
 */
export async function captureCurrentCollegeMarkets(boards,read,archive=()=>{},{now=Date.now}={}){
 const events=new Map();
 for(const board of boards)for(const event of board.payload?.events||[]){
  const key=String(event.id),previous=events.get(key);
  const group=board.sourceGroup||new URL(board.sourceUrl).searchParams.get('groups');
  const game=normalizeScoreboard({events:[event]},'cfb',{retrievedAt:board.observedAt,sourceUrl:board.sourceUrl}).games[0];
  const priced=game?.markets?.some(m=>m.homeSpread!==null&&m.homeSpreadPrice!==null&&m.awaySpreadPrice!==null);
  if(previous?.priced)continue;
  events.set(key,{event,board,group,priced});
 }
 const candidates=[...events.values()].filter(k=>!k.priced&&['80','81'].includes(k.group)&&identity(k.event)&&pregame(k.event,k.board.observedAt,now()));
 const captured=[],failures=[],unavailable=[];let index=0;
 await Promise.all(Array.from({length:Math.min(4,candidates.length)},async()=>{
  while(index<candidates.length){
   const k=candidates[index++],known=identity(k.event);
   const sourceUrl=`${base}/events/${known.eventId}/competitions/${known.competitionId}/odds?lang=en&region=us`;
   try{
    const rawOdds=await read(sourceUrl),observedAt=new Date(now()).toISOString();
    const odds=adaptCurrentCoreOdds(rawOdds,k.event,{observedAt,now:now()});
    if(!odds.length){unavailable.push({gameId:known.eventId,sourceUrl});continue;}
    const payload={events:[{...k.event,competitions:[{...known.competition,odds}]}]};
    const board={date:easternDay(k.event.date),sourceUrl,observedAt,sourceGroup:k.group,scheduleSourceUrl:k.board.scheduleSourceUrl||k.board.sourceUrl,scheduleObservedAt:k.board.scheduleObservedAt||k.board.observedAt,payload,rawOdds,warnings:[]};
    await archive(board);captured.push(board);
   }catch(error){failures.push({gameId:known.eventId,sourceUrl,error:error.message});}
  }
 }));
 captured.sort((a,b)=>a.date.localeCompare(b.date)||a.sourceUrl.localeCompare(b.sourceUrl));
 return {boards:captured,requested:candidates.length,failures,unavailable};
}
