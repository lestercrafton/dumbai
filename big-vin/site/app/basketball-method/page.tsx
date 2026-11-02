'use client';
import {useEffect,useState} from 'react';
import {activeModels} from '@/lib/model-versions';
import ResearchFrame from '@/components/research-frame';
const SPORTS=[['nba','NBA'],['cbb','College basketball']] as const;
const METHOD:Record<string,string[]>={
 nba:['Team ratings from every NBA final in the last two years, weighted toward the last 45 days and refit every day.','Back-to-backs and time zones crossed are priced from 2024-26 results (about −2.3 points for the tired team, −0.2 per time zone). Rest days and travel distance did not help and are not used.','Injuries: ESPN statuses (Out, Doubtful, Questionable) priced by each player’s last-10-game impact.','Win chances use the NBA’s own spread of results (14.6 points), and every game saves its ESPN BET opening and closing line so line value is graded.'],
 cbb:['Preseason priors for every Division I team: last season’s Torvik adjusted efficiency, scaled by returning minutes and incoming transfers (each valued by minutes share at the old school times that school’s efficiency).','Ratings are points per 100 possessions; each game’s margin is scaled by expected possessions from both teams’ Torvik tempo.','Neutral-site games carry no home edge.','A college game only publishes with a priced line and at least 5 recent games for both teams; opening and closing lines are saved for every game.'],
};
const pct=(w:number,l:number)=>w+l?`${(100*w/(w+l)).toFixed(1)}%`:'—';
function Row({label,r}:{label:string,r:any}){if(!r)return null;const clv=r.clvCount?(r.clvSum/r.clvCount):null;return <tr><td>{label}</td><td>{r.wins}–{r.losses}{r.pushes?`–${r.pushes}`:''}</td><td>{pct(r.wins,r.losses)}</td><td>{Number.isFinite(r.units)?`${r.units>=0?'+':''}${r.units.toFixed(2)}u`:'—'}</td><td>{clv===null?'—':`${clv>=0?'+':''}${clv.toFixed(2)}`}</td><td>{r.pending??0}</td></tr>;}
function Record({sport}:{sport:string}){
 const [d,setD]=useState<any>(null),[err,setErr]=useState('');
 useEffect(()=>{fetch(`/api/results?sport=${sport}`).then(r=>r.json()).then(setD).catch(e=>setErr(e.message));},[sport]);
 if(err)return <p className="error" role="alert">{err}</p>;if(!d)return <div className="loading" role="status">Loading the record…</div>;
 const h=d.trackedHistory||{},c=h.rankedCards||{};
 return <table className="data-table"><thead><tr><th>Tier</th><th>Spread W–L</th><th>Win %</th><th>Units</th><th>Avg line value (pts)</th><th>Pending</th></tr></thead><tbody>
  <Row label="Top 3 each week" r={c['3']?.spreadOverall}/><Row label="Top 8 each week" r={c['8']?.spreadOverall}/><Row label="Top 10 each week" r={c['10']?.spreadOverall}/><Row label="Every graded game" r={h.spreadOverall}/>
 </tbody></table>;
}
function Backtest({m}:{m:any}){if(!m?.baseline)return null;const b=m.baseline,s=m.selected;return <table className="data-table"><thead><tr><th>2025-26 holdout</th><th>Games</th><th>Avg error</th><th>Market (opener)</th><th>W–L vs opener</th><th>Line value</th></tr></thead><tbody>
 <tr><td>Ridge v1</td><td>{b.games}</td><td>{b.mae.toFixed(2)}</td><td>{b.marketMae.toFixed(2)}</td><td>{b.wins}–{b.losses} ({pct(b.wins,b.losses)})</td><td>+{b.clv.toFixed(2)}</td></tr>
 <tr><td>{m.label}</td><td>{s.games}</td><td>{s.mae.toFixed(2)}</td><td>{s.marketMae.toFixed(2)}</td><td>{s.wins}–{s.losses} ({pct(s.wins,s.losses)})</td><td>+{s.clv.toFixed(2)}</td></tr></tbody></table>;}
export default function BasketballMethod(){
 return <ResearchFrame active="basketball"><div className="page-heading"><div><p className="eyebrow">HOW BIG VIN PICKS BASKETBALL</p><h1>Basketball method and record</h1><p className="muted">Picks publish only when picks like them have won often enough on graded results to clear break-even. Everything else is shown as a lean: unstaked, still graded.</p></div></div>
 {SPORTS.map(([sport,name])=>{const m=activeModels[sport];return <section className="panel" key={sport} id={sport}><p className="eyebrow">{name.toUpperCase()}{m?` · ${m.label}`:''}</p><h2>Method</h2><ul>{METHOD[sport].map(t=><li key={t}>{t}</li>)}</ul>
  <h2>Live record by tier</h2><Record sport={sport}/>
  <h2>Backtest gate</h2><p className="muted">{m?.validationNote}</p><Backtest m={m}/><p className="fine">{m?.scopeNote} {m?.reportUrl?<a href={m.reportUrl}>Full backtest report ↗</a>:null}</p></section>;})}
 <p className="fine">For entertainment only. Not betting advice.</p></ResearchFrame>;
}
