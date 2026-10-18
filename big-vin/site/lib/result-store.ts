import {db} from './db';
import seed from './weekly-seed.json';
import {summarizeForecasts} from './results.mjs';
import {modelLabel,activeModels,historicalModelSpecs} from './model-versions';
import {MODEL_VERSION} from './results.mjs';
import {sportsDay} from './time';
import {withFirstMarket} from './first-market.mjs';
import {firstMarkets} from './market-store';
import {replayBankroll} from './bankroll.mjs';
import cfbReconstruction from './college-experiment-cohort-2026-09-26.json';
import cfbOpeningOdds from './cfb-opening-odds-2026-09-26.json';
import {makeCfbReconstructedRecords,summarizeWinners} from './cfb-reconstructed-records.mjs';
import {withCfbPaperWager} from './cfb-paper-wagers.mjs';
import {gradeSpreadPick,summarizeSpreadPicks} from './spread-record.mjs';
import {rankCardHistory,summarizeRankedCards} from './ranked-card-summary.mjs';
import {summarizeSavedSeason} from './season-record.mjs';
import {summarizeTrackedHistory} from './tracked-history.mjs';
import {readForecastPages} from './forecast-pages.mjs';
import {pickStates} from './pick-revision-store';
import {withPickState} from './pick-revisions.mjs';
export const seedRecords:any[]=seed as any[];
/** Authorized one-time import; preserve any genuine forecast already saved. */
export async function importCfbMissedCard(){
 const fixture:any=cfbReconstruction;
 const ids=fixture.games.map((game:any)=>`${fixture.modelVersion}:cfb:${game.id}`);
 const found=await db().prepare(`SELECT id FROM forecasts WHERE id IN (${ids.map(()=>'?').join(',')})`).bind(...ids).all<{id:string}>();
 const present=new Set(found.results.map(row=>row.id));
 if(present.size===ids.length)return {inserted:0,alreadyPresent:present.size,expected:ids.length};
 const importedAt=new Date().toISOString();
 const all=makeCfbReconstructedRecords(fixture,importedAt);
 const absent=all.filter((record:any)=>!present.has(record.id));
 const inserted=await saveForecasts(absent);
 if(inserted){
  const coverage=absent.map((record:any)=>({id:record.gameId,weekKey:record.weekKey,startTime:record.startTime,home:record.home,away:record.away,status:record.result?.status==='completed'?'completed':'unresolved',result:record.result?.status==='completed'?{status:'completed',homeScore:record.result.homeScore,awayScore:record.result.awayScore}:null,coverageNote:record.coverageNote}));
  const report={sport:'cfb',kind:'missed-run-reconstruction',inserted,cohort:'live',modelVersion:fixture.modelVersion,modelCapturedAt:fixture.capturedAt,
   numericLinesEnteredAt:importedAt,trainingCutoff:fixture.model.asOf,lastTrainingDate:fixture.model.lastTrainingDate,
   warnings:['The scheduled September 26 full-card run was missed. Some lines were entered after kickoff from ratings trained only on earlier games. No contemporaneous spread, price, ATS result, or bankroll return is claimed for reconstructed games.'],
   coverage,completedAt:importedAt};
  await db().prepare('INSERT INTO collection_runs (id,completed_at,sport,payload) VALUES (?,?,?,?)').bind(crypto.randomUUID(),importedAt,'cfb',JSON.stringify(report)).run();
 }
 return {inserted,alreadyPresent:present.size,expected:ids.length,numericLinesEnteredAt:importedAt,modelCapturedAt:fixture.capturedAt};
}
export async function readForecastRecords(sport:string,includeRevisions=true){
 const results=await readForecastPages(async(afterId:string|null,limit:number)=>{
  const statement=afterId===null?db().prepare('SELECT id,payload,result FROM forecasts WHERE sport=? ORDER BY id ASC LIMIT ?').bind(sport,limit):db().prepare('SELECT id,payload,result FROM forecasts WHERE sport=? AND id>? ORDER BY id ASC LIMIT ?').bind(sport,afterId,limit);
  return (await statement.all<{id:string,payload:string,result:string|null}>()).results;
 });
 const map=new Map(seedRecords.filter(f=>f.sport===sport).map(f=>[f.id,f]));
 for(const r of results){const f=JSON.parse(r.payload);const archived=map.get(f.id);map.set(f.id,{...archived,...f,rank:f.rank??archived?.rank,rankBasis:f.rankBasis??archived?.rankBasis,projection:f.projection??archived?.projection,result:r.result?JSON.parse(r.result):archived?.result??null});}
 const markets=await firstMarkets(sport);
 const states=includeRevisions?await pickStates(sport):new Map();
 return [...map.values()].map(f=>withPickState(withCfbPaperWager(withFirstMarket(f,markets.get(f.id)),cfbOpeningOdds),states.get(f.id)));
}
export async function saveForecasts(records:any[],prospective=false){
 let inserted=0;
 for(let i=0;i<records.length;i+=40){const outcomes=await db().batch(records.slice(i,i+40).map(f=>db().prepare("INSERT INTO forecasts (id,sport,week_key,cohort,start_time,captured_at,payload,result,graded_at) SELECT ?,?,?,?,?,?,?,?,? WHERE ?=0 OR julianday('now')<julianday(?) ON CONFLICT(id) DO NOTHING").bind(f.id,f.sport,f.weekKey,f.cohort,f.startTime,f.capturedAt,JSON.stringify({...f,result:undefined}),f.result?JSON.stringify(f.result):null,f.result?.observedAt??null,prospective?1:0,f.startTime)));inserted+=outcomes.reduce((s,r)=>s+(r.meta.changes??0),0);}
 return inserted;
}
export async function readResults(sport:string,requestedCohort:string|null,week:string|null,requestedVersion:string|null=null,rankPeriod='week',rankAnchor:string|null=null,requestedSeason:number|null=null,historyOnly=false,historyDate:string|null=null){
 const all=await readForecastRecords(sport);
 const trackedHistory=summarizeTrackedHistory(all,{sport,models:historicalModelSpecs(sport),week,season:requestedSeason,rankPeriod,rankAnchor,historyDate});
 if(historyOnly)return trackedHistory;
 const cohort=requestedCohort|| (all.some(f=>f.cohort==='live'&&f.result?.status==='completed')?'live':all.some(f=>f.cohort==='recovered')?'recovered':'live');
 const cohortRecords=all.filter(f=>f.cohort===cohort);
 const versionIds=[...new Set([MODEL_VERSION,...cohortRecords.map(f=>f.modelVersion||MODEL_VERSION),...(cohort==='live'&&activeModels[sport]?[activeModels[sport].id]:[])])];
 const versions=versionIds.map(id=>({id,label:modelLabel(sport,id)}));
 const active=activeModels[sport];
 const scope=week?cohortRecords.filter(f=>f.weekKey===week):cohortRecords;
 const version=requestedVersion&&versionIds.includes(requestedVersion)?requestedVersion:active&&scope.some(f=>f.modelVersion===active.id)&&(!scope.some(f=>f.result?.status==='completed')||scope.some(f=>f.modelVersion===active.id&&f.result?.status==='completed'))?active.id:versionIds.includes(MODEL_VERSION)?MODEL_VERSION:versionIds[0]||MODEL_VERSION;
 const records=cohortRecords.filter(f=>(f.modelVersion||MODEL_VERSION)===version);
 const dailyRecords=new Map<string,any[]>();
 for(const record of records){const day=sportsDay(record.result?.status==='completed'&&record.result.playedAt||record.startTime);const group=dailyRecords.get(day)??[];group.push(record);dailyRecords.set(day,group);}
 const days=[...dailyRecords].sort(([a],[b])=>b.localeCompare(a)).map(([date,forecasts])=>({date,...summarizeForecasts(forecasts),winnerRecord:summarizeWinners(forecasts)}));
 const spreadDays=[...dailyRecords].sort(([a],[b])=>b.localeCompare(a)).map(([date,forecasts])=>({date,...summarizeSpreadPicks(forecasts)}));
 const keys=[...new Set(records.map(f=>f.weekKey))].sort().reverse();
 const selectedWeek=week&&keys.includes(week)?week:keys.find(key=>records.some(f=>f.weekKey===key&&f.result?.status==='completed'))??keys[0]??null;
 const weeks=keys.map(key=>{const forecasts=records.filter(f=>f.weekKey===key);return {key,...summarizeForecasts(forecasts),winnerRecord:summarizeWinners(forecasts)};});
 const spreadWeeks=keys.map(key=>({key,...summarizeSpreadPicks(records.filter(f=>f.weekKey===key))}));
 const selected:any[]=rankCardHistory(records,{rankPeriod,rankAnchor}).filter(f=>f.weekKey===selectedWeek);
 const latest=await db().prepare('SELECT completed_at,payload FROM collection_runs WHERE sport=? ORDER BY completed_at DESC LIMIT 1').bind(sport).first<{completed_at:string,payload:string}>();
 const coverageRows=await db().prepare('SELECT payload FROM collection_runs WHERE sport=? ORDER BY completed_at DESC LIMIT 90').bind(sport).all<{payload:string}>();
 const expected=new Map<string,any>();
 for(const row of coverageRows.results)for(const g of JSON.parse(row.payload).coverage??[])if(g.weekKey===selectedWeek&&!expected.has(g.id))expected.set(g.id,g);
 for(const f of seedRecords)if(f.sport===sport&&f.weekKey===selectedWeek&&!expected.has(f.gameId))expected.set(f.gameId,{id:f.gameId,weekKey:f.weekKey,home:f.home,away:f.away,startTime:f.startTime,result:f.result,coverageNote:f.coverageNote});
 if(sport==='cfb'&&cohort==='recovered'){const dates=new Set(selected.map(f=>sportsDay(f.startTime)));for(const [id,g] of expected)if(!dates.has(sportsDay(g.startTime)))expected.delete(id);}
 const captured=new Set(selected.map(f=>f.gameId));
 const missing=cohort==='retrospective'?[]:[...expected.values()].filter(g=>!captured.has(g.id));
 const bankroll=replayBankroll(records);
 const rankedCards=summarizeRankedCards(records,selectedWeek,bankroll,{rankPeriod,rankAnchor});
 const seasonRecord=summarizeSavedSeason(records,requestedSeason,{rankPeriod,rankAnchor,bankroll});
 const cfbPaperCard=sport==='cfb'&&cohort==='live';
 const cardSummary=(items:any[])=>{
  const spread=summarizeSpreadPicks(items);
  const settled=items.filter(f=>['win','loss','push'].includes(gradeSpreadPick(f).outcome)).map(f=>bankroll.plays[f.id]).filter(play=>typeof play?.profitUnits==='number');
  return {wins:spread.wins,losses:spread.losses,pushes:spread.pushes,pending:spread.pending,pnl:settled.length?settled.reduce((sum,play)=>sum+play.profitUnits,0):null};
 };
 const top3=selected.filter(f=>f.cardRank&&f.cardRank<=3),easy8=selected.filter(f=>f.cardRank&&f.cardRank<=8);
 return {sport,cohort,version,versions,modelLabel:modelLabel(sport,version),tuning:active?.id===version?active:null,selectedWeek,weeks,days,spreadWeeks,spreadDays,bankroll,rankedCards,seasonRecord,trackedHistory,records:selected.map(f=>({...f,spreadGrade:gradeSpreadPick(f)})),missing,ranked:selected.filter(f=>f.cardRank).length,cards:{top3:cfbPaperCard?cardSummary(top3):summarizeForecasts(top3),easy8:cfbPaperCard?cardSummary(easy8):summarizeForecasts(easy8),full:cfbPaperCard?cardSummary(selected):summarizeForecasts(selected)},knownScheduledGames:cohort==='retrospective'?selected.length:expected.size,summary:summarizeForecasts(selected),overall:summarizeForecasts(records),spreadRecord:summarizeSpreadPicks(selected),spreadOverall:summarizeSpreadPicks(records),winnerRecord:summarizeWinners(selected),winnerOverall:summarizeWinners(records),lastCollectionAt:latest?.completed_at??null,collection:latest?JSON.parse(latest.payload):null};
}
