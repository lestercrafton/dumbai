/** Freeze the Sep 26 missing-market research cohort from ESPN event identities.
 * This script never writes the pregame forecast or bankroll tables.
 */
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';

const date='2026-09-26',compact=date.replaceAll('-','');
const site='https://big-vin-grind-to-win.sunlightisfree.chatgpt.site';
const coreUrls=[80,81].map(group=>`https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/events?dates=${compact}&limit=1000&groups=${group}`);
const read=async url=>{const response=await fetch(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error(`${new URL(url).host} HTTP ${response.status}`);return response.json();};
const board=await read(`${site}/api/slate?sport=cfb&date=${date}&days=1`);
if(board.sport!=='cfb'||board.date!==date||!Array.isArray(board.games))throw new Error('Unexpected Site board.');
if(board.model?.asOf!==date||!board.modelVersion||!board.model?.ratings||!board.model?.teamGames)throw new Error('No date-locked Site rating model.');
const saved=await read(`${site}/api/results?sport=cfb&cohort=live&version=${encodeURIComponent(board.modelVersion)}&week=2026-09-21`);
if(saved.sport!=='cfb'||saved.cohort!=='live'||saved.version!==board.modelVersion||!Array.isArray(saved.records))throw new Error('Unexpected saved pregame record.');
const savedBeforeKickoff=new Set(saved.records.filter(record=>record.gameId&&Number.isFinite(Date.parse(record.capturedAt))&&Number.isFinite(Date.parse(record.startTime))&&Date.parse(record.capturedAt)<Date.parse(record.startTime)).map(record=>String(record.gameId)));
const boardById=new Map(board.games.map(game=>[String(game.id),game]));
const lists=await Promise.all(coreUrls.map(read));
const ids=[...new Set(lists.flatMap(list=>(list.items||[]).map(item=>String(item.$ref||'').match(/\/events\/(\d+)/)?.[1]).filter(Boolean)))].sort();
if(ids.length<boardById.size||ids.some(id=>!/^[0-9]{6,12}$/.test(id)))throw new Error('Incomplete core event enumeration.');
const selected=ids.filter(id=>!savedBeforeKickoff.has(id));
const savedBeforeKickoffOnDate=ids.length-selected.length;
let index=0;
const rows=[];
await Promise.all(Array.from({length:8},async()=>{
 while(index<selected.length){const id=selected[index++];const sourceUrl=`https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=${id}`;
  const summary=await read(sourceUrl),header=summary.header,competition=header?.competitions?.[0];
  if(String(header?.id)!==id||!competition)throw new Error(`Summary identity mismatch: ${id}`);
  const home=competition.competitors?.find(team=>team.homeAway==='home'),away=competition.competitors?.find(team=>team.homeAway==='away');
  if(!home?.team?.id||!away?.team?.id||!Number.isFinite(Date.parse(competition.date)))throw new Error(`Incomplete summary: ${id}`);
  const onBoard=boardById.get(id),previousIds=onBoard?[String(onBoard.home?.id),String(onBoard.away?.id)]:null;
  if(previousIds&&(previousIds[0]!==String(home.team.id)||previousIds[1]!==String(away.team.id)))throw new Error(`Board/summary teams differ: ${id}`);
  const quote=(summary.pickcenter||[]).find(offer=>offer.pointSpread?.home?.close?.line!=null);
  const homeLine=Number(quote?.pointSpread?.home?.close?.line),awayLine=Number(quote?.pointSpread?.away?.close?.line);
  const lateMarketHomeSpread=Number.isFinite(homeLine)&&Number.isFinite(awayLine)&&Math.abs(homeLine+awayLine)<0.01?homeLine:null;
  const score=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))?Number(value):null;
  const completed=competition.status?.type?.completed===true&&competition.status?.type?.state==='post';
  rows.push({id,date,category:!onBoard?'omitted-from-board':onBoard.market?.homeSpread==null?'no-market-on-board':'priced-without-saved-forecast',startTime:new Date(competition.date).toISOString(),neutralSite:competition.neutralSite===true,
   home:{id:String(home.team.id),name:home.team.displayName||home.team.name||onBoard?.home?.name||'Home team',abbreviation:home.team.abbreviation||onBoard?.home?.abbreviation||null},
   away:{id:String(away.team.id),name:away.team.displayName||away.team.name||onBoard?.away?.name||'Away team',abbreviation:away.team.abbreviation||onBoard?.away?.abbreviation||null},
   capturedStatus:completed?'completed':competition.status?.type?.state==='in'?'live':'scheduled',
   capturedHomeScore:completed?score(home.score):null,capturedAwayScore:completed?score(away.score):null,
   lateMarketHomeSpread,lateMarketProvider:lateMarketHomeSpread!==null?(quote.provider?.displayName||quote.provider?.name||'ESPN summary'):null,
   sourceUrl,sourceRetrievedAt:new Date().toISOString()});
 }
}));
rows.sort((a,b)=>a.startTime.localeCompare(b.startTime)||a.id.localeCompare(b.id));
const capturedAt=new Date().toISOString();
const fixture={date,capturedAt,boardRetrievedAt:board.retrievedAt,boardGames:boardById.size,coreDiscovered:ids.length,savedBeforeKickoff:savedBeforeKickoffOnDate,coreSourceUrls:coreUrls,
 modelVersion:board.modelVersion,model:board.model,
 cohortRule:'Every ESPN core event on this date without a saved before-kickoff forecast in the tuned live record, including no-market, omitted, and priced-but-unsaved games.',
 games:rows};
const target=fileURLToPath(new URL('../lib/college-experiment-cohort-2026-09-26.json',import.meta.url));
fs.writeFileSync(target,JSON.stringify(fixture)+'\n');
console.log(JSON.stringify({target,capturedAt,coreDiscovered:ids.length,boardGames:boardById.size,savedBeforeKickoff:savedBeforeKickoffOnDate,selected:rows.length,noMarket:rows.filter(row=>row.category==='no-market-on-board').length,omitted:rows.filter(row=>row.category==='omitted-from-board').length,pricedButUnsaved:rows.filter(row=>row.category==='priced-without-saved-forecast').length,lateMarket:rows.filter(row=>row.lateMarketHomeSpread!==null).length,finals:rows.filter(row=>row.capturedStatus==='completed').length}));
