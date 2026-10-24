'use client';

import {useCallback,useEffect,useState} from 'react';
import {useRefreshingResource} from '@/components/use-refreshing-resource';
import {modelSpec} from '@/lib/model-versions';
import {CARD_LABELS} from '@/lib/ranked-card-summary.mjs';
import {aggregateRecordDays,calendarRecordWeek} from '@/lib/record-periods.mjs';
import {activeProviderSeason} from '@/lib/provider-season.mjs';
import {truthMeter} from '@/lib/spread-record.mjs';
import {TOTALS_RECORD_SPORTS} from '@/lib/totals-record.mjs';
import styles from './record-summary.module.css';

type Counts={recorded:number;graded:number;pending:number;wins:number;losses:number;pushes:number;winRate:number|null;voids?:number;unlined?:number;units?:number;risked?:number;breakEvenSum?:number;decided?:number;truthLogs?:number[]|null;clvSum?:number;clvCount?:number;assumedPrices?:number;legacyRunLine?:Counts};
type Day=Counts & {date:string};
type Coverage={saved:number;seasonUnknownCount:number;firstDate:string|null;lastDate:string|null;complete:boolean};
type SeasonView={spreadOverall:Counts;coverage:Coverage};
type View={spreadDays:Day[];spreadOverall:Counts};
type History=View & {sport:string;view:string;rankedCards:Record<string,View>;seasonRecord?:SeasonView & {season:number;rankedCards:Record<string,SeasonView>};coverage:Coverage;policy:any;lastCollectionAt:string|null;liveCheck?:{checkedAt:string|null;warnings:string[]}};
type TotalsView={sport:string;view:string;hasPicks:boolean;days:Day[];overall:Counts;generatedAt:string|null;version:string|null};
type SeasonContext={year?:number;label?:string;startDate?:string|null;endDate?:string|null;observedAt?:string|null};
type RecordKind='ats'|'totals';
const empty:Counts={recorded:0,graded:0,pending:0,wins:0,losses:0,pushes:0,winRate:null};
const money=(value:number)=>`${value>=0?'+':'−'}$${Math.abs(value).toFixed(2)}`;
const dateLabel=(date:string,year=false)=>new Date(date+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',...(year?{year:'numeric' as const}:{}),timeZone:'America/New_York'});
function RecordCard({kindLabel,title,caption,summary,loading,error}:{kindLabel:string;title:string;caption:string;summary:Counts|null|undefined;loading:boolean;error:boolean}){
 const available=summary!=null&&!error;
 const meter=available&&summary.decided?truthMeter(summary.truthLogs):null;
 const profit=available&&summary.risked?money(summary.units!/summary.risked):null;
 const record=available?`${summary.wins}–${summary.losses}–${summary.pushes}`:null;
 return <article className={styles.card}>
  <p className={styles.kindLabel}>{kindLabel}</p>
  <h3>{title}</h3><p className={styles.caption}>{caption}</p>
  <strong className={styles.rate}>{record??(loading&&!error?'…':'—')}</strong>
  <span className={styles.scoreLabel}>{available&&summary.winRate!==null?`${(summary.winRate*100).toFixed(1)}% won · win · loss · push`:'Win · Loss · Push'}{available&&summary.decided?` · break-even ${(summary.breakEvenSum!/summary.decided*100).toFixed(1)}%`:''}</span>
  <b className={`${styles.score}${profit&&profit.startsWith('+')?` ${styles.scoreUp}`:''}${profit&&profit.startsWith('−')?` ${styles.scoreDown}`:''}`}>{profit??'—'}</b>
  <span className={styles.scoreLabel}>Profit per $1 wagered</span>
  {available&&meter!==null&&<div className={styles.meter}>Truth meter <b>{meter<10?meter.toFixed(1):Math.round(meter)}×</b> of 20× proof <details className={styles.what}><summary>What’s this?</summary><p>It’s a running bet against luck that starts at 1×. It rises when picks win more often than break-even would predict and falls when they don’t. At 20×, luck alone is less than a 5% explanation.</p></details></div>}
  {available&&!!summary.clvCount&&kindLabel==='Against the spread'&&<p className={styles.status}>Line moved our way {(summary.clvSum!/summary.clvCount>0?'+':'')+(summary.clvSum!/summary.clvCount).toFixed(1)} points on average by kickoff ({summary.clvCount} picks)</p>}
  <p className={styles.status}>{available?`${summary.graded} graded · ${summary.recorded} saved`:error?'Unavailable':loading?'Loading…':'Unavailable'}</p>
  {available&&!!summary.pending&&<p className={styles.status}>{summary.pending} pending</p>}
  {available&&!!summary.unlined&&<p className={styles.status}>{summary.unlined} without a line</p>}
  {available&&!!summary.voids&&<p className={styles.status}>{summary.voids} void</p>}
 </article>;
}
export function RecordSummary({sport,sportLabel,date,refreshKey,card='all',rankPeriod='week',rankAnchor,seasonContext=null}:{sport:string;sportLabel:string;date:string;refreshKey:number;card?:string;rankPeriod?:'day'|'week';rankAnchor?:string;seasonContext?:SeasonContext|null}){
 const season=activeProviderSeason(seasonContext),spec=modelSpec(sport);
 const canTotals=TOTALS_RECORD_SPORTS.includes(sport);
 const [kind,setKind]=useState<RecordKind>('ats');
 useEffect(()=>{setKind('ats');},[sport]);
 const params=new URLSearchParams({sport,cohort:'live',history:'1',rankPeriod,historyDate:date});
 if(season!==null)params.set('season',String(season));
 if(rankPeriod==='week'&&rankAnchor)params.set('rankAnchor',rankAnchor);
 // summary=1 keeps the multi-MB pick list off the phone; pick-history links omit it.
 const atsUrl='/api/results?'+new URLSearchParams({...Object.fromEntries(params),summary:'1'});
 const totalsUrl='/api/totals?sport='+encodeURIComponent(sport);
 const readAts=useCallback(async()=>{const response=await fetch(atsUrl,{signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error('Saved results unavailable');const result:any=await response.json();if(result.sport!==sport||result.view!=='tracked-history')throw new Error('Saved history unavailable');return result as History;},[atsUrl,sport]);
 const readTotals=useCallback(async()=>{const response=await fetch(totalsUrl,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error('Totals record unavailable');const result:any=await response.json();if(result.sport!==sport||result.view!=='totals-record')throw new Error('Totals history unavailable');return result as TotalsView;},[totalsUrl,sport]);
 const ats=useRefreshingResource<History>(atsUrl,readAts);
 const totals=useRefreshingResource<TotalsView>(canTotals?totalsUrl:'__no-totals__',canTotals?readTotals:async()=>({sport,view:'totals-record',hasPicks:false,days:[],overall:empty,generatedAt:null,version:null} as TotalsView));
 useEffect(()=>{const check=()=>{if(document.visibilityState==='visible'){void ats.load();if(canTotals)void totals.load();}};const timer=setInterval(check,60000);window.addEventListener('focus',check);document.addEventListener('visibilitychange',check);return()=>{clearInterval(timer);window.removeEventListener('focus',check);document.removeEventListener('visibilitychange',check);};},[ats.load,totals.load,canTotals]);
 useEffect(()=>{void ats.load();if(canTotals)void totals.load();},[refreshKey,ats.load,totals.load,canTotals]);
 const showTotals=kind==='totals'&&canTotals;
 const current=ats.data?.sport===sport?ats.data:null;
 const totalsData=totals.data?.sport===sport?totals.data:null;
 const scoped=card==='all'?current:current?.rankedCards?.[card];
 const seasonView=current?.seasonRecord?.season===season?(card==='all'?current.seasonRecord:current.seasonRecord.rankedCards?.[card]):null;
 const coverage=seasonView?.coverage;
 const unavailable=showTotals?!!totalsData&&!totalsData.hasPicks:!!current&&!scoped;
 const loading=showTotals?totals.busy:ats.busy;
 const refreshError=showTotals?totals.error:ats.error;
 const error=showTotals?((!totalsData&&!!refreshError)||unavailable):((!current&&!!refreshError)||unavailable);
 const kindLabel=showTotals?'Totals':'Against the spread';
 const daily=showTotals?(totalsData?.days.find(row=>row.date===date)??empty):(scoped?scoped.spreadDays.find(row=>row.date===date)??empty:null);
 const week=calendarRecordWeek(date);
 const weekly=showTotals?(totalsData?aggregateRecordDays(totalsData.days,week):null):(scoped?aggregateRecordDays(scoped.spreadDays,week):null);
 const seasonSummary=showTotals?(totalsData?.overall??null):(seasonView?.spreadOverall??null);
 const label=CARD_LABELS[card as keyof typeof CARD_LABELS]||CARD_LABELS.all;
 const href='/tracked-results?'+new URLSearchParams({...Object.fromEntries(params),card});
 const tuned=!!spec.parameters&&!!spec.startDate;
 const fresh=tuned&&current&&!showTotals?current.spreadDays.filter(day=>day.date>=spec.startDate).reduce((sum,day)=>sum+(day.graded||0),0):0;
 const hindsight=!showTotals&&tuned&&current&&fresh<300?` · Tuned on past games: ${fresh} of 300 new picks graded`:'';
 const checked=current?.liveCheck?.checkedAt||current?.lastCollectionAt;
 const totalsReady=canTotals&&!!totalsData?.hasPicks;
 return <section className={styles.summary} aria-label={`${sportLabel} saved pick record`} aria-busy={loading}>
  <div className={styles.heading}><div><h2>{sportLabel} record</h2><p>{showTotals?'Over / under':sport==='mlb'?'Moneyline':sport==='nhl'?'Puck line':'Against the spread'} · {card==='all'?label:'Saved '+label} · Kickoff-locked picks{hindsight}</p></div><a href={href}>Pick history ↗</a></div>
  {(totalsReady||(canTotals&&totals.busy))&&<div className={styles.kindTabs} role="tablist" aria-label={`${sportLabel} record type`}>
   <button type="button" role="tab" aria-selected={!showTotals} className={!showTotals?styles.kindTabActive:styles.kindTab} onClick={()=>setKind('ats')}>Against the spread</button>
   <button type="button" role="tab" aria-selected={showTotals} className={showTotals?styles.kindTabActive:styles.kindTab} onClick={()=>setKind('totals')} disabled={!totalsReady}>{totals.busy&&!totalsReady?'Totals…':'Totals'}</button>
  </div>}
  <p className={styles.flatNote}>Flat $1 on every pick · not Kelly. See <a href="/bankroll">Bankroll</a> for Kelly sizing.</p>
  <div className={styles.grid}>
   <RecordCard kindLabel={kindLabel} title="Day" caption={dateLabel(date)+' · ET'} summary={daily} loading={loading} error={error}/>
   <RecordCard kindLabel={kindLabel} title="Week" caption={week?`${dateLabel(week.start)}–${dateLabel(week.end)}`:'Mon–Sun ET'} summary={weekly} loading={loading} error={error}/>
   <RecordCard kindLabel={kindLabel} title="Tracked season" caption={showTotals?(totalsData?.version?`Totals · ${totalsData.version.replace(/^bv-/,'').replace(/-totals-v1$/,'')}`:'Totals experiment'):(season!==null?`${seasonContext?.label||season} · partial`:'Season unverified')} summary={seasonSummary} loading={loading} error={error}/>
  </div>

  {!showTotals&&sport==='mlb'&&seasonView?.spreadOverall?.legacyRunLine&&(()=>{const o=seasonView.spreadOverall.legacyRunLine!;return <p className={styles.status}>Earlier +1.5 run line picks (before the switch to moneyline): {o.wins}–{o.losses}{o.pushes?`–${o.pushes}`:''}{o.risked?`, ${money(o.units!/o.risked)} per $1`:''}. Not included above.</p>;})()}
  {error&&<p className={styles.warning} role="alert">Could not load the saved record. Refresh to try again.</p>}
  {refreshError&&(showTotals?totalsData:current)&&<p className={styles.warning} role="status">Refresh unavailable. Showing the last checked record.</p>}
  <details className={styles.details}><summary>Record method &amp; coverage</summary><div>
   {showTotals?<>
    <p>Totals picks are the over/under experiment: one side per game when the model clears its edge threshold, locked before tip. Day and week use kickoff Eastern date. Tracked season is every graded totals pick in the current table.</p>
    <p>Profit per $1 wagered adds up every graded totals pick at the price we took (pushes return the stake; picks without a saved price use the standard −110). Break-even is the win rate those prices need to come out even.</p>
    <p>Truth meter: same proof mix as the spread record — a fixed-stake martingale against break-even luck. It starts at 1×. At 20× luck alone is under a 5% explanation.</p>
    <p>Win % = wins ÷ (wins + losses). Pushes and pending games are excluded. Week is Monday–Sunday in Eastern time. Against-the-spread picks are not included here.</p>
    {totalsData?.generatedAt&&<p>Totals table generated {new Date(totalsData.generatedAt).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:'America/New_York'})} ET.</p>}
   </>:<>
   <p>{coverage?.firstDate&&coverage.lastDate?`Tracked picks: ${dateLabel(coverage.firstDate,true)}–${dateLabel(coverage.lastDate,true)}. Coverage is partial.`:'Tracked coverage is partial.'}</p>
   <p>One authentic pregame forecast per game, following the formula active for that game. Valid pregame revisions lock by kickoff. Earlier versions stay in each game’s history; past picks are never recreated from later information. Reconstructed and retrospective predictions are excluded. <a href={href}>See every included pick and the selection policy ↗</a></p>
   <p>Profit per $1 risked adds up every graded pick at the price we took (pushes return the stake; picks without a saved price use the standard −110). Break-even is the win rate those prices need to come out even.</p>
   <p>Truth meter: we pretend to bet a small, fixed share of an imaginary bankroll on every pick, each paid as if it just broke even. A lucky streak can’t grow that bankroll much for long; real skill keeps growing it. It starts at 1×. At 20× the chance that luck alone explains the record is under 5%, and only then would we call it proven.</p>
   <p>Line moved our way: how many points better our side’s number was than the final pregame line. Saved for picks graded from Oct 22, 2026 on.</p>
   <p>Win % = wins ÷ (wins + losses). Pushes, pending games, voids and games without a graded line are excluded. Week is Monday–Sunday in Eastern time. Search filters do not change this {label.toLowerCase()} record.</p>
   {current?.policy&&<p>{current.policy.unavailableGames||0} games lack an eligible pregame pick; {current.policy.metadataConflictGames||0} games have differing saved schedule snapshots. Selection uses the earliest genuine snapshot. The ledger has no historical displayed-card marker.</p>}
   <p>Ranked cards retain their rank within the original formula and selected ranking period; excluded games never promote a pick. These saved-card ranks can differ from the current board window’s ranks. {coverage?.seasonUnknownCount?`${coverage.seasonUnknownCount} picks without a verified season tag are excluded.`:''}</p>
   {hindsight&&<p>Tuned on past games: these weights were picked by looking back at games already played, which flatters them. We keep that label until 300 picks made after the weights went live have been graded.</p>}
   <p>Current model: {spec.label}. This is the weights date, separate from the record dates above. <a href={`/weekly-results?sport=${sport}&cohort=live&version=${encodeURIComponent(spec.id)}`}>Formula results &amp; simulated bankroll ↗</a></p>
   {checked&&<p>Finals checked {new Date(checked).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:'America/New_York'})} ET. Auto-checks every minute.</p>}
   </>}
  </div></details>
  {!showTotals&&!!current?.liveCheck?.warnings?.length&&<p className={styles.warning} role="status">{current.liveCheck.warnings.join(' ')}</p>}
 </section>;
}
