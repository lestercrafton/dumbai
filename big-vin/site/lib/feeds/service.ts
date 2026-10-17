import {refreshLiveResults} from '../live-results';
import {replayBankroll} from '../bankroll.mjs';
import {sportsDay} from '../time';
import {cached,db} from '../db';
import {parseCsv,fetchScoreboard,SPORT_PATHS,isThreeDayScoreboardWindow} from './adapter.mjs';
import {fitRatings,projectCollegeGame,projectGame} from '../ratings.mjs';
import {readForecastRecords} from '../result-store';
import {gradeForecast,MODEL_VERSION} from '../results.mjs';
import {modelSpec,modelLabel,eligibleForModel,historicalModelSpecs} from '../model-versions';
import {historyModelForGame} from '../tracked-history.mjs';
import {savedBoardHistory,canProjectUncapturedGame} from '../saved-board-history.mjs';
import {mergeSavedBoard,rangeDates} from '../collector-sources.mjs';
import {hasLimitedData} from '../ranking.mjs';
const DAY=86400000;
const NFL_URL='https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
const num=(v:unknown)=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))?Number(v):null;
const NFL_ALIAS:Record<string,string>={LA:'LAR',STL:'LAR',SD:'LAC',OAK:'LV',JAC:'JAX',WSH:'WAS'};
const nflId=(id:string)=>NFL_ALIAS[id]||id;
export const day=(ms:number)=>new Date(ms).toISOString().slice(0,10);
async function textAt(url:string){const r=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw new Error(`Data source returned ${r.status}`);return r.text();}
export async function persistBoard(sport:string,board:any,startDate:string,endDate:string,coveredDates?:string[]){
 const rows=[];
 const dates=coveredDates||rangeDates(startDate,endDate);
 const keys=dates.map(date=>`trusted-board:${sport}:${date}`);
 if(!keys.length)return;
 const saved=await db().prepare(`SELECT key,payload FROM feed_cache WHERE key IN (${keys.map(()=>'?').join(',')})`).bind(...keys).all<{key:string,payload:string}>();
 const previous=new Map(saved.results.map(r=>[r.key,JSON.parse(r.payload)]));
 const observed=new Set(board.games.map((g:any)=>g.id));
 for(const date of dates){
  const old=previous.get(`trusted-board:${sport}:${date}`);
  const value=mergeSavedBoard(old?{...old,games:old.games.filter((g:any)=>!observed.has(g.id))}:null,{...board,games:board.games.filter((g:any)=>g.startTime&&sportsDay(g.startTime)===date)});
  rows.push(db().prepare('INSERT INTO feed_cache (key,payload,fetched_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,fetched_at=excluded.fetched_at').bind(`trusted-board:${sport}:${date}`,JSON.stringify(value),board.retrievedAt));
 }
 for(let i=0;i<rows.length;i+=40)await db().batch(rows.slice(i,i+40));
}
export async function scoreboard(sport:string,startDate:string,endDate=startDate){
 try{
  const version=sport==='cfb'?'board:v5-supported-limit':isThreeDayScoreboardWindow({startDate,endDate})?'board:v4-daily':'board:v3';
  const board:any=await cached(`${version}:${sport}:${startDate}:${endDate}`,300,()=>fetchScoreboard(sport,{startDate,endDate}));
  if(!board.partialLiveCoverage)return board;
  const keys=rangeDates(startDate,endDate).map(date=>`trusted-board:${sport}:${date}`);
  try{const saved=await db().prepare(`SELECT payload FROM feed_cache WHERE key IN (${keys.map(()=>'?').join(',')})`).bind(...keys).all<{payload:string}>();
   return mergeSavedBoard({games:saved.results.flatMap(row=>JSON.parse(row.payload).games||[])},board);
  }catch(error){console.error('Saved board merge failed',error);return board;}
 }
 catch(e){
  console.error('Live scoreboard failed; using saved observations',e);
  const snapshots:any=await import('./current-snapshots.json').then(m=>m.default);const snap=sport==='wnba'?(await import('./wnba-snapshot.json')).default:snapshots[sport];if(!snap)throw e;
  const keys=[];for(let ms=Date.parse(startDate+'T00:00:00Z');ms<=Date.parse(endDate+'T00:00:00Z');ms+=DAY)keys.push(`trusted-board:${sport}:${day(ms)}`);
  const saved=await db().prepare(`SELECT key,payload FROM feed_cache WHERE key IN (${keys.map(()=>'?').join(',')})`).bind(...keys).all<{key:string,payload:string}>();
  const covered=new Set(saved.results.map(r=>r.key.split(':').at(-1)));
  const boards=saved.results.map(r=>JSON.parse(r.payload));
  const games=[...snap.games.filter((g:any)=>g.startTime&&!covered.has(sportsDay(g.startTime))&&sportsDay(g.startTime)>=startDate&&sportsDay(g.startTime)<=endDate),...boards.flatMap(b=>b.games)];
  return {...snap,offlineSnapshot:true,retrievedAt:boards.map(b=>b.retrievedAt).sort().at(-1)||snap.retrievedAt,warnings:[...new Set(['Server feed unavailable. Showing the latest saved observations; browser refresh attempts the current feed.',...boards.flatMap(b=>b.warnings||[])])],games};
 }
}
async function nflHistory(){return cached('nfl:history',21600,async()=>{const retrievedAt=new Date().toISOString();const rows=parseCsv(await textAt(NFL_URL));return {retrievedAt,sourceUrl:NFL_URL,source:'nflverse game data',warnings:[],games:rows.filter((r:any)=>Number(r.season)>=2015).map((r:any)=>({id:r.game_id,date:r.gameday,homeId:nflId(r.home_team),awayId:nflId(r.away_team),homeScore:num(r.home_score),awayScore:num(r.away_score),neutral:r.location==='Neutral',restDiff:Math.max(-7,Math.min(7,(num(r.home_rest)??7)-(num(r.away_rest)??7))),season:Number(r.season),week:Number(r.week)}))};});}
export async function persistFinals(sport:string,boards:any[]){
 const games=boards.flatMap(b=>b.games||[]).filter(g=>g.completed&&g.seasonType!==1&&!g.modelExcludedReason&&g.startTime&&Date.parse(g.startTime)<Date.now()).map(canonical);
 // Timestamp + teams preserves baseball doubleheaders across differing provider IDs.
 const unique=new Map(games.map(g=>[`${sport}:${g.startTime||g.date}:${g.homeId}:${g.awayId}`,g]));
 const items=[...unique.entries()];for(let i=0;i<items.length;i+=80)await db().batch(items.slice(i,i+80).map(([key,g])=>db().prepare('INSERT INTO completed_games (key,sport,payload,observed_at) VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,observed_at=excluded.observed_at').bind(key,sport,JSON.stringify(g),new Date().toISOString())));
}
export async function history(sport:string){
 let seed:any;
 if(sport==='nfl'){try{seed=await nflHistory();}catch{seed={...(await import('./nfl-history.json')).default,warnings:['NFL server refresh unavailable; using the dated snapshot plus captured finals.']};}}
 else if(sport==='wnba')seed=(await import('./wnba-history.json')).default;
 else {const seeds:any=await import('./histories.json').then(m=>m.default);seed=seeds[sport];if(!seed)throw new Error('No verified historical data is available for this sport.');}
 const rows=await db().prepare('SELECT payload,observed_at FROM completed_games WHERE sport=?').bind(sport).all<{payload:string,observed_at:string}>();
 const keyed=new Map(seed.games.map((g:any)=>[`${g.startTime||g.date}:${g.homeId}:${g.awayId}`,g]));
 for(const row of rows.results){const g=JSON.parse(row.payload);
  if(sport==='nfl'){const existing:any=[...keyed.values()].find((x:any)=>x.homeId===g.homeId&&x.awayId===g.awayId&&Math.abs(Date.parse(x.date)-Date.parse(g.date))<=DAY);if(existing){keyed.delete(`${existing.startTime||existing.date}:${existing.homeId}:${existing.awayId}`);g.restDiff=existing.restDiff;g.date=existing.date;}}
  keyed.set(`${g.startTime||g.date}:${g.homeId}:${g.awayId}`,g);
 }
 return {...seed,games:[...keyed.values()],refreshedAt:rows.results.map(r=>r.observed_at).sort().at(-1)||seed.retrievedAt};
}
export function canonical(g:any){
 const id=(side:any)=>g.sport==='nfl'?nflId(side.abbreviation):g.sport==='mlb'?(side.key||side.abbreviation):side.id;
 return {id:g.id,seasonType:g.seasonType,startTime:g.startTime,date:g.sport==='nfl'?sportsDay(g.startTime):g.startTime?.slice(0,10),homeId:id(g.home),awayId:id(g.away),homeScore:g.homeScore,awayScore:g.awayScore,neutral:g.neutralSite===true,restDiff:0,marketHomeSpread:g.market?.homeSpread??null};
}
export async function getSlate(sport:string,date:string,suppliedBoard?:any,days=7,requestedVersion?:string){
 if(!Object.hasOwn(SPORT_PATHS,sport))throw new Error('Unsupported sport');
 try{await refreshLiveResults(sport);}catch(e){console.error('Slate finals check unavailable',e);}
 const endDate=day(Date.parse(date+'T00:00:00Z')+((days===1?1:days===3?3:7)-1)*DAY);
 const [board,hist,forecasts]=await Promise.all([suppliedBoard?Promise.resolve(suppliedBoard):scoreboard(sport,date,endDate),history(sport),readForecastRecords(sport)]);
 const now=sportsDay();const asOf=date<now?date:now;
 const registry=historicalModelSpecs(sport);
 const currentSpec=modelSpec(sport,requestedVersion);
 const historicalSpec=!requestedVersion?[...registry].reverse().find(candidate=>candidate.startDate<=date):null;
 const spec=requestedVersion?currentSpec:historicalSpec?{...historicalSpec,label:modelLabel(sport,historicalSpec.id)}:modelSpec(sport,MODEL_VERSION);
 const bankroll=replayBankroll(forecasts.filter(f=>f.cohort==='live'&&(f.modelVersion||MODEL_VERSION)===spec.id));
 const model=fitRatings(hist.games,{sport,asOf,parameters:spec.parameters||undefined});
 const baseline=spec.id===MODEL_VERSION?model:fitRatings(hist.games,{sport,asOf});
 const modelsByVersion=new Map<string,any>([[spec.id,model],[MODEL_VERSION,baseline]]);
 const modelForGame=(gameSpec:any)=>{
  if(!modelsByVersion.has(gameSpec.id))modelsByVersion.set(gameSpec.id,fitRatings(hist.games,{sport,asOf,parameters:gameSpec.parameters||undefined}));
  return modelsByVersion.get(gameSpec.id);
 };
 const bankrolls=new Map<string,any>([[spec.id,bankroll]]);
 const savedBankroll=(forecast:any)=>{
  const version=forecast.modelVersion||MODEL_VERSION;
  if(!bankrolls.has(version))bankrolls.set(version,replayBankroll(forecasts.filter(f=>f.cohort==='live'&&(f.modelVersion||MODEL_VERSION)===version)));
  return bankrolls.get(version).plays[forecast.id]??null;
 };
 const inWindow=(g:any)=>g.startTime&&sportsDay(g.startTime)>=date&&sportsDay(g.startTime)<=endDate;
 const saved=new Map<string,any>();
 const tracked=!requestedVersion?savedBoardHistory(forecasts,{sport,models:registry,date,days}):null;
 const savedPriority=(f:any)=>(f.modelVersion===spec.id?0:10)+(f.cohort==='live'?0:f.cohort==='recovered'?1:2);
 if(tracked){for(const f of tracked.records)saved.set(f.gameId,f);}
 else for(const f of forecasts.filter(f=>['live','recovered','uncovered'].includes(f.cohort)&&inWindow(f)&&(f.cohort==='uncovered'||(f.modelVersion||MODEL_VERSION)===spec.id||((!eligibleForModel({...f,sport},spec)||Date.parse(f.startTime)<=Date.now())&&(f.modelVersion||MODEL_VERSION)===MODEL_VERSION))).sort((a,b)=>savedPriority(a)-savedPriority(b)))if(!saved.has(f.gameId))saved.set(f.gameId,f);
 const gameMap=new Map<string,any>(board.games.filter(inWindow).map((g:any)=>[g.id,g]));
 // Archived games stay visible when the current source omits a completed event.
 const coverageRecords=tracked?[...[...saved.values()].filter(inWindow),...forecasts.filter(f=>['live','recovered','uncovered'].includes(f.cohort)&&inWindow(f))]:[...saved.values()];
 for(const f of coverageRecords){const id=f.gameId;if(!gameMap.has(id))gameMap.set(id,{id,sport,startTime:f.startTime,season:f.season,seasonType:f.seasonType,week:f.week,home:{id:f.homeId,name:f.home},away:{id:f.awayId,name:f.away},status:f.result?.status==='completed'?'completed':f.result?.status==='void'?'cancelled':Date.parse(f.startTime)>Date.now()?'scheduled':'awaiting-update',completed:f.result?.status==='completed',homeScore:f.result?.homeScore,awayScore:f.result?.awayScore,sourceUrl:f.result?.sourceUrl||f.sourceUrl,retrievedAt:f.result?.observedAt||f.capturedAt,market:null});}
 const matches=[...gameMap.values()].map((g:any)=>{
  const f=saved.get(g.id);const base=canonical(g);const eligible=eligibleForModel(g,spec);
  const gameSpec=tracked?historyModelForGame({...g,sport},registry):eligible?spec:modelSpec(sport,MODEL_VERSION);
  const gameVersion=f?.modelVersion||gameSpec.id;
  if(sport==='nfl'){const match=hist.games.find((h:any)=>h.homeId===base.homeId&&h.awayId===base.awayId&&Math.abs(Date.parse(h.date)-Date.parse(base.date))<=DAY);base.restDiff=match?.restDiff??0;}
  if(f?.result?.status==='completed'&&!g.completed)g={...g,status:'completed',completed:true,homeScore:f.result.homeScore,awayScore:f.result.awayScore};
  if(g.status==='scheduled'&&Date.parse(g.startTime)<=Date.now())g={...g,status:'awaiting-update'};
  const archived=!!f&&Number.isFinite(f.predictedMargin);
  const paper=f?.paperWager??null;
  const market=archived?Number.isFinite(f.marketHomeSpread)?{provider:f.provider||'Saved market',homeSpread:f.marketHomeSpread,awaySpread:-f.marketHomeSpread,homeSpreadPrice:f.side==='home'?f.odds:null,awaySpreadPrice:f.side==='away'?f.odds:null,observedAt:f.marketObservedAt}:paper?{provider:paper.kind==='archived-opening-spread'?'DraftKings opener':'Paper pick’em',homeSpread:paper.homeSpread,awaySpread:-paper.homeSpread,homeSpreadPrice:paper.side==='home'?paper.odds:null,awaySpreadPrice:paper.side==='away'?paper.odds:null,observedAt:paper.retrievedAt}:null:g.market;
  const project=sport==='cfb'?projectCollegeGame:projectGame;
  const projection=archived?{...f.projection,predictedHomeMargin:f.predictedMargin,fairHomeSpread:-f.predictedMargin,homeEdgePoints:Number.isFinite(f.marketHomeSpread)?f.predictedMargin+f.marketHomeSpread:paper?.kind==='archived-opening-spread'?f.predictedMargin+paper.homeSpread:null,homeAdvantage:f.homeAdvantage??f.projection?.homeAdvantage}:canProjectUncapturedGame(g)?project(base,tracked?modelForGame(gameSpec):eligible?model:baseline):null;
  // A score refresh must not introduce a second, moving line next to the pick.
  // Saved forecasts stay fixed; new history is used for new captures only.
  const stale=!archived&&!!market&&Date.now()-Date.parse(market.observedAt)>30*60*1000;
  const homeEdge=projection?.homeEdgePoints;
  const edge=Number.isFinite(homeEdge)?Math.abs(homeEdge):null;
  const side=tracked&&archived?f.side:paper?.side??(homeEdge==null||homeEdge===0?null:homeEdge>0?'home':'away');
  const lowEvidence=hasLimitedData({sport,projection});
  return {...g,bankroll:f?tracked?savedBankroll(f):bankroll.plays[f.id]??null:null,paperWager:paper,modelVersion:gameVersion,modelLabel:modelLabel(sport,gameVersion),market,projection,edge,side,stale,lowEvidence,rank:null,originalRank:f?.rank??null,historyCardRank:tracked?f?.cardRank??null:null,historyRankBasis:tracked&&f?'Saved-input card rank before exclusions':null,forecastCohort:f?.cohort??null,forecastOrigin:f?.origin??null,forecastCapturedAt:f?.capturedAt??null,reconstructedAt:f?.reconstructedAt??null,modelCapturedAt:f?.modelCapturedAt??null,firstMarket:f?.firstMarket??null,modelAsOf:f?.trainingCutoff??asOf,archived,result:f?tracked?f.result??null:gradeForecast(f,g)||f.result||null:null,rankReason:lowEvidence?'Picks with limited data':edge!==null&&!stale?null:paper?.kind==='synthetic-winner-even'?'Paper winner pick · no book line':stale?'Stale market snapshot':!projection?(g.modelExcludedReason||'No saved pregame forecast'):'No saved market line'};
 });
 matches.sort((a:any,b:any)=>(a.lowEvidence?1:0)-(b.lowEvidence?1:0)||(b.edge??-1)-(a.edge??-1)||String(a.startTime).localeCompare(String(b.startTime))||a.id.localeCompare(b.id));
 let rank=0;for(const g of matches)if(g.edge!==null&&!g.stale&&!g.lowEvidence)g.rank=++rank;
 return {sport,date,endDate,asOf,seasonContext:board.seasonContext??null,modelVersion:spec.id,modelLabel:spec.label,tuning:spec.parameters?spec:null,retrievedAt:board.retrievedAt,offlineSnapshot:board.offlineSnapshot===true,partialLiveCoverage:board.partialLiveCoverage===true,sourceUrl:board.sourceUrl,warnings:[...board.warnings,...hist.warnings],historySource:hist.sourceUrl,historyRetrievedAt:hist.retrievedAt,historyRefreshedAt:hist.refreshedAt??hist.retrievedAt,model,games:matches};
}
