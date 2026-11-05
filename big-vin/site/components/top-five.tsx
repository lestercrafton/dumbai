'use client';
import {useEffect,useState} from 'react';
import {sportLabel,SUPPORTED_SPORTS} from '@/lib/presentation.mjs';
import {fetchSlate} from '@/lib/board-client';
import {topFive,ctDate} from '@/lib/today-plays.mjs';
/** Today's all-sport top 5 plays, in the bankroll's Kelly order. */
export function TopFive(){
 const [rows,setRows]=useState<any[]|null>(null);
 useEffect(()=>{let alive=true;const today=ctDate(Date.now());
  const load=async()=>{
   const [bk,...slates]=await Promise.allSettled([fetch('/api/bankroll').then(r=>r.ok?r.json():Promise.reject()),...SUPPORTED_SPORTS.map((s:string)=>fetchSlate(s,today,1))]);
   const bankrolls=bk.status==='fulfilled'?Object.fromEntries(((bk.value as any).sports??[]).map((s:any)=>[s.sport,s.kelly?.bankroll])):{};
   const games=slates.flatMap((r:any)=>r.status==='fulfilled'?(r.value.games??[]).map((g:any)=>({...g,sport:g.sport??r.value.sport})):[]);
   if(alive)setRows(topFive(games,bankrolls,today) as any[]);
  };
  load();const t=setInterval(load,120000);return()=>{alive=false;clearInterval(t);};},[]);
 const odds=(o:number|null)=>o==null?'':o>0?`+${o}`:`−${-o}`;
 const line=(r:any)=>r.market==='ml'?'ML':r.line==null?'':r.line===0?'PK':(r.line>0?'+':'−')+Math.abs(r.line);
 return <section id="top-5" className="vin-top-five" aria-label="All-sport top 5 plays today">
  <header className="vin-top-five-head"><h2>All-sport top 5</h2><span>★ advantage picks are staked · others graded only</span></header>
  {!rows?<p className="fine">Loading today’s games…</p>:rows.length===0?<p className="fine">No priced picks today yet.</p>:
  <ol className="vin-top-five-list">{rows.map((r,i)=><li key={r.id} className={r.recommended?'staked':'unstaked'}>
   <span className="vin-top-five-rank">{i+1}</span>
   <div className="vin-top-five-main">
    <strong>{r.advantage&&<span className="vin-advantage-star" title={r.advantageReason||'Advantage pick'}>★ </span>}{r.pick} {line(r)} <em>{odds(r.odds)}</em></strong>
    <small>{sportLabel(r.sport)} · {r.game}</small>
   </div>
   <div className="vin-top-five-meta">
    <b>{r.recommended?`Kelly ${(r.stake*100).toFixed(1)}%`:'Not staked'}</b>
    <small>{[r.winChance!=null?`${Math.round(r.winChance*100)}% win`:null,r.edge!=null?`${r.edge.toFixed(1)} edge`:null,r.cover?.label&&r.cover.label!=='—'?r.cover.label:null].filter(Boolean).join(' · ')}</small>
   </div>
  </li>)}</ol>}
 </section>;
}
