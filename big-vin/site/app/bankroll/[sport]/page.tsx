'use client';
import {useEffect,useState} from 'react';
import {useParams} from 'next/navigation';
import {KELLY_NOTE} from '@/lib/bankroll-copy';
import {sportLabel} from '@/lib/presentation.mjs';
type Bet={t:string;game:string;pick:string;line:number;odds:number;edge:number|null;winChance:number|null;stake:number;amount:number;outcome:string;pl:number;after:number;reup:boolean;afterReup?:number};
const usd=(v:number)=>(v<0?'−':'')+'$'+Math.round(Math.abs(v)).toLocaleString('en-US');
const signed=(v:number)=>Math.round(v)===0?'$0':(v>0?'+':'')+usd(v);
const odds=(o:number)=>o>0?`+${o}`:`${o}`.replace('-','−');
const line=(l:number)=>l===0?'ML':(l>0?'+':'')+String(l).replace('-','−');
const day=(t:string)=>new Date(t).toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'America/Chicago'});
export default function SportBankroll(){
 const {sport}=useParams<{sport:string}>();
 const [s,setS]=useState<any>(null),[error,setError]=useState('');
 useEffect(()=>{fetch(`/api/bankroll?sport=${encodeURIComponent(sport)}`).then(r=>r.ok?r.json():Promise.reject()).then((v:any)=>v.sports?.[0]?setS(v.sports[0]):setError('No bankroll for this sport.')).catch(()=>setError('Bankroll unavailable.'));},[sport]);
 const bets:Bet[]=s?.bets??[];
 return <main className="bk">
  <a href="/bankroll" className="bk-back">← Bankroll</a>
  <h1>{sportLabel(sport)}</h1>
  <p className="bk-explain">{KELLY_NOTE}</p>
  {error&&<p className="bk-sub">{error}</p>}
  {!s&&!error&&<p className="bk-sub">Loading…</p>}
  {s&&<section className="bk-total">
   <div><span>Bankroll</span><strong>{usd(s.kelly.bankroll)}</strong></div>
   <div><span>Put in</span><b>{usd(s.kelly.putIn)}</b></div>
   <div><span>Net</span><b className={s.kelly.net>=0?'bk-up':'bk-down'}>{signed(s.kelly.net)}</b></div>
   <div><span>Re-ups</span><b>{s.kelly.reups}</b></div>
  </section>}
  {s&&<div className="bk-table-wrap"><table className="bk-table">
   <thead><tr><th>Date</th><th>Game</th><th>Pick</th><th>Edge</th><th>Win chance</th><th>Kelly</th><th>Bet</th><th>Result</th><th>P/L</th><th>Bankroll</th></tr></thead>
   <tbody>{bets.map((b,i)=><tr key={i} className={b.reup?'bk-row-reup':b.stake>0?'':'bk-row-pass'}>
    <td>{day(b.t)}</td><td className="bk-game">{b.game}</td>
    <td>{b.pick} {line(b.line)} <span className="bk-dim">{odds(b.odds)}</span></td>
    <td>{b.edge==null?'—':b.edge.toFixed(1)}</td>
    <td>{b.winChance==null?'—':`${(b.winChance*100).toFixed(1)}%`}</td>
    <td>{b.stake>0?`${(b.stake*100).toFixed(1)}%`:'—'}</td>
    <td>{b.stake>0?usd(b.amount):'No bet'}</td>
    <td className={b.outcome==='win'?'bk-up':b.outcome==='loss'?'bk-down':''}>{b.outcome==='win'?'W':b.outcome==='loss'?'L':'Push'}</td>
    <td className={b.pl>0?'bk-up':b.pl<0?'bk-down':''}>{signed(b.pl)}</td>
    <td>{usd(b.after)}{b.reup&&<span className="bk-reup-tag">Re-up → {usd(b.afterReup??0)}</span>}</td>
   </tr>)}</tbody>
  </table></div>}
 </main>;
}
