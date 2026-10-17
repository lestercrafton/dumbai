import {db,cached} from './db';
import {fetchScoreboard} from './feeds/adapter.mjs';
import {firstMarkets} from './market-store';
import {withFirstMarket} from './first-market.mjs';
import {gradeForecast,reportingWeek} from './results.mjs';
import {matchMlbFinals,unchangedGrade,eventSummaryUrl,matchEspnSummary,selectSummaryCandidates} from './live-finals.mjs';
import {postseasonSlotForForecast,seriesLookupCandidates,completedBestOfThreeSeries,inferUnneededPlayoffGame} from './postseason.mjs';
import {sportsDay} from './time';

// Public requests can trigger a check, but only fixed, server-fetched sources
// can write grades. No browser-supplied score or market can enter this path.
export async function refreshLiveResults(sport:string){
 return cached(`live-results:v2:${sport}`,60,async()=>{
  const now=new Date().toISOString();
  const recent=new Date(Date.now()-3*86400000).toISOString();
  const oldest=new Date(Date.now()-21*86400000).toISOString();
  const stored=await db().prepare('SELECT id,payload,result FROM forecasts WHERE sport=? AND cohort IN (?,?) AND start_time<=? AND start_time>=? AND (result IS NULL OR start_time>=?) ORDER BY start_time DESC LIMIT 3000').bind(sport,'live','recovered',now,oldest,recent).all<{id:string,payload:string,result:string|null}>();
  const markets=await firstMarkets(sport);
  const rows=stored.results.map(row=>({...row,forecast:withFirstMarket(JSON.parse(row.payload),markets.get(row.id))}));
  const dates=[...new Set(rows.map(row=>sportsDay(row.forecast.startTime)))].sort().reverse().slice(0,3);
  const warnings:string[]=[];let gameMap=new Map<string,any>();const sources:string[]=[];const observedPending=new Set<string>();
  if(!dates.length)return {checkedAt:now,graded:0,warnings};
  if(sport==='mlb'){
   const source=`https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${dates.at(-1)}&endDate=${dates[0]}&hydrate=team`;
   try{const response=await fetch(source,{signal:AbortSignal.timeout(12000)});if(!response.ok)throw new Error(`HTTP ${response.status}`);const payload:any=await response.json();if(!Array.isArray(payload.dates))throw new Error('Invalid MLB schedule');gameMap=matchMlbFinals(payload,rows.map(r=>r.forecast),source,observedPending);sources.push(source);}
   catch{warnings.push('Official MLB final-score check unavailable; trying ESPN.');}
  }
  if(sport!=='mlb'||!sources.length){
   const boards=await Promise.allSettled(dates.map(date=>fetchScoreboard(sport,{startDate:date,endDate:date})));
   for(const board of boards){if(board.status==='fulfilled'){sources.push(board.value.sourceUrl);for(const g of board.value.games)gameMap.set(g.id,g);}else warnings.push('A final-score source is unavailable. Saved results remain visible.');}
  }
  // Daily college boards can be capped or unavailable. Saved event IDs let us
  // check omitted games independently, including unresolved older dates.
  const pending=rows.filter(row=>!row.result&&!observedPending.has(row.forecast.gameId)).map(row=>row.forecast);
  const attemptKey=`live-results-summary-attempts:v1:${sport}`;
  const attemptRow=await db().prepare('SELECT payload FROM feed_cache WHERE key=?').bind(attemptKey).first<{payload:string}>();
  let attempts:Record<string,string>={};
  try{const saved=attemptRow?JSON.parse(attemptRow.payload):{};if(saved&&typeof saved==='object'&&!Array.isArray(saved))attempts=saved;}catch{/* A damaged attempt cache must not block final scores. */}
  const candidates=selectSummaryCandidates(pending,gameMap,attempts,12);
  let index=0,summaryFailures=0;const missingSummaries=new Set<string>();
  await Promise.all(Array.from({length:Math.min(4,candidates.length)},async()=>{
   while(index<candidates.length){const f=candidates[index++];attempts[f.gameId]=now;
    try{const source=eventSummaryUrl(sport,f.gameId);const response=await fetch(source,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(8000)});if(!response.ok){if(response.status===404||response.status===410)missingSummaries.add(f.gameId);throw new Error('Summary unavailable');}
     const game=matchEspnSummary(await response.json(),f,source,new Date().toISOString());if(!game)throw new Error('Summary identity mismatch');gameMap.set(f.gameId,game);sources.push(source);
    }catch{summaryFailures++;}
   }
  }));
  // Providers remove unneeded playoff slots instead of returning cancellation.
  // A missing ID is insufficient: verify the exact archived slot against the
  // completed best-of-three series from a separate, server-fetched final.
  const slots=[...new Map(pending.filter(f=>missingSummaries.has(f.gameId)&&!gameMap.has(f.gameId)&&postseasonSlotForForecast(f)).map(f=>[f.gameId,f])).values()].slice(0,8);
  if(slots.length){
   const lookupStart=new Date(Math.min(...slots.map(f=>Date.parse(f.startTime)))-7*86400000).toISOString();
   const prior=await db().prepare('SELECT payload,result FROM forecasts WHERE sport=? AND cohort IN (?,?) AND result IS NOT NULL AND start_time>=? AND start_time<=? ORDER BY start_time DESC LIMIT 3000').bind(sport,'live','recovered',lookupStart,now).all<{payload:string,result:string}>();
   const archived=prior.results.map(row=>({...JSON.parse(row.payload),result:JSON.parse(row.result)}));
   const seriesSources=seriesLookupCandidates(slots,archived,8);
   const checks=await Promise.allSettled(seriesSources.map(async f=>{
    const source=eventSummaryUrl(sport,f.gameId),response=await fetch(source,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(8000)});
    if(!response.ok)throw new Error('Series final unavailable');
    const payload=await response.json(),verifiedAt=new Date().toISOString(),game=matchEspnSummary(payload,f,source,verifiedAt);
    if(!game?.completed)throw new Error('Series final identity or status mismatch');
    sources.push(source);return completedBestOfThreeSeries(payload,sport,{sourceUrl:source,observedAt:verifiedAt});
   }));
   const evidence=checks.flatMap(check=>check.status==='fulfilled'?check.value:[]);
   for(const f of slots){const game=inferUnneededPlayoffGame(f,evidence,{observedAt:new Date().toISOString(),summaryMissing:true,currentGame:gameMap.get(f.gameId)});if(game){gameMap.set(f.gameId,game);summaryFailures--;}}
  }
  if(candidates.length){const pendingIds=new Set(pending.map(f=>String(f.gameId)));const kept=Object.fromEntries(Object.entries(attempts).filter(([id,at])=>pendingIds.has(id)&&Number.isFinite(Date.parse(at))&&Date.parse(at)>=Date.parse(oldest)));
   await db().prepare('INSERT INTO feed_cache (key,payload,fetched_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,fetched_at=excluded.fetched_at').bind(attemptKey,JSON.stringify(kept),now).run();
  }
  if(summaryFailures)warnings.push(`${summaryFailures} saved-game final check${summaryFailures===1?' was':'s were'} unavailable; those results remain pending.`);
  const deferred=selectSummaryCandidates(pending,gameMap,attempts,pending.length).filter(f=>!candidates.some(c=>c.gameId===f.gameId)).length;
  if(deferred)warnings.push(`${deferred} other pending game${deferred===1?' is':'s are'} queued for the next automatic checks.`);
  if(!sources.length)return {checkedAt:null,attemptedAt:now,graded:0,warnings};
  const changes:any[]=[],corrections:any[]=[];
  for(const row of rows){const f=row.forecast,game=gameMap.get(f.gameId);if(!game)continue;const gradedResult=gradeForecast(f,game,now);if(!gradedResult)continue;const result=game.voidEvidence?{...gradedResult,reason:game.voidEvidence.reason,voidEvidence:game.voidEvidence}:gradedResult;const previous=row.result?JSON.parse(row.result):null;if(unchangedGrade(previous,result))continue;if(previous)corrections.push({id:row.id,before:previous,after:result});
   // Compare-and-swap prevents a slower overlapping request overwriting a grade.
   changes.push(db().prepare('UPDATE forecasts SET result=?,graded_at=? WHERE id=? AND result IS ?').bind(JSON.stringify(result),now,row.id,row.result));
  }
  let graded=0;for(let i=0;i<changes.length;i+=40){const saved=await db().batch(changes.slice(i,i+40));graded+=saved.reduce((n,r)=>n+(r.meta.changes??0),0);}
  if(graded){const coverage=rows.filter(r=>gameMap.has(r.forecast.gameId)).map(({forecast:f})=>{const g=gameMap.get(f.gameId);return {id:f.gameId,weekKey:reportingWeek(f),startTime:f.startTime,home:f.home,away:f.away,status:g.status,result:g.completed?{status:'completed',homeScore:g.homeScore,awayScore:g.awayScore}:null};});
   const report={sport,kind:'live-final-check',inserted:0,marketCaptures:0,graded,sourceGames:gameMap.size,sourceUrls:sources,warnings,coverage:[...new Map(coverage.map(g=>[g.id,g])).values()],corrections,completedAt:now};
   await db().prepare('INSERT INTO collection_runs (id,completed_at,sport,payload) VALUES (?,?,?,?)').bind(crypto.randomUUID(),now,sport,JSON.stringify(report)).run();
  }
  return {checkedAt:now,graded,warnings};
 });
}
