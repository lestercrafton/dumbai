'use client';

import {useEffect,useState} from 'react';
import Link from 'next/link';
import ResearchFrame from '@/components/research-frame';
import {RefreshCw} from 'lucide-react';

type ExperimentGame={
 id:string;
 category?:string;
 startTime?:string|null;
 home:string;
 away:string;
 homeId?:string|null;
 awayId?:string|null;
 modelHomeMargin:number|null;
 predictedWinner?:string|null;
 actualHomeScore?:number|null;
 actualAwayScore?:number|null;
 actualHomeMargin?:number|null;
 outcome?:string|null;
 absoluteError?:number|null;
 modelVersion?:string|null;
 sourceUrl?:string|null;
 forecastTiming?:string|null;
 lateMarketHomeSpread?:number|null;
 lateMarketProvider?:string|null;
 researchSide?:string|null;
 coverOutcome?:string|null;
 ratingCoverage?:string|null;
};
type Experiment={
 date:string;
 asOf?:string|null;
 generatedAt?:string|null;
 cohortCapturedAt?:string|null;
 coverage?:{discovered:number;boardGames?:number;savedBeforeKickoff?:number;projected:number;finals:number;missing?:number;noMarketOnBoard?:number;omittedFromBoard?:number;pricedWithoutSaved?:number;priorOnly?:number;archivedOpeningQuotes?:number;syntheticWinnerContracts?:number};
 summary?:{winnerWins:number;winnerLosses:number;winnerTies:number;mae:number|null;medianAbsoluteError:number|null;lateMarketCount?:number;lateMarketWins?:number;lateMarketLosses?:number;lateMarketPushes?:number};
 games:ExperimentGame[];
};
type EspnSummary={header?:{id?:string|number;competitions?:Array<{status?:{type?:{completed?:boolean}};competitors?:Array<{homeAway?:string;team?:{id?:string|number};score?:string|number|null}>}>}};

const oneDecimal=(value:number|null|undefined)=>typeof value==='number'&&Number.isFinite(value)?value.toFixed(1):'—';
const count=(value:number|null|undefined)=>typeof value==='number'&&Number.isFinite(value)?value:'—';
const stamp=(value:string|null|undefined)=>value?new Date(value).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}):'Not available';
function winnerCall(game:ExperimentGame){
 const margin=game.modelHomeMargin;
 if(typeof margin!=='number'||!Number.isFinite(margin))return 'No projection';
 if(Math.abs(margin)<0.05)return 'Model projects a tie';
 return `${margin>0?game.home:game.away} by ${Math.abs(margin).toFixed(1)} points`;
}
function finalOutcome(game:ExperimentGame){
 const actual=game.actualHomeMargin;
 const model=game.modelHomeMargin;
 if(typeof game.actualHomeScore!=='number'||typeof game.actualAwayScore!=='number')return {text:'Awaiting final',className:'muted'};
 if(typeof actual!=='number'||typeof model!=='number'||!Number.isFinite(actual)||!Number.isFinite(model))return {text:'No winner call',className:'muted'};
 if(Math.abs(actual)<0.05)return {text:'Game tied',className:'amber'};
 if(Math.abs(model)<0.05)return {text:'Projected tie',className:'amber'};
 return Math.sign(actual)===Math.sign(model)?{text:'Winner right',className:'green'}:{text:'Winner missed',className:'red'};
}
function timingLabel(value:string|null|undefined){
 if(!value)return 'Retrospective reconstruction';
 if(value==='late-entered-reconstruction')return 'Late-entered reconstruction · not saved before kickoff';
 if(value==='reconstructed-before-kickoff')return 'Reconstructed before kickoff · not saved then';
 if(value==='reconstructed-after-kickoff')return 'Reconstructed after kickoff';
 if(/pre.?game|before|saved/i.test(value))return 'Saved before kickoff';
 if(/retro|post|after|replay/i.test(value))return 'Retrospective reconstruction';
 return value;
}
function finalScoreFromSummary(game:ExperimentGame,body:EspnSummary){
 const header=body?.header;
 if(String(header?.id)!==String(game.id)||!game.homeId||!game.awayId)return null;
 const competition=header?.competitions?.[0];
 if(competition?.status?.type?.completed!==true)return null;
 const competitors=competition?.competitors;
 if(!Array.isArray(competitors))return null;
 const home=competitors.find(item=>item.homeAway==='home');
 const away=competitors.find(item=>item.homeAway==='away');
 if(String(home?.team?.id)!==String(game.homeId)||String(away?.team?.id)!==String(game.awayId))return null;
 if(home?.score==null||away?.score==null)return null;
 const homeScore=Number(home.score),awayScore=Number(away.score);
 if(!Number.isFinite(homeScore)||!Number.isFinite(awayScore))return null;
 const actualHomeMargin=homeScore-awayScore;
 return {actualHomeScore:homeScore,actualAwayScore:awayScore,actualHomeMargin,absoluteError:typeof game.modelHomeMargin==='number'?Math.abs(actualHomeMargin-game.modelHomeMargin):null};
}
async function getVerifiedFinal(game:ExperimentGame,signal:AbortSignal){
 if(!/^\d+$/.test(String(game.id))||!/^\d+$/.test(String(game.homeId))||!/^\d+$/.test(String(game.awayId)))return null;
 const url=`https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=${encodeURIComponent(game.id)}`;
 const response=await fetch(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(12000)]),cache:'no-store'});
 if(!response.ok)return null;
 return finalScoreFromSummary(game,await response.json() as EspnSummary);
}
function referenceSpread(game:ExperimentGame){
 const line=game.lateMarketHomeSpread;
 if(typeof line!=='number'||!Number.isFinite(line))return null;
 if(Math.abs(line)<0.05)return 'Pick’em';
 return `${game.home} ${line>=0?'+':'−'}${Math.abs(line).toFixed(1)}`;
}
function researchTeam(game:ExperimentGame){return game.researchSide==='home'?game.home:game.researchSide==='away'?game.away:game.researchSide;}
function lateCoverResult(game:ExperimentGame):'win'|'loss'|'push'|null{
 if(typeof game.actualHomeMargin!=='number'||typeof game.lateMarketHomeSpread!=='number'||!Number.isFinite(game.actualHomeMargin)||!Number.isFinite(game.lateMarketHomeSpread))return null;
 const side=game.researchSide?.toLowerCase();
 const home=side==='home'||side===game.home.toLowerCase();
 const away=side==='away'||side===game.away.toLowerCase();
 if(!home&&!away)return null;
 const cover=game.actualHomeMargin+game.lateMarketHomeSpread;
 if(Math.abs(cover)<0.000001)return 'push';
 return (home&&cover>0)||(away&&cover<0)?'win':'loss';
}

export default function CollegeExperiment(){
 const date='2026-09-26';
 const [refresh,setRefresh]=useState(0);
 const [data,setData]=useState<Experiment|null>(null);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const [liveScores,setLiveScores]=useState<Record<string,Pick<ExperimentGame,'actualHomeScore'|'actualAwayScore'|'actualHomeMargin'|'absoluteError'>>>({});
 const refreshExperiment=()=>{setLoading(true);setError('');setLiveScores({});setRefresh(value=>value+1);};
 useEffect(()=>{
  const controller=new AbortController();
  fetch(`/api/college-experiment?date=${encodeURIComponent(date)}`,{signal:controller.signal,cache:'no-store'})
   .then(async response=>{const body=await response.json() as Experiment&{error?:string};if(!response.ok)throw new Error(body.error||'The experiment is temporarily unavailable.');return body;})
   .then(result=>setData(result))
   .catch(cause=>{if(cause.name!=='AbortError'){setData(null);setError(cause.message||'The experiment is temporarily unavailable.');}})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>controller.abort();
 },[date,refresh]);
 useEffect(()=>{
  if(!data||data.date!==date)return;
  const controller=new AbortController();
  const pending=data.games.filter(game=>game.actualHomeScore==null&&game.actualAwayScore==null&&game.homeId&&game.awayId).slice(0,80);
  let next=0;
  const worker=async()=>{while(!controller.signal.aborted&&next<pending.length){const game=pending[next++];try{const final=await getVerifiedFinal(game,controller.signal);if(final&&!controller.signal.aborted)setLiveScores(current=>({...current,[game.id]:final}));}catch{/* Keep the saved API value when the optional live source is unavailable. */}}};
  void Promise.all(Array.from({length:Math.min(6,pending.length)},()=>worker()));
  return()=>controller.abort();
 },[data,date]);
 const games=(data?.games||[]).map(game=>({...game,...liveScores[game.id]})).sort((a,b)=>(a.startTime||'').localeCompare(b.startTime||''));
 const extraFinals=Object.keys(liveScores).length;
 const settled=extraFinals?games.filter(game=>typeof game.actualHomeMargin==='number'&&typeof game.modelHomeMargin==='number'):[];
 const derivedWins=settled.filter(game=>Math.sign(game.actualHomeMargin!)===Math.sign(game.modelHomeMargin!)&&game.actualHomeMargin!==0&&game.modelHomeMargin!==0).length;
 const derivedLosses=settled.filter(game=>Math.sign(game.actualHomeMargin!)!==Math.sign(game.modelHomeMargin!)&&game.actualHomeMargin!==0&&game.modelHomeMargin!==0).length;
 const winnerWins=extraFinals?derivedWins:data?.summary?.winnerWins||0;
 const winnerLosses=extraFinals?derivedLosses:data?.summary?.winnerLosses||0;
 const winnerTies=extraFinals?settled.length-derivedWins-derivedLosses:data?.summary?.winnerTies||0;
 const marginErrors=extraFinals?settled.map(game=>Math.abs(game.actualHomeMargin!-game.modelHomeMargin!)).sort((a,b)=>a-b):[];
 const mae=extraFinals&&marginErrors.length?marginErrors.reduce((sum,value)=>sum+value,0)/marginErrors.length:data?.summary?.mae;
 const medianError=extraFinals&&marginErrors.length?(marginErrors[Math.floor((marginErrors.length-1)/2)]+marginErrors[Math.floor(marginErrors.length/2)])/2:data?.summary?.medianAbsoluteError;
 const lateResults=extraFinals?games.map(lateCoverResult).filter((result):result is 'win'|'loss'|'push'=>result!==null):[];
 const lateMarketCount=data?.summary?.lateMarketCount??games.filter(game=>referenceSpread(game)!==null).length;
 const lateMarketWins=extraFinals?lateResults.filter(result=>result==='win').length:data?.summary?.lateMarketWins||0;
 const lateMarketLosses=extraFinals?lateResults.filter(result=>result==='loss').length:data?.summary?.lateMarketLosses||0;
 const lateMarketPushes=extraFinals?lateResults.filter(result=>result==='push').length:data?.summary?.lateMarketPushes||0;
 const decided=winnerWins+winnerLosses;
 const noMarketCount=data?.coverage?.noMarketOnBoard??games.filter(game=>game.category==='no-market-on-board').length;
 const omittedCount=data?.coverage?.omittedFromBoard??games.filter(game=>game.category==='omitted-from-board').length;
 return <ResearchFrame active="results"><div className="page-heading college-experiment-heading"><div><p className="eyebrow">COLLEGE FOOTBALL · SEPTEMBER 26 EXPERIMENT</p><h1>The rest of the college slate.</h1><p className="muted">Model winner, projected margin, final score. No original market spread required.</p></div><div><Link href="/?sport=cfb">College game board ↗</Link> · <Link href="/weekly-results?sport=cfb">Official college results ↗</Link></div></div>
 <section className="panel college-experiment-intro"><div><span className="tag">LATE-ENTERED LINES · SEP 26, 2026</span><h2>What the model would call</h2><p>This includes games marked “no market spread” on the saved board, games the board missed entirely, and priced games without a saved forecast. Each gets a projected winner and margin, then a comparison with the final score. Unrated teams use an explicit low-confidence prior. A line such as “Tennessee by 5.7” means the model expects Tennessee to win by 5.7 points.</p></div><p className="fine">Every reconstructed line counts in the college result and simulated bankroll. The lines were entered at their real late timestamps; September 26 scores and later reference spreads did not set the model margins. The paper replay uses archived opening spread contracts where available and an even-money winner contract for the three games with no sportsbook quote. Details stay in the <Link href="/learning-log">learning log</Link>.</p></section>
 <div className="toolbar college-experiment-toolbar"><span className="college-fixed-date">Saturday, September 26, 2026 · Eastern game date</span><button className="college-refresh" type="button" disabled={loading} onClick={refreshExperiment}><RefreshCw size={16} className={loading?'spin':''}/> Refresh experiment</button></div>
 {error&&<div className="error" role="alert">{error} <button type="button" onClick={refreshExperiment}>Try again</button></div>}
 {loading?<output className="loading">Building the college-football comparison…</output>:data&&<>
 <p className="college-experiment-source">Rating model captured {stamp(data.cohortCapturedAt)} · Score check {stamp(data.generatedAt)} · Model training cutoff: {data.asOf||'Unavailable'} (Eastern game date). Coverage reflects the games the published sources discovered for {data.date}.</p>
 <div className="college-experiment-coverage"><span><b>{noMarketCount}</b> shown on the saved board without a market spread</span><span><b>{omittedCount}</b> omitted from the saved board</span><span><b>{count(data.coverage?.pricedWithoutSaved)}</b> priced on the board without a saved forecast</span></div>
 <div className="stats-grid college-experiment-stats"><div><span>SOURCE GAMES</span><strong>{count(data.coverage?.discovered)}</strong><small>{count(data.coverage?.savedBeforeKickoff)} saved before kickoff · {count(data.coverage?.projected)} reconstructed</small></div><div><span>WORKSHEET FINALS</span><strong>{count((data.coverage?.finals||0)+extraFinals)}</strong><small>{extraFinals?`${extraFinals} newly checked in your browser`:'Actual scores available'}</small></div><div><span>WINNER CALLS</span><strong>{winnerWins}–{winnerLosses}{winnerTies?`–${winnerTies}`:''}</strong><small>{decided?`${(100*winnerWins/decided).toFixed(1)}% of decided calls`:'No decided calls yet'} · retrospective</small></div><div><span>MARGIN ERROR</span><strong>{oneDecimal(mae)} <em>pts</em></strong><small>Mean absolute · median {oneDecimal(medianError)} pts</small></div></div>
 <p className="college-experiment-late-summary">Paper bankroll sources: {count(data.coverage?.archivedOpeningQuotes)} archived DraftKings opening spread quotes · {count(data.coverage?.syntheticWinnerContracts)} synthetic even-money winner contracts. Each September 26 game stakes 2% of that day’s opening paper bankroll.{data.coverage?.priorOnly?` ${data.coverage.priorOnly} games use at least one unrated-team prior.`:''}</p>
 <p className="fine">Late reference spreads: {lateMarketCount} found · {lateMarketWins}–{lateMarketLosses}–{lateMarketPushes} research cover results. These later spreads are shown only for comparison; the paper ledger uses the opening quotes or the three synthetic winner contracts.</p>
 <div className="board-title"><h2>{data.date} · {games.length} games</h2><span className="fine">A positive home margin projects the home team to win</span></div>
 {!games.length?<div className="empty"><h3>No games found for this date.</h3><p>The free source may have incomplete coverage. Refresh to check again.</p></div>:<ul className="college-experiment-board" aria-label="College football projections and finals">{games.map(game=>{const outcome=finalOutcome(game);const final=typeof game.actualHomeScore==='number'&&typeof game.actualAwayScore==='number';const late=referenceSpread(game);const cover=extraFinals?lateCoverResult(game):game.coverOutcome;return <li className="college-experiment-game" key={game.id}><div className="college-experiment-matchup"><span className="college-category">{game.category==='no-market-on-board'?'No market on saved board':game.category==='omitted-from-board'?'Omitted from saved board':game.category==='priced-without-saved-forecast'?'Priced · no saved forecast':'Additional game'}</span><strong>{game.away} <span className="at">at</span> {game.home}</strong><span className="subline">{stamp(game.startTime)}</span><span className="subline">{timingLabel(game.forecastTiming)}</span></div><div><span className="college-experiment-label">Model says</span><strong className="college-experiment-pick">{winnerCall(game)}</strong><span className="subline">Home margin: {typeof game.modelHomeMargin==='number'?`${game.modelHomeMargin>0?'+':''}${oneDecimal(game.modelHomeMargin)} pts`:'—'} · {game.modelVersion||'Model version unavailable'}{game.ratingCoverage&&game.ratingCoverage!=='both-rated'?` · ${game.ratingCoverage==='both-prior'?'both teams use priors':'one team uses a prior'}`:''}</span></div><div><span className="college-experiment-label">Final · away–home</span><strong className="college-experiment-final">{final?`${game.actualAwayScore}–${game.actualHomeScore}`:'Awaiting final'}</strong><span className="subline">{final?`Actual home margin: ${typeof game.actualHomeMargin==='number'?`${game.actualHomeMargin>0?'+':''}${oneDecimal(game.actualHomeMargin)}`:'—'} pts`:'No final score yet'}</span></div><div className="college-experiment-grade"><span className={`college-experiment-outcome ${outcome.className}`}>{outcome.text}</span><span className="subline">{final&&typeof game.absoluteError==='number'?`${oneDecimal(game.absoluteError)} pts margin error`:'No margin grade yet'}</span>{game.sourceUrl&&<a href={game.sourceUrl} target="_blank" rel="noreferrer">Inspect source ↗</a>}</div>{late&&<div className="college-experiment-late-market"><b>Late reference spread: {late}</b><span>{game.lateMarketProvider||'Provider not recorded'} · retrieved later, timing unverified</span>{game.researchSide&&<span>Research side: {researchTeam(game)}{cover?` · ${cover} against this late reference`:''}</span>}</div>}</li>;})}</ul>}
 {typeof data.coverage?.missing==='number'&&data.coverage.missing>0&&<p className="coverage-warning">{data.coverage.missing} discovered games lack a model projection. They remain visible in the list so coverage gaps are not mistaken for correct calls.</p>}
 <p className="fine college-experiment-footnote">Every reconstructed winner and score-margin call enters the inclusive official college model record once. The paper bankroll also includes each game using the contract sources described above. Late reference spreads and their cover results remain hindsight research; they do not change the opening-contract grades or payouts. Browser-checked finals here are display-only until an exact event and team match is saved in the official results.</p>
 </>}</ResearchFrame>;
}
