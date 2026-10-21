'use client';
import {useEffect,useState} from 'react';
import ResearchFrame from '@/components/research-frame';
import {RecordCells} from '@/components/playbook-record';
import {versionLabel} from '@/lib/playbook-client';
const sports:Record<string,string>={nfl:'NFL',cfb:'College football',nba:'NBA',wnba:'WNBA',cbb:'College hoops',nhl:'NHL',mlb:'MLB'};
const day=(s:string)=>new Date(s).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'America/Chicago'});
const weekName=(k:string)=>k.includes('-W')?k.replace('-W',' · Week '):`Week of ${day(k+'T12:00:00Z')}`;
export default function Challengers(){
 const [data,setData]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(true);
 useEffect(()=>{const c=new AbortController();fetch('/api/playbook?view=challengers',{signal:c.signal}).then(async r=>{const d:any=await r.json();if(!r.ok)throw new Error(d.error);setData(d);}).catch(e=>{if(e.name!=='AbortError')setError(e.message);}).finally(()=>{if(!c.signal.aborted)setBusy(false);});return()=>c.abort();},[]);
 const weeks:any[]=data?.weeks||[],promotions:any[]=[...(data?.promotions||[])].reverse();
 return <ResearchFrame active="challengers"><div className="page-heading"><div><p className="eyebrow">SHADOW CHALLENGERS</p><h1>New ideas, tested next to the live picks.</h1><p className="muted">Challengers make their picks before kickoff, just like the live model, but they don&apos;t change what we post. One only takes over after it beats the current playbook on games it had never seen.</p></div><a href="/notes/october-19-2026">Why we&apos;re doing this ↗</a></div>
  <section className="panel playbook-legend"><p>Each row shows one version&apos;s picks against the spread. <b>Record</b> is wins–losses (–pushes) at the line saved before the game. <b>Profit per $1 bet</b> is what each dollar risked would have won or lost at the saved odds. <b>Line movement toward pick</b> is how many points the closing line moved in the pick&apos;s favor, on average. <b>Practice bankroll</b> starts at a pretend $500 per version and sport and risks 2% per pick. <b>Playbook v1 re-run</b> rows replay the live model at the same times and prices as the challengers, for a fair comparison. Season totals count picks saved on or after October 19, 2026. For entertainment only. Not betting advice.</p></section>
  {error?<p className="error" role="alert">{error}</p>:busy?<div className="loading" role="status">Loading this week&apos;s challengers…</div>:!weeks.length?null:weeks.map(w=><section className="panel playbook-week" key={w.weekKey}><h2>{weekName(w.weekKey)}</h2><p className="fine">{w.sports.map((s:string)=>sports[s]||s).join(' · ')}</p>
   <div className="playbook-table-wrap" tabIndex={0}><table className="playbook-table"><thead><tr><th scope="col">Version</th><th scope="col">This week record</th><th scope="col">This week profit per $1 bet</th><th scope="col">This week line movement toward pick</th><th scope="col">Season record</th><th scope="col">Season profit per $1 bet</th><th scope="col">Season line movement toward pick</th><th scope="col">Practice bankroll</th></tr></thead><tbody>
    {w.live.map((l:any)=><tr className="playbook-live" key={'live-'+l.sport}><th scope="row"><span className="playbook-version-badge">{l.versionId}</span> Live model · {sports[l.sport]||l.sport}</th><RecordCells record={l.week} bankroll={false}/><RecordCells record={l.running}/></tr>)}
    {w.challengers.map((c:any)=><tr key={c.versionId}><th scope="row"><span className="playbook-version-badge">{c.versionId}</span> {c.label.replace(/runner mirror/i,"re-run")}{c.idea&&<small> · {c.idea}</small>}{c.role==='frozen'?<small> · Playbook v1 re-run</small>:c.role!=='challenger'&&<small> · {c.role}</small>}</th><RecordCells record={c.week} bankroll={false}/><RecordCells record={c.running}/></tr>)}
   </tbody></table></div>
   {w.challengers.some((c:any)=>c.summary)&&<ul className="playbook-ideas">{w.challengers.filter((c:any)=>c.summary).map((c:any)=><li key={c.versionId}><b>{c.label}:</b> {c.summary}</li>)}</ul>}
  </section>)}
  {promotions.length>0&&<section className="panel playbook-promotions" id="promotions"><p className="eyebrow">PROMOTION HISTORY</p><h2>When a challenger took over</h2>
   <ol className="playbook-timeline">{promotions.map(p=><li key={p.id}><div className="entry-meta"><span>{day(p.effectiveAt)} · {(sports[p.sport]||p.sport)}</span><span className="tag">PROMOTED</span></div><h3><span className="playbook-version-badge">{p.toVersionId}</span> {versionLabel(p.toVersionId,data?.manifest)} replaced <span className="playbook-version-badge">{p.fromVersionId}</span> {versionLabel(p.fromVersionId,data?.manifest)}</h3><p>{p.reason}</p><p className="fine">Tested on {p.evidence.unseenGames} games it had never seen{p.evidence.window?` · ${p.evidence.window}`:''}. Decided {day(p.decidedAt)}; live from {new Date(p.effectiveAt).toLocaleString('en-US',{timeZone:'America/Chicago',timeZoneName:'short'})}. Earlier picks keep the version that made them.{p.scoreboardId?<> <a href={'/scoreboard#'+p.scoreboardId}>See the scoreboard ↗</a></>:null}</p></li>)}</ol>
  </section>}
 </ResearchFrame>;
}
