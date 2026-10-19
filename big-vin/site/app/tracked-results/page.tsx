'use client';
import {VersionBadge} from '@/components/version-badge';
import {useCallback,useEffect,useState} from 'react';
import {useRefreshingResource} from '@/components/use-refreshing-resource';
import ResearchFrame from '@/components/research-frame';
import {CARD_LABELS} from '@/lib/ranked-card-summary.mjs';
import {summarizeSpreadPicks} from '@/lib/spread-record.mjs';
import {modelLabel} from '@/lib/model-versions';
import styles from './tracked-results.module.css';
const sports:Record<string,string>={cfb:'College football',nfl:'NFL',nba:'NBA',wnba:'WNBA',cbb:'College hoops',nhl:'NHL',mlb:'MLB'};
const dateText=(s:string)=>new Date(s+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'America/New_York'});
const stamp=(s:string)=>new Date(s).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:'America/New_York',timeZoneName:'short'});
const signed=(n:any)=>typeof n==='number'?`${n>0?'+':''}${n}`:'—';
const rate=(s:any)=>s?.wins+s?.losses?`${(100*s.wins/(s.wins+s.losses)).toFixed(1)}%`:'—';
export default function TrackedResults(){
 const [query,setQuery]=useState<URLSearchParams|null>(null);
 useEffect(()=>{setQuery(new URLSearchParams(window.location.search));},[]);
 const sport=query?.get('sport')&&sports[query.get('sport')!]?query.get('sport')!:'cfb';
 const card=query?.get('card')&&Object.hasOwn(CARD_LABELS,query.get('card')!)?query.get('card')!:'all';
 const season=query?.get('season');
 const params=new URLSearchParams(query||{});params.set('sport',sport);params.set('history','1');params.set('cohort','live');
 const url=query?'/api/results?'+params:'';
 const read=useCallback(async()=>{if(!url)return null;const r=await fetch(url);if(!r.ok)throw new Error('Pick history is temporarily unavailable.');const d:any=await r.json();if(d.view!=='tracked-history')throw new Error('Pick history is temporarily unavailable.');return d;},[url]);
 const {data,error,busy,load}=useRefreshingResource<any>(url,read);
 const change=(key:string,value:string)=>{setQuery(previous=>{const next=new URLSearchParams(previous||{});next.set(key,value);if(key==='week')next.delete('historyDate');if(key==='sport'){next.delete('week');next.delete('season');next.delete('historyDate');}return next;});};
 const scoped=season?data?.seasonRecord:data;
 const total=card==='all'?scoped:scoped?.rankedCards?.[card];
 const rows=(data?.records||[]).filter((f:any)=>(!season||String(f.season)===season)&&(card==='all'||(f.cardRank&&f.cardRank<=Number(card))));
 const weekSummary=summarizeSpreadPicks(rows);
 const coverage=total?.coverage||scoped?.coverage;
 const versionsLink=`/weekly-results?sport=${sport}&cohort=live`;
 return <ResearchFrame active="results"><div className="page-heading"><div><p className="eyebrow">THE SAVED RECORD</p><h1>Every included pick.</h1><p className="muted">{sports[sport]} · {CARD_LABELS[card as keyof typeof CARD_LABELS]} · {season?`${season} tracked season`:'All tracked dates'}</p></div><a className={styles.back} href={`/?sport=${sport}&view=records`}>Back to the board ↗</a></div>
  <div className={styles.toolbar}>
   <label>Sport<select aria-label="History sport" value={sport} onChange={e=>change('sport',e.target.value)}>{Object.entries(sports).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
   <label>Card<select aria-label="History card" value={card} onChange={e=>change('card',e.target.value)}>{Object.entries(CARD_LABELS).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
   <label>{data?.selectedPeriod?'Browse league weeks':'Week'}<select aria-label="History week" value={query?.get('historyDate')?'':query?.get('week')||data?.selectedWeek||''} onChange={e=>change('week',e.target.value)}>{query?.get('historyDate')&&<option value="">Selected calendar week</option>}{(scoped?.weeks||data?.weeks||[]).map((w:any)=><option key={w.key} value={w.key}>{w.key.includes('-W')?w.key.replace('-W',' · Week '):'Week of '+dateText(w.key)}</option>)}</select></label>
   <button disabled={busy} onClick={()=>void load()}>{busy?'Checking…':'Refresh results'}</button>
  </div>
  {error&&<p role="alert" className={styles.warning}>{data?'Refresh unavailable. Showing the last checked history.':error}</p>}
  {busy&&!data&&<p role="status">Loading saved pick history…</p>}
  {data&&<>
   <div className={styles.totals}><div><span>{season?'Tracked season':'All tracked dates'}</span><strong>{rate(total?.spreadOverall)}</strong><b>{total?.spreadOverall?.wins??0}–{total?.spreadOverall?.losses??0}–{total?.spreadOverall?.pushes??0}</b><small>Win–Loss–Push · {total?.spreadOverall?.graded??0} graded / {total?.spreadOverall?.recorded??0} saved</small></div><div><span>{data.selectedPeriod?`${dateText(data.selectedPeriod.start)}–${dateText(data.selectedPeriod.end)} · ET`:'Selected league week'}</span><strong>{rate(weekSummary)}</strong><b>{weekSummary.wins}–{weekSummary.losses}–{weekSummary.pushes}</b><small>{weekSummary.graded} graded / {weekSummary.recorded} saved · {weekSummary.pending} pending</small></div></div>
   <p className={styles.coverage}><b>Full-season record unavailable.</b> {coverage?.firstDate&&coverage.lastDate?`This record covers saved picks dated ${dateText(coverage.firstDate)}–${dateText(coverage.lastDate)}. `:''}Earlier or missed games are not recreated. Pending games, missing lines, pushes and voids do not enter win percentage.</p>
   <details className={styles.method}><summary>How a saved pick enters this record</summary><p>Each game appears once, using its authentic pregame forecast from the formula eligible for that game under the saved activation dates and reporting-week rules. Selection never uses the result, win rate or most favorable version. If that eligible version was not captured before the game, the game is excluded.</p><p>The ledger has no historical “displayed primary” marker. This is a reproducible selection from saved version history, not proof that every historical visitor saw the same card. Recovered cards, retrospective tests, late forecasts and the September 26 reconstruction stay separate. Original versions are retained. For games enrolled in pregame revisions, the latest valid saved selection locks by kickoff for grading. Historical games are never recreated from later information.</p><p>{data.policy?.unavailableGames||0} games lack an eligible saved pregame pick. {data.policy?.metadataConflictGames||0} games have differing saved schedule snapshots; the earliest genuine snapshot determines formula ownership. {data.policy?.excluded?.['reconstructed-or-recovered']||0} reconstructed or recovered rows stay outside this record.</p><p>Ranking period: {query?.get('rankPeriod')==='day'?'each Eastern game day':query?.get('rankAnchor')?'seven-day windows anchored to '+query.get('rankAnchor'):'each league reporting week'}. Ranked cards retain their positions within each original formula’s selected ranking period. Exclusions do not promote lower-ranked picks. A mixed-version bankroll is not calculated here. <a href={versionsLink}>Open individual formula results and their simulated bankrolls ↗</a></p></details>
   <h2 className={styles.listHeading}>{rows.length} saved picks · {data.selectedPeriod?`${dateText(data.selectedPeriod.start)}–${dateText(data.selectedPeriod.end)} · ET`:data.selectedWeek?.replace('-W',' · Week ')||'No captured week'}</h2>
   <div className={styles.records}>{rows.map((f:any)=>{const grade=f.spreadGrade;const side=grade?.side||f.side;const selection=side==='home'?f.home:side==='away'?f.away:'No spread pick';const spread=typeof grade?.selectedSpread==='number'?grade.selectedSpread:typeof f.marketHomeSpread==='number'?(side==='home'?f.marketHomeSpread:-f.marketHomeSpread):null;const outcome=grade?.outcome||'ungraded';return <article className={styles.pick} key={f.id}>
    <div className={styles.matchup}><span className={styles.rank}>{f.cardRank?`#${f.cardRank}`:'—'}</span><div><h3>{f.away} at {f.home} <VersionBadge record={f} sport={sport}/></h3><p>{stamp(f.result?.playedAt||f.startTime)}</p></div><span className={styles.outcome} data-outcome={outcome}>{outcome}</span></div>
    <div className={styles.pickLine}><b>{selection} {spread!==null?signed(spread):''}</b><span>{f.result?.status==='completed'?`Final: ${f.away} ${f.result.awayScore} · ${f.home} ${f.result.homeScore}`:'Awaiting verified final'}</span></div>
    <details><summary>Forecast &amp; pick history</summary><div><p>{modelLabel(sport,f.modelVersion)} · {f.modelVersion}</p><p>Saved {stamp(f.capturedAt)} · Training before {f.trainingCutoff||'not stored'}</p><p>Original home-margin forecast: {signed(f.predictedMargin)} · Saved home spread: {signed(f.marketHomeSpread)} · Saved price: {signed(f.odds)}</p>{f.pickRevision&&<p>Pick revision saved {stamp(f.pickRevision.recordedAt)} · Locked by {stamp(f.pickLock.lockAt)}.</p>}{f.originalPick&&<p>Original selection: {f.originalPick.side==='home'?f.home:f.originalPick.side==='away'?f.away:'No pick'} · Home spread {signed(f.originalPick.marketHomeSpread)} · Saved {stamp(f.originalPick.recordedAt||f.originalPick.capturedAt)}.</p>}{f.firstMarket&&<p>First available market captured {stamp(f.firstMarket.observedAt)}, before the game. The original unpriced forecast is preserved.</p>}{f.coverageNote&&<p>{f.coverageNote}</p>}{f.sourceUrl&&<a href={f.sourceUrl} target="_blank" rel="noreferrer">Game source ↗</a>}</div></details>
   </article>})}</div>
   {!rows.length&&<p className={styles.coverage}>No qualifying saved picks in this week and card. Missing history is not shown as a zero-loss record.</p>}
  </>}
 </ResearchFrame>;
}
