import {MODEL_VERSION,reportingWeek,summarizeForecasts} from './results.mjs';
import {rankCardHistory} from './ranked-card-summary.mjs';
import {gradeSpreadPick,summarizeSpreadPicks} from './spread-record.mjs';
import {validSeason} from './season-record.mjs';
import {calendarRecordWeek} from './record-periods.mjs';

const easternDate=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
const at=value=>typeof value==='string'?Date.parse(value):NaN;
const compare=(a,b)=>a<b?-1:a>b?1:0;
const versionOf=record=>record.modelVersion||MODEL_VERSION;
const captureOrder=(a,b)=>at(a.capturedAt)-at(b.capturedAt)||compare(a.id,b.id);
const dayOf=record=>easternDate.format(new Date(record.result?.status==='completed'&&Number.isFinite(at(record.result.playedAt))?record.result.playedAt:record.startTime));
const groups=(rows,keyOf)=>{
 const grouped=new Map();
 for(const row of rows){const key=keyOf(row);if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(row);}
 return grouped;
};

/** This registry policy is an inference, not a historical published-primary flag.
 * Match the board's activation AND reporting-week boundaries. Missing records
 * for that formula remain missing; a later formula or benchmark is not a substitute.
 */
export function historyModelForGame(game,models){
 const eligible=models.filter(model=>String(reportingWeek(game))>=model.startWeekKey&&at(game.startTime)>at(model.activatedAt));
 return [...eligible].sort((a,b)=>at(b.activatedAt)-at(a.activatedAt)||compare(a.id,b.id))[0]??{id:MODEL_VERSION,activatedAt:null};
}

function authenticityReason(record){
 if(record.cohort!=='live')return 'non-live-cohort';
 if(record.origin&&/reconstruct|recover|retrospect|backtest|counterfactual|simulat/i.test(record.origin)||record.recoveredAt!=null||record.reconstructed===true)return 'reconstructed-or-recovered';
 if(!['collector','local-pregame-archive'].includes(record.origin))return 'unverified-origin';
 if(typeof record.id!=='string'||!record.id||record.gameId==null||String(record.gameId)==='')return 'missing-identity';
 if(!Number.isFinite(at(record.startTime))||!Number.isFinite(at(record.capturedAt)))return 'missing-timestamps';
 const kickoff=Math.min(at(record.startTime),Number.isFinite(at(record.firstMarket?.startTime))?at(record.firstMarket.startTime):Infinity);
 if(at(record.capturedAt)>=kickoff||record.forecastedAt!=null&&(!Number.isFinite(at(record.forecastedAt))||at(record.forecastedAt)>=kickoff))return 'late-forecast';
 if(!Number.isFinite(record.predictedMargin))return 'missing-forecast';
 if(Number.isFinite(record.marketHomeSpread)&&(!Number.isFinite(at(record.marketObservedAt))||at(record.marketObservedAt)>=kickoff))return 'unverified-pregame-market';
 if(record.firstMarket&&(!Number.isFinite(at(record.firstMarket.recordedAt))||at(record.firstMarket.recordedAt)>=kickoff))return 'late-market';
 return null;
}

/** Select one genuine saved pick per sport/game, entirely without final scores,
 * result status, outcomes, or profitability. Ranks are frozen BEFORE exclusions
 * and deduplication within each formula's full live ranking window. We retain
 * rank gaps; we never backfill a Top N card from another formula or lower rank.
 * @param {any[]} records
 * @param {{sport:string,models?:any[],rankPeriod?:string,rankAnchor?:string|null}} options
 */
export function selectTrackedHistory(records,{sport,models=[],rankPeriod='week',rankAnchor=null}){
 const scoped=records.filter(record=>record.sport===sport);
 const excluded={};
 const reject=reason=>{excluded[reason]=(excluded[reason]??0)+1;};
 // Invalid timestamps cannot enter the existing ranking helper. All other
 // live rows, even subsequently excluded rows, keep their original rank slots.
 const rankable=scoped.filter(record=>record.cohort==='live'&&Number.isFinite(at(record.startTime))&&typeof record.id==='string');
 const ranked=[...groups(rankable,versionOf).values()].flatMap(rows=>rankCardHistory(rows,{rankPeriod,rankAnchor}));
 const ranks=new Map(ranked.map(record=>[record.id,record]));
 const genuine=[];
 for(const record of scoped){const reason=authenticityReason(record);if(reason)reject(reason);else genuine.push(ranks.get(record.id)??record);}
 const selected=[];let unavailableGames=0,metadataConflictGames=0;
 for(const rows of groups(genuine,record=>`${record.sport}:${record.gameId}`).values()){
  rows.sort(captureOrder);
  // A game can have multiple saved schedule snapshots. Use its earliest genuine
  // capture (then ID), never its final score/playedAt, to identify the active model.
  const anchor=rows[0],model=historyModelForGame(anchor,models);
  if(new Set(rows.map(record=>[record.startTime,record.season,record.week].join('|'))).size>1)metadataConflictGames++;
  const candidates=[];
  for(const record of rows){
   if(versionOf(record)!==model.id){reject('inactive-version');continue;}
   if(model.activatedAt!==null&&at(record.capturedAt)<at(model.activatedAt)){reject('before-model-activation');continue;}
   if(historyModelForGame(record,models).id!==model.id){reject('conflicting-activation-window');continue;}
   candidates.push(record);
  }
  if(!candidates.length){unavailableGames++;continue;}
  const chosen=candidates[0];
  for(let i=1;i<candidates.length;i++)reject('duplicate-game');
  selected.push({...chosen,historyModelVersion:model.id});
 }
 selected.sort((a,b)=>compare(b.startTime,a.startTime)||compare(a.id,b.id));
 return {records:selected,policy:{id:'saved-active-model-history-v1',
  selection:'One genuine pregame capture per sport/game. The latest registered model eligible at the earliest genuine saved kickoff and reporting week owns the game. Within that model, earliest capture then forecast ID wins. Missing active-model picks stay missing; no benchmark or later-formula fallback.',
  provenance:'Only live collector or local pregame archives with a forecast captured before kickoff qualify. Reconstructed, recovered, retrospective, late and unverified records are excluded. Original forecasts and prior versions are preserved. Authorized prospective revisions use the latest valid saved pick locked by kickoff; past games are never recreated.',
  ranking:'Rank each formula’s full saved live card from frozen inputs in the requested ranking window before exclusions or deduplication. Preserve rank gaps and never promote lower-ranked picks. These are saved-input card ranks, not a verified historical publication log.',
  uncertainty:'The ledger has no published-primary marker. Formula ownership is inferred from the activation registry and saved schedule. Full-season coverage is unavailable.',
  excluded,excludedCount:Object.values(excluded).reduce((sum,count)=>sum+count,0),unavailableGames,metadataConflictGames,
  sourceRecords:scoped.length,selectedRecords:selected.length,rankPeriod,rankAnchor}};
}

const inSelectedPeriod=(record,selectedWeek,selectedPeriod)=>selectedPeriod?dayOf(record)>=selectedPeriod.start&&dayOf(record)<=selectedPeriod.end:record.weekKey===selectedWeek;
function summarizeRows(rows,selectedWeek,rankPeriod,selectedPeriod=null){
 const daily=groups(rows,dayOf),weekly=groups(rows,record=>record.weekKey);
 const selected=rows.filter(record=>inSelectedPeriod(record,selectedWeek,selectedPeriod));
 const dates=[...daily.keys()].sort(compare);
 return {rankPeriod,
  overall:summarizeForecasts(rows),spreadOverall:summarizeSpreadPicks(rows),
  days:[...daily].sort(([a],[b])=>compare(b,a)).map(([date,items])=>({date,...summarizeForecasts(items)})),
  spreadDays:[...daily].sort(([a],[b])=>compare(b,a)).map(([date,items])=>({date,...summarizeSpreadPicks(items)})),
  weeks:[...weekly].sort(([a],[b])=>compare(b,a)).map(([key,items])=>({key,...summarizeForecasts(items)})),
  spreadWeeks:[...weekly].sort(([a],[b])=>compare(b,a)).map(([key,items])=>({key,...summarizeSpreadPicks(items)})),
  summary:summarizeForecasts(selected),spreadRecord:summarizeSpreadPicks(selected),
  coverage:{saved:rows.length,seasonUnknownCount:rows.filter(record=>validSeason(record.season)===null).length,firstDate:dates[0]??null,lastDate:dates.at(-1)??null,complete:false}};
}

/** Additive history view; no formula bankroll is replayed or combined.
 * Season/card selection only filters the already ranked, deduplicated history.
 * @param {any[]} records
 * @param {{sport:string,models?:any[],week?:string|null,season?:number|null,rankPeriod?:string,rankAnchor?:string|null,historyDate?:string|null}} options
 */
export function summarizeTrackedHistory(records,{sport,models=[],week=null,season=null,rankPeriod='week',rankAnchor=null,historyDate=null}){
 const selection=selectTrackedHistory(records,{sport,models,rankPeriod,rankAnchor});
 const rows=selection.records,keys=[...new Set(rows.map(record=>record.weekKey))].sort(compare).reverse();
 const selectedWeek=week||keys.find(key=>rows.some(record=>record.weekKey===key&&record.result?.status==='completed'))||keys[0]||null;
 const selectedPeriod=calendarRecordWeek(historyDate);
 const choose=(items,card)=>items.filter(record=>Number.isInteger(record.cardRank)&&record.cardRank>0&&record.cardRank<=Number(card));
 const rankedCards=Object.fromEntries(['3','8','10'].map(card=>[card,summarizeRows(choose(rows,card),selectedWeek,rankPeriod,selectedPeriod)]));
 const seasonId=validSeason(season);
 const seasonSummary=items=>{
  const seasonal=items.filter(record=>validSeason(record.season)===seasonId),summary=summarizeRows(seasonal,selectedWeek,rankPeriod,selectedPeriod);
  return {...summary,coverage:{...summary.coverage,seasonUnknownCount:items.filter(record=>validSeason(record.season)===null).length}};
 };
 const seasonRecord=seasonId===null?null:{season:seasonId,...seasonSummary(rows),rankedCards:Object.fromEntries(['3','8','10'].map(card=>[card,seasonSummary(choose(rows,card))]))};
 return {view:'tracked-history',sport,cohort:'live',version:'tracked-history',modelLabel:'Tracked pick history',
  policy:selection.policy,...summarizeRows(rows,selectedWeek,rankPeriod,selectedPeriod),rankedCards,seasonRecord,selectedWeek,selectedPeriod,
  records:rows.filter(record=>inSelectedPeriod(record,selectedWeek,selectedPeriod)).map(record=>({...record,spreadGrade:gradeSpreadPick(record)}))};
}
