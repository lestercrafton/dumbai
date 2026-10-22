import {refreshLiveResults} from '../live-results';
import {replayBankroll} from '../bankroll.mjs';
import {sportsDay} from '../time';
import {cached,db} from '../db';
import {parseCsv,fetchScoreboard,SPORT_PATHS,isThreeDayScoreboardWindow} from './adapter.mjs';
import {fitRatings,projectCollegeGame,projectGame} from '../ratings.mjs';
import {readForecastRecords,saveForecasts} from '../result-store';
import {gradeForecast,MODEL_VERSION,reportingWeek} from '../results.mjs';
import {capturePickRevisions,pickStates} from '../pick-revision-store';
import {withPickState,actionablePick,spreadSelection,quotePrices} from '../pick-revisions.mjs';
import {modelSpec,modelLabel,eligibleForModel,historicalModelSpecs} from '../model-versions';
import {historyModelForGame} from '../tracked-history.mjs';
import {savedBoardHistory,canProjectUncapturedGame} from '../saved-board-history.mjs';
import {mergeSavedBoard,rangeDates} from '../collector-sources.mjs';
import {hasLimitedData} from '../ranking.mjs';
import {learnRankSignal,scoreGame,compareSignal,rankLabel} from '../rank-signal.mjs';
import {INJURY_TABLE_URL,INJURY_SPORTS,gameInjury,liveMargin} from '../injury-lines.mjs';
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
  const today=sportsDay();
  const cacheSeconds=startDate<=today&&endDate>=today?60:300;
  const board:any=await cached(`${version}:${sport}:${startDate}:${endDate}`,cacheSeconds,()=>fetchScoreboard(sport,{startDate,endDate}));
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
/** Over/under experiment summary, built hourly on GitHub Actions; separate from the spread record. */
export async function totalsTable(sport:string){
 if(!['nfl','cfb','nba','wnba','cbb'].includes(sport))return null;
 try{return await cached<any>('totals:'+sport,600,async()=>{const r=await fetch(`https://raw.githubusercontent.com/lestercrafton/dumbai/main/big-vin/data/totals/${sport}.json`,{signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error(`Totals table returned ${r.status}`);return r.json();});}
 catch(e){console.error('Totals table unavailable',e);return null;}
}
/** Injury table built on GitHub Actions; a missing table means no adjustment, never an error. */
export async function injuryTable(sport:string){
 if(!INJURY_SPORTS.has(sport))return null;
 try{return await cached('injury-lines:'+sport,600,async()=>{const r=await fetch(INJURY_TABLE_URL,{signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error(`Injury table returned ${r.status}`);return r.json();});}
 catch(e){console.error('Injury table unavailable',e);return null;}
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
export async function getSlate(sport:string,date:string,suppliedBoard?:any,days=7,requestedVersion?:string,trustedBoard=!suppliedBoard){
 if(!Object.hasOwn(SPORT_PATHS,sport))throw new Error('Unsupported sport');
 try{await refreshLiveResults(sport);}catch(e){console.error('Slate finals check unavailable',e);}
 const endDate=day(Date.parse(date+'T00:00:00Z')+((days===1?1:days===3?3:7)-1)*DAY);
 const [board,hist,rawForecasts,injuries,totals]=await Promise.all([suppliedBoard?Promise.resolve(suppliedBoard):scoreboard(sport,date,endDate),history(sport),readForecastRecords(sport,false),injuryTable(sport),totalsTable(sport)]);
 const injuryFor=(g:any)=>{const c=canonical({...g,sport});return gameInjury(injuries,sport,c.homeId,c.awayId);};
 let forecasts=rawForecasts;
 const signal=learnRankSignal(rawForecasts);
 const now=sportsDay();const asOf=date<now?date:now;
 const registry=historicalModelSpecs(sport);
 const currentSpec=modelSpec(sport,requestedVersion);
 const historicalSpec=!requestedVersion?[...registry].reverse().find(candidate=>candidate.startDate<=date):null;
 const spec=requestedVersion?currentSpec:historicalSpec?{...historicalSpec,label:modelLabel(sport,historicalSpec.id)}:modelSpec(sport,MODEL_VERSION);
 const model=fitRatings(hist.games,{sport,asOf,parameters:spec.parameters||undefined});
 const baseline=spec.id===MODEL_VERSION?model:fitRatings(hist.games,{sport,asOf});
 const modelsByVersion=new Map<string,any>([[spec.id,model],[MODEL_VERSION,baseline]]);
 const modelForGame=(gameSpec:any)=>{
  if(!modelsByVersion.has(gameSpec.id))modelsByVersion.set(gameSpec.id,fitRatings(hist.games,{sport,asOf,parameters:gameSpec.parameters||undefined}));
  return modelsByVersion.get(gameSpec.id);
 };
 // Only server observations can create a prospective tracked pick. A public
 // browser POST remains a preview and cannot write picks or revisions.
 if(trustedBoard&&!board.offlineSnapshot){
  if(!requestedVersion){
   const ids=new Set(forecasts.map(f=>f.id));
   const initial=board.games.flatMap((g:any)=>{
    if(!canProjectUncapturedGame(g,Date.now()+60000))return [];
    const gameSpec=historyModelForGame({...g,sport},registry),id=`${gameSpec.id}:${sport}:${g.id}`;
    if(ids.has(id))return [];
    const base=canonical(g),fitted=modelForGame(gameSpec);
    if(sport==='nfl'){const match=hist.games.find((h:any)=>h.homeId===base.homeId&&h.awayId===base.awayId&&Math.abs(Date.parse(h.date)-Date.parse(base.date))<=DAY);base.restDiff=match?.restDiff??0;}
    const projection:any=(sport==='cfb'?projectCollegeGame:projectGame)(base,fitted);
    if(!Number.isFinite(projection?.predictedHomeMargin))return [];
    const capturedAt=new Date().toISOString(),q=g.market;
    const fresh=q?.timing==='current-displayed-snapshot'&&Number.isFinite(q.homeSpread)&&Date.parse(q.observedAt)<=Date.parse(capturedAt)&&Date.parse(capturedAt)-Date.parse(q.observedAt)<=1800000;
    const injury=injuryFor(g),live=liveMargin({sport,baseMargin:projection.predictedHomeMargin,homeSpread:fresh?q.homeSpread:null,injury});
    const selection=spreadSelection(live.margin,fresh?q.homeSpread:null,quotePrices(sport,q));
    return [{id,gameId:g.id,sport,season:g.season,seasonType:g.seasonType,postseason:g.postseason??null,week:g.week,weekKey:reportingWeek(g),cohort:'live',origin:'collector',startTime:g.startTime,capturedAt,
     rank:null,rankBasis:'First server pregame capture',projection,ratingCoverage:projection.ratingCoverage??null,home:g.home.name,away:g.away.name,homeId:base.homeId,awayId:base.awayId,
     predictedMargin:live.margin,...(live.margin!==projection.predictedHomeMargin?{baseMargin:projection.predictedHomeMargin}:{}),...(injury?{injuryAdjustment:live.injuryAdjustment,injury}:{}),...(live.marketCheck?{marketCheck:live.marketCheck}:{}),marketHomeSpread:fresh?q.homeSpread:null,marketHomePrice:fresh?q.homeSpreadPrice??null:null,marketAwayPrice:fresh?q.awaySpreadPrice??null:null,side:selection.side,odds:selection.side==='home'?q.homeSpreadPrice:selection.side==='away'?q.awaySpreadPrice:null,
     marketObservedAt:fresh?q.observedAt:null,provider:fresh?q.provider:null,sourceUrl:g.sourceUrl,trainingCutoff:asOf,modelVersion:gameSpec.id,parameters:fitted.config,homeAdvantage:fitted.homeAdvantage,restCoefficient:fitted.restCoefficient,trainingGames:fitted.trainingGames,lastTrainingDate:fitted.lastTrainingDate}];
   });
   // Saving is best effort: a failed write (e.g. the daily D1 limit) must never block the board.
   if(initial.length){try{await saveForecasts(initial,true);forecasts=await readForecastRecords(sport,false);}catch(error){console.error('Forecast capture skipped',error);}}
  }
  try{await capturePickRevisions(forecasts,board.games.map((g:any)=>({...g,homeId:canonical(g).homeId,awayId:canonical(g).awayId,injury:injuryFor(g)})));}catch(error){console.error('Pick revision capture skipped',error);}
 }
 const states=await pickStates(sport);
 forecasts=forecasts.map(f=>withPickState(f,states.get(f.id)));
 const bankroll=replayBankroll(forecasts.filter(f=>f.cohort==='live'&&(f.modelVersion||MODEL_VERSION)===spec.id));
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
 // An upcoming if-necessary playoff slot that a complete, server-fetched board for its
 // date no longer lists is shown as off the schedule with no pick, not as awaiting a
 // quote. Nothing is graded here; the final-score check voids it only after its start
 // time, and only with the series' official clinching final.
 const boardComplete=trustedBoard&&!board.offlineSnapshot&&board.partialLiveCoverage!==true;
 const offSchedule=(f:any)=>boardComplete&&f.postseason?.ifNecessary===true&&f.result==null;
 for(const f of coverageRecords){const id=f.gameId;if(!gameMap.has(id))gameMap.set(id,{id,sport,startTime:f.startTime,season:f.season,seasonType:f.seasonType,week:f.week,home:{id:f.homeId,name:f.home},away:{id:f.awayId,name:f.away},status:f.result?.status==='completed'?'completed':f.result?.status==='void'?'cancelled':Date.parse(f.startTime)>Date.now()?(offSchedule(f)?'not-on-schedule':'scheduled'):'awaiting-update',completed:f.result?.status==='completed',homeScore:f.result?.homeScore,awayScore:f.result?.awayScore,sourceUrl:f.result?.sourceUrl||f.sourceUrl,retrievedAt:f.result?.observedAt||f.capturedAt,market:null});}
 const withInjury=(p:any,g:any)=>{const injury=injuryFor(g);if(!injury||!Number.isFinite(p?.predictedHomeMargin))return p;const m=p.predictedHomeMargin+injury.homeDelta;return {...p,baseHomeMargin:p.predictedHomeMargin,injuryAdjustment:injury.homeDelta,injury,predictedHomeMargin:m,fairHomeSpread:-m,homeEdgePoints:p.marketHomeSpread===null?null:m+p.marketHomeSpread};};
 const matches=[...gameMap.values()].map((g:any)=>{
  const f=saved.get(g.id);const base=canonical(g);const eligible=eligibleForModel(g,spec);
  const gameSpec=tracked?historyModelForGame({...g,sport},registry):eligible?spec:modelSpec(sport,MODEL_VERSION);
  const gameVersion=f?.modelVersion||gameSpec.id;
  if(sport==='nfl'){const match=hist.games.find((h:any)=>h.homeId===base.homeId&&h.awayId===base.awayId&&Math.abs(Date.parse(h.date)-Date.parse(base.date))<=DAY);base.restDiff=match?.restDiff??0;}
  if(f?.result?.status==='completed'&&!g.completed)g={...g,status:'completed',completed:true,homeScore:f.result.homeScore,awayScore:f.result.awayScore};
  if(g.status==='scheduled'&&Date.parse(g.startTime)<=Date.now())g={...g,status:'awaiting-update'};
  const archived=!!f&&Number.isFinite(f.predictedMargin);
  const paper=f?.paperWager??null;
  const market=archived?Number.isFinite(f.marketHomeSpread)?{provider:f.provider||'Saved market',homeSpread:f.marketHomeSpread,awaySpread:-f.marketHomeSpread,homeSpreadPrice:f.marketHomePrice??(f.side==='home'?f.odds:null),awaySpreadPrice:f.marketAwayPrice??(f.side==='away'?f.odds:null),observedAt:f.marketObservedAt}:paper?{provider:paper.kind==='archived-opening-spread'?'DraftKings opener':'Paper pick’em',homeSpread:paper.homeSpread,awaySpread:-paper.homeSpread,homeSpreadPrice:paper.side==='home'?paper.odds:null,awaySpreadPrice:paper.side==='away'?paper.odds:null,observedAt:paper.retrievedAt}:null:g.market;
  const project=sport==='cfb'?projectCollegeGame:projectGame;
  const projection=archived?{...f.projection,predictedHomeMargin:f.predictedMargin,fairHomeSpread:-f.predictedMargin,homeEdgePoints:Number.isFinite(f.marketHomeSpread)?f.predictedMargin+f.marketHomeSpread:paper?.kind==='archived-opening-spread'?f.predictedMargin+paper.homeSpread:null,homeAdvantage:f.homeAdvantage??f.projection?.homeAdvantage}:canProjectUncapturedGame(g)?withInjury(project(base,tracked?modelForGame(gameSpec):eligible?model:baseline),g):null;
  const upcoming=g.status==='scheduled'&&Date.parse(g.startTime)>Date.now();
  const actionable=upcoming&&!!f&&actionablePick(f,{...g,homeId:base.homeId,awayId:base.awayId});
  const stale=upcoming?!actionable:!archived&&!!market&&Date.now()-Date.parse(market.observedAt)>30*60*1000;
  const homeEdge=projection?.homeEdgePoints;
  const edge=Number.isFinite(homeEdge)?Math.abs(homeEdge):null;
  const side=tracked&&archived?f.side:paper?.side??(homeEdge==null||homeEdge===0?null:spreadSelection(projection.predictedHomeMargin,market?.homeSpread,quotePrices(sport,market)).side);
  const lowEvidence=hasLimitedData({sport,projection});
  const rankSignal=edge!==null&&edge>0&&side&&market?scoreGame(signal,{sport,side,homeSpread:market.homeSpread,edge,odds:side==='home'?market.homeSpreadPrice:market.awaySpreadPrice}):null;
  // Keep the feed's ML quote and timestamp separate from the frozen ATS market.
  return {...g,bankroll:f?tracked?savedBankroll(f):bankroll.plays[f.id]??null:null,paperWager:paper,modelVersion:gameVersion,modelLabel:modelLabel(sport,gameVersion),market,moneylineMarket:g.market??null,projection,edge,rankSignal,rankLabel:rankLabel(rankSignal),side,stale,lowEvidence,rank:null,originalRank:f?.rank??null,historyCardRank:tracked?f?.cardRank??null:null,historyRankBasis:tracked&&f?'Original saved-input card rank before exclusions':null,forecastCohort:f?.cohort??null,forecastOrigin:f?.origin??null,forecastCapturedAt:f?.capturedAt??null,reconstructedAt:f?.reconstructedAt??null,modelCapturedAt:f?.modelCapturedAt??null,firstMarket:f?.firstMarket??null,modelAsOf:f?.trainingCutoff??asOf,archived,actionable,overUnder:totals?.games?.[g.id]?{...totals.games[g.id],record:totals.record}:null,injury:f?.injury??projection?.injury??null,injuryAdjustment:f?.injuryAdjustment??projection?.injuryAdjustment??null,baseMargin:f?.baseMargin??projection?.baseHomeMargin??null,marketCheck:f?.marketCheck??null,pickRevision:f?.pickRevision??null,pickRevisions:f?.pickRevisions??[],pickLock:f?.pickLock??null,originalPick:f?.originalPick??null,result:f?tracked?f.result??null:gradeForecast(f,g)||f.result||null:null,rankReason:g.status==='not-on-schedule'?'If-necessary playoff game no longer on the league schedule. No pick.':lowEvidence?'Picks with limited data':edge!==null&&!stale?side?null:'No spread edge':paper?.kind==='synthetic-winner-even'?'Paper winner pick · no book line':stale?'Current pregame quote unavailable':!projection?(g.modelExcludedReason||'No saved pregame forecast'):'No saved market line'};
 });
 matches.sort((a:any,b:any)=>(a.lowEvidence?1:0)-(b.lowEvidence?1:0)||compareSignal(a,b));
 // Every game gets a board rank; stale, review and limited-data cases only add a small note.
 let rank=0;for(const g of matches){if(g.marketCheck?.review&&g.status==='scheduled')g.rankReason='Marked for review: far from the market with no injury explanation.';g.rank=++rank;}
 return {sport,date,endDate,asOf,seasonContext:board.seasonContext??null,modelVersion:spec.id,modelLabel:spec.label,tuning:spec.parameters?spec:null,retrievedAt:board.retrievedAt,offlineSnapshot:board.offlineSnapshot===true,partialLiveCoverage:board.partialLiveCoverage===true,sourceUrl:board.sourceUrl,warnings:[...board.warnings,...hist.warnings],historySource:hist.sourceUrl,historyRetrievedAt:hist.retrievedAt,historyRefreshedAt:hist.refreshedAt??hist.retrievedAt,model,games:matches};
}
