import {SPORT_PATHS,SPORT_LABELS} from './feeds/adapter.mjs';
import {reportingWeek} from './results.mjs';

export const EXPERIMENT_ID='daily-all-sports-v1';
export const EXPERIMENT_SPORTS=Object.freeze(Object.keys(SPORT_PATHS));
export const dayAt=(time,zone='America/New_York')=>new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(time));
export const previousDay=date=>new Date(Date.parse(date+'T12:00:00Z')-86400000).toISOString().slice(0,10);
const number=(n,d=2)=>Number.isFinite(n)?n.toFixed(d):'unavailable';
const money=n=>Number.isFinite(n)?`${n<0?'−':'+'}$${Math.abs(n).toFixed(2)}`:'unavailable';

export function summarizeExperimentSport(sport,overviews,collection,gameDate,today){
 if(!overviews.length||overviews.some(d=>d.sport!==sport||d.cohort!=='live'))throw new Error('Separate live sport/model records are required.');
 if(overviews.some(d=>typeof d.version!=='string')||new Set(overviews.map(d=>d.version)).size!==overviews.length)throw new Error('Distinct formula versions are required.');
 const known=new Map((collection.reports||[]).flatMap(r=>r.coverage||[]).filter(g=>g.startTime&&dayAt(g.startTime)===gameDate).map(g=>[g.id,g]));
 const versions=overviews.map(d=>{
  const daily=d.days?.find(x=>x.date===gameDate)||null;
  const captured=new Set((d.records||[]).filter(f=>f.startTime&&dayAt(f.startTime)===gameDate).map(f=>f.gameId));
  const missingCaptures=captured.size===(daily?.recorded||0)?[...known.keys()].filter(id=>!captured.has(id)).length:null;
  return {version:d.version,label:d.modelLabel,daily,bankrollDay:d.bankroll?.days?.find(x=>x.date===gameDate)||null,todayBankroll:d.bankroll?.days?.find(x=>x.date===today)||null,balance:d.bankroll?.balance??null,overall:d.overall,missingCaptures,lastCollectionAt:d.lastCollectionAt,liveCheck:d.liveCheck};
 });
 return {sport,label:SPORT_LABELS[sport],activeVersion:overviews[0].version,knownGames:known.size,knownFinals:[...known.values()].filter(g=>g.status==='completed').length,versions,sourceWarnings:[...new Set((collection.reports||[]).flatMap(r=>r.warnings||[]))],sourceFailures:collection.failures||[]};
}

export function dailyLearningEntry(report){
 if(report.sports.length!==EXPERIMENT_SPORTS.length||EXPERIMENT_SPORTS.some(s=>!report.sports.some(x=>x.sport===s)))throw new Error('Every supported sport must be reported.');
 const evidence=[];
 for(const sport of report.sports)for(const v of sport.versions){
  const d=v.daily,b=v.bankrollDay,t=v.todayBankroll;
  const record=d?`${d.wins}–${d.losses}–${d.pushes}; ${d.graded}/${d.recorded} finals; ${d.pending} pending; ${d.graded-d.pricedGames} finals without a usable saved price/selection`:'No saved forecasts on this date';
  const error=d?.matchedGames?` Same-game error: model ${number(d.matchedModelMae)} vs market ${number(d.marketMae)} ${sport.sport==='mlb'?'runs':sport.sport==='nhl'?'goals':'points'} across ${d.matchedGames} finals.`:'';
  evidence.push(`${sport.label} · ${v.label} · ${report.gameDate}: ${record}. ${sport.knownGames} known games; missing pregame captures ${v.missingCaptures??'unverified (daily IDs not fully loaded)'}; schedule completeness remains unverified.${error} Bankroll-sized profit ${money(b?.profit)}; balance $${number(v.balance)}. Today's stake ${Number.isFinite(t?.stake)?'$'+number(t.stake):t?'awaiting prior-day settlement or a funded card':'no recorded card'}.${b?.status==='over-budget'?' Full card exceeds available bankroll and is paused.':''}`);
 }
 evidence.push(`Free-source collection completed for ${report.sports.length} sports. ${report.baseball?.games?`${report.baseball.games} MLB research games through ${report.baseball.completedThrough}.`:'The separate MLB research refresh is unavailable and queued for retry; the saved lines and results are unaffected.'}`);
 if(report.sports.some(s=>s.sourceWarnings.length))evidence.push('Provider warnings are retained in the collection audit, including college schedule caps. Empty off-season feeds are not treated as successful predictions. No default prices or post-start forecasts are manufactured.');
 return {id:`${EXPERIMENT_ID}-${report.runDate}`,sport:'all',weekKey:reportingWeek({startTime:report.gameDate+'T12:00:00Z'}),kind:'review',modelVersion:'Separate recorded versions; daily-all-sports-v1',title:`Daily experiment · ${report.gameDate} results`,learned:`The automatic daily run checked NFL, college football, NBA, WNBA, men's college basketball, NHL and MLB. Each line remains attached to its original pregame capture and model version. This entry records the observed results as of ${report.finishedAt}; pending games, later corrections and missing coverage are not assumed away.`,decision:'Continue the experiment under the existing sport-specific priors. New completed games can update future fitted team ratings. Daily wins and losses do not trigger parameter changes. Each sport and formula retains its own $500 starting-bankroll simulation and stakes of 2% of the Eastern day’s opening balance; balances and returns are never pooled.',priors:[{name:'Sport-specific priors',before:'Existing recorded parameters',after:'Unchanged',note:'This daily function measures outcomes and refreshes data. Any algorithm adjustment requires separate evidence, a dated learning entry and a new model version.'}],evidence,nextTest:'Capture the next eligible full card and grade verified finals. Review line error, original-price outcomes, coverage and bankroll-sized returns in the Tuesday research review. These are prospective measurements, not evidence that a profitable edge has been established.'};
}
