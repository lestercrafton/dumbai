'use client';
import {useEffect,useState} from 'react';
import {useParams} from 'next/navigation';
import {ENTERTAINMENT_NOTE} from '@/lib/bankroll-copy';
import {sportLabel} from '@/lib/presentation.mjs';
import SortableBetsTable from '@/components/sortable-bets-table';
const usd=(v:number)=>(v<0?'−':'')+'$'+Math.round(Math.abs(v)).toLocaleString('en-US');
const signed=(v:number)=>Math.round(v)===0?'$0':(v>0?'+':'')+usd(v);
export default function MySportBankroll(){
 const {sport}=useParams<{sport:string}>();
 const [s,setS]=useState<any>(null),[error,setError]=useState('');
 useEffect(()=>{fetch(`/api/my-bankroll?sport=${encodeURIComponent(sport)}`,{credentials:'same-origin'}).then(async r=>{
  if(r.status===401){location.href='/my-bankroll';return;}
  if(!r.ok)throw new Error();
  const v=await r.json() as any;
  if(!v.sports?.[0])setError('No bankroll for this sport.');else setS(v.sports[0]);
 }).catch(()=>setError('My Bankroll unavailable.'));},[sport]);
 return <main className="bk">
  <a href="/my-bankroll" className="bk-back">← My Bankroll</a>
  <h1>{sportLabel(sport)}</h1>
  <p className="bk-disclaimer">{ENTERTAINMENT_NOTE}</p>
  <p className="bk-sub">Your start · full Kelly · re-up below 10%</p>
  {error&&<p className="bk-sub">{error}</p>}
  {!s&&!error&&<p className="bk-sub">Loading…</p>}
  {s&&<section className="bk-total">
   <div><span>Bankroll</span><strong>{usd(s.kelly.bankroll)}</strong></div>
   <div><span>Put in</span><b>{usd(s.kelly.putIn)}</b></div>
   <div><span>Net</span><b className={s.kelly.net>=0?'bk-up':'bk-down'}>{signed(s.kelly.net)}</b></div>
   <div><span>Re-ups</span><b>{s.kelly.reups}</b></div>
  </section>}
  {s&&<SortableBetsTable bets={s.bets??[]}/>}
  <p className="bk-disclaimer bk-disclaimer-bottom">{ENTERTAINMENT_NOTE}</p>
 </main>;
}
