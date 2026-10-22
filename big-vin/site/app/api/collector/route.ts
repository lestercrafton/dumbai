import {db} from '@/lib/db';
import {authorizedCollector} from '@/lib/admin';
import {normalizeScoreboard,scoreboardUrl,SPORT_PATHS} from '@/lib/feeds/adapter.mjs';
import {getSlate,history,canonical,persistFinals,persistBoard} from '@/lib/feeds/service';
import {fitRatings,projectGame} from '@/lib/ratings.mjs';
import {reportingWeek,gradeForecast,MODEL_VERSION} from '@/lib/results.mjs';
import {seedRecords,saveForecasts,importCfbMissedCard,readForecastRecords} from '@/lib/result-store';
import {capturePickRevisions,pickStates} from '@/lib/pick-revision-store';
import {withPickState} from '@/lib/pick-revisions.mjs';
import {sportsDay} from '@/lib/time';
import {captureFirstMarkets,firstMarkets} from '@/lib/market-store';
import {withFirstMarket} from '@/lib/first-market.mjs';
import {activeModels} from '@/lib/model-versions';
import {boardDates} from '@/lib/collector-sources.mjs';
export async function POST(request:Request){
 if(!await authorizedCollector(request))return Response.json({error:'Collector authorization required.'},{status:401});
 try{const v:any=await request.json();const now=new Date().toISOString();
 if(v.action==='initialize')return Response.json({inserted:await saveForecasts(seedRecords.filter(f=>['live','recovered'].includes(f.cohort)))});
 if(v.action==='import-cfb-missed-card')return Response.json(await importCfbMissedCard());
 if(!Object.hasOwn(SPORT_PATHS,v.sport)||!Array.isArray(v.boards)||v.boards.length>30||!v.boards.length)return Response.json({error:'Supply a bounded set of source scoreboards.'},{status:400});
 if(v.boards.some((b:any)=>!Array.isArray(b.payload?.events)||b.payload.events.length>1000||!/^\d{4}-\d{2}-\d{2}$/.test(b.date)||!Number.isFinite(Date.parse(b.observedAt))||Date.parse(b.observedAt)>Date.now()+5000||Date.now()-Date.parse(b.observedAt)>30*60*1000))return Response.json({error:'Current source observations are required.'},{status:400});
 const boards:any[]=v.boards.map((b:any)=>{const normalized=normalizeScoreboard(b.payload,v.sport,{retrievedAt:b.observedAt,sourceUrl:b.sourceUrl||scoreboardUrl(v.sport,{startDate:b.date,endDate:b.endDate})});return {...normalized,warnings:[...normalized.warnings,...(Array.isArray(b.warnings)?b.warnings.filter((w:any)=>typeof w==='string').slice(0,10):[])]};});
 // FCS-only games expand schedule coverage, not the incumbent's training population.
 await persistFinals(v.sport,v.sport==='cfb'?boards.filter((b,i)=>new URL(b.sourceUrl).searchParams.get('groups')==='80'||(v.boards[i].sourceGroup==='80'&&v.boards[i].scheduleSourceUrl&&new URL(v.boards[i].scheduleSourceUrl).searchParams.get('groups')==='80')):boards);
 const games:any[]=[...new Map<string,any>(boards.flatMap(b=>b.games).map(g=>[g.id,g] as [string,any])).values()];
 const board={...boards[0],retrievedAt:now,warnings:boards.flatMap(b=>b.warnings),games};
 const startDate=v.boards.map((b:any)=>b.date).sort()[0];const endDate=v.boards.map((b:any)=>b.endDate||b.date).sort().at(-1);
 await persistBoard(v.sport,board,startDate,endDate,boardDates(v.boards));
 const date=sportsDay();const versions=[MODEL_VERSION,...(activeModels[v.sport]?[activeModels[v.sport].id]:[])];let inserted=0;const insertedByVersion:Record<string,number>={};
 for(const version of v.historicalOnly===true?[]:versions){
 const slate=await getSlate(v.sport,date,board,7,version,true);
 const hist=version===MODEL_VERSION&&['nfl','cfb'].includes(v.sport)?await history(v.sport):null;
 const shadow=hist?fitRatings(hist.games,{sport:v.sport,asOf:slate.asOf,variant:v.sport==='nfl'?'no-rest':'fixed-home'}):null;
 const records=slate.games.filter((g:any)=>g.modelVersion===version&&g.status==='scheduled'&&Date.parse(g.startTime)>Date.now()+60000&&g.projection?.predictedHomeMargin!==null&&Number.isFinite(g.projection?.predictedHomeMargin)).map((g:any)=>{
 const market=g.stale?null:g.market;const side=market?g.side:null;
 return {id:`${version}:${v.sport}:${g.id}`,gameId:g.id,sport:v.sport,season:g.season,seasonType:g.seasonType,postseason:g.postseason??null,week:g.week,weekKey:reportingWeek(g),cohort:'live',origin:'collector',startTime:g.startTime,capturedAt:now,rank:g.rank,rankBasis:'Collection card · '+date+' through '+slate.endDate,projection:g.projection,ratingCoverage:g.projection.ratingCoverage??null,coverageNote:g.projection.coverageNote??null,home:g.home.name,away:g.away.name,homeId:canonical(g).homeId,awayId:canonical(g).awayId,predictedMargin:g.projection.predictedHomeMargin,marketHomeSpread:market?.homeSpread??null,marketHomePrice:market?.homeSpreadPrice??null,marketAwayPrice:market?.awaySpreadPrice??null,side,odds:side==='home'?market?.homeSpreadPrice??null:side==='away'?market?.awaySpreadPrice??null:null,marketObservedAt:market?.observedAt??null,provider:market?.provider??null,sourceUrl:g.sourceUrl,trainingCutoff:slate.asOf,modelVersion:version,parameters:slate.model.config,homeAdvantage:slate.model.homeAdvantage,restCoefficient:slate.model.restCoefficient,trainingGames:slate.model.trainingGames,lastTrainingDate:slate.model.lastTrainingDate,shadow:shadow?{version:v.sport==='nfl'?'nfl-no-rest-shadow-v1':'cfb-fixed-home-shadow-v1',predictedMargin:projectGame(canonical(g),shadow)?.predictedHomeMargin??null,eligible:v.sport==='nfl'?String(reportingWeek(g))>='2026-W02':sportsDay(g.startTime)>='2026-09-14'}:null};
 });
 insertedByVersion[version]=await saveForecasts(records,true);inserted+=insertedByVersion[version];
 }
 const marketCaptures=await captureFirstMarkets(v.sport,boards.flatMap(b=>b.games).map(g=>({...g,homeId:canonical(g).homeId,awayId:canonical(g).awayId})),now);
 const marketObservations=await firstMarkets(v.sport);
 await capturePickRevisions(await readForecastRecords(v.sport,false),games.map(g=>({...g,homeId:canonical(g).homeId,awayId:canonical(g).awayId})));
 const revisionStates=await pickStates(v.sport);
 const stored=await db().prepare('SELECT id,payload,result FROM forecasts WHERE sport=? AND cohort IN (?,?) AND (result IS NULL OR start_time>=?) ORDER BY start_time DESC LIMIT 5000').bind(v.sport,'live','recovered',new Date(Date.now()-35*86400000).toISOString()).all<{id:string,payload:string,result:string|null}>();
 const gameMap=new Map(games.map(g=>[g.id,g]));const updates=[];const corrections=[];
 for(const row of stored.results){const f=withPickState(withFirstMarket(JSON.parse(row.payload),marketObservations.get(row.id)),revisionStates.get(row.id));const game=gameMap.get(f.gameId);if(!game)continue;const result:any=gradeForecast(f,game,new Date().toISOString());if(!result)continue;
 const previous=row.result?JSON.parse(row.result):null;
 if(previous&&previous.status===result.status&&previous.homeScore===result.homeScore&&previous.awayScore===result.awayScore&&previous.outcome===result.outcome&&previous.pnl===result.pnl&&(previous.playedAt??null)===(result.playedAt??null)&&(previous.pickRevisionId??null)===(result.pickRevisionId??null)&&(previous.marketObservation?.observedAt??null)===(result.marketObservation?.observedAt??null))continue;
 if(previous)corrections.push({id:row.id,before:previous,after:result});
 updates.push(db().prepare('UPDATE forecasts SET result=?,graded_at=? WHERE id=?').bind(JSON.stringify(result),now,row.id));
 }
 for(let i=0;i<updates.length;i+=40)await db().batch(updates.slice(i,i+40));
 const report={sport:v.sport,inserted,insertedByVersion,marketCaptures,graded:updates.length,sourceGames:games.length,sourceUrls:boards.map(b=>b.sourceUrl),sourceProvenance:v.boards.filter((b:any)=>b.scheduleSourceUrl).map((b:any)=>({sourceUrl:b.sourceUrl,sourceGroup:b.sourceGroup,scheduleSourceUrl:b.scheduleSourceUrl,scheduleObservedAt:b.scheduleObservedAt})),warnings:[...new Set(boards.flatMap(b=>b.warnings))],coverage:games.filter(g=>g.seasonType!==1&&!g.modelExcludedReason&&g.startTime).map(g=>({id:g.id,weekKey:reportingWeek(g),startTime:g.startTime,home:g.home.name,away:g.away.name,status:g.status,result:g.completed?{status:'completed',homeScore:g.homeScore,awayScore:g.awayScore}:null})),corrections,completedAt:now};
 await db().prepare('INSERT INTO collection_runs (id,completed_at,sport,payload) VALUES (?,?,?,?)').bind(crypto.randomUUID(),now,v.sport,JSON.stringify(report)).run();
 return Response.json(report);
 }catch(e){console.error('Collector failed',e);return Response.json({error:'Collection failed; existing forecasts have been preserved.',detail:e instanceof Error?e.message:String(e)},{status:503});}
}
