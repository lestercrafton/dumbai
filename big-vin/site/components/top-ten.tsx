'use client';
import {useEffect,useState} from 'react';
import {sportLabel,SUPPORTED_SPORTS} from '@/lib/presentation.mjs';
import {fetchSlate} from '@/lib/board-client';
import {topTen,ctDate} from '@/lib/today-plays.mjs';
/** Today's top 10 plays across every sport, in the bankroll's Kelly order. */
export function TopTen(){
 const [rows,setRows]=useState<any[]|null>(null);
 useEffect(()=>{let alive=true;const today=ctDate(Date.now());
  const load=async()=>{
   const [bk,...slates]=await Promise.allSettled([fetch('/api/bankroll').then(r=>r.ok?r.json():Promise.reject()),...SUPPORTED_SPORTS.map((s:string)=>fetchSlate(s,today,1))]);
   const bankrolls=bk.status==='fulfilled'?Object.fromEntries(((bk.value as any).sports??[]).map((s:any)=>[s.sport,s.kelly?.bankroll])):{};
   const games=slates.flatMap((r:any)=>r.status==='fulfilled'?(r.value.games??[]).map((g:any)=>({...g,sport:g.sport??r.value.sport})):[]);
   if(alive)setRows(topTen(games,bankrolls,today) as any[]);
  };
  load();const t=setInterval(load,120000);return()=>{alive=false;clearInterval(t);};},[]);
 const odds=(o:number|null)=>o==null?'':o>0?` +${o}`:` −${-o}`;
 const line=(r:any)=>r.market==='ml'?'ML':r.line==null?'':r.line===0?'PK':(r.line>0?'+':'−')+Math.abs(r.line);
 return <section id="top-10" className="vin-top-ten" aria-label="Top 10 plays today">
  <div className="vin-board-heading"><div><p className="vin-kicker">TODAY / ALL SPORTS</p><h2>Top 10 plays</h2></div><p>Same Kelly order as the bankroll.<br/>★ = advantage pick.</p></div>
  {!rows?<p className="fine">Loading today’s games…</p>:rows.length===0?<p className="fine">No priced picks today yet.</p>:
  <ol className="vin-top-ten-list">{rows.map((r,i)=><li key={r.id} className={r.recommended?'staked':'unstaked'}>
   <span className="vin-top-ten-rank">{i+1}</span>
   <span className="vin-top-ten-sport">{sportLabel(r.sport)}</span>
   <span className="vin-top-ten-game">{r.game}</span>
   <strong className="vin-top-ten-pick">{r.advantage&&<span className="vin-advantage-star" title={r.advantageReason||'Advantage pick'}>★ </span>}{r.pick} {line(r)}{odds(r.odds)}</strong>
   <small className="vin-top-ten-why">{[r.edge!=null?`${r.edge.toFixed(1)} edge`:null,r.winChance!=null?`${Math.round(r.winChance*100)}% win chance`:null,r.stake>0?`Kelly ${(r.stake*100).toFixed(1)}%`:null,r.recommended?'staked':'not staked',r.advantageReason].filter(Boolean).join(' · ')}{r.cover?.label&&r.cover.label!=='—'?` · ${r.cover.label}`:''}</small>
  </li>)}</ol>}
 </section>;
}
