'use client';
import {useEffect,useState} from 'react';
import {sportLabel} from '@/lib/presentation.mjs';
type Point={t:string|null;kelly:number;flat:number};
type Sport={sport:string;picks:number;bets:number;averageStake:number;maxStake:number;maxStakeDollars:number;start:number;kelly:{bankroll:number;change:number;maxDrawdown:number};flat:{bankroll:number;change:number;maxDrawdown:number};series:Point[]};
const usd=(v:number)=>'$'+Math.round(v).toLocaleString('en-US');
const pct=(v:number)=>`${v>=0?'+':'−'}${Math.abs(v*100).toFixed(1)}%`;
function Chart({series,start}:{series:Point[];start:number}){
 if(series.length<2)return <div className="bk-chart bk-empty">No graded picks yet</div>;
 const vals=series.flatMap(p=>[p.kelly,p.flat]).concat(start),lo=Math.min(...vals),hi=Math.max(...vals),span=hi-lo||1;
 const path=(k:'kelly'|'flat')=>series.map((p,i)=>`${i?'L':'M'}${(i/(series.length-1)*300).toFixed(1)},${(80-(p[k]-lo)/span*76-2).toFixed(1)}`).join('');
 const base=80-(start-lo)/span*76-2;
 return <svg className="bk-chart" viewBox="0 0 300 80" preserveAspectRatio="none" role="img" aria-label="Bankroll over time">
  <line x1="0" x2="300" y1={base} y2={base} className="bk-base"/><path d={path('flat')} className="bk-flat"/><path d={path('kelly')} className="bk-kelly"/></svg>;
}
export default function Bankroll(){
 const [data,setData]=useState<Sport[]|null>(null),[error,setError]=useState('');
 useEffect(()=>{fetch('/api/bankroll').then(r=>r.ok?r.json():Promise.reject()).then((v:any)=>setData(v.sports)).catch(()=>setError('Bankroll is temporarily unavailable.'));},[]);
 return <main className="bk">
  <a href="/" className="bk-back">← Big Vin</a>
  <h1>Bankroll</h1>
  <p className="bk-sub">Each sport starts at $1,000,000 and replays every graded tracked pick in kickoff order. Bets are full Kelly, sized from the win chance known before each game and the price taken; no bet when Kelly says zero. The thin line is flat 1% bets for comparison.</p>
  {error&&<p className="bk-sub">{error}</p>}
  {!data&&!error&&<p className="bk-sub">Loading…</p>}
  <div className="bk-grid">{data?.map(s=><section key={s.sport} className="bk-card">
   <h2>{sportLabel(s.sport)}</h2>
   <strong className={s.kelly.change>=0?'bk-up':'bk-down'}>{usd(s.kelly.bankroll)}</strong>
   <span>{pct(s.kelly.change)} · max drawdown {(s.kelly.maxDrawdown*100).toFixed(1)}%</span>
   <Chart series={s.series} start={s.start}/>
   <small>{s.picks} graded picks · {s.bets} bet{s.bets===1?'':'s'}{s.bets?` · biggest ${(s.maxStake*100).toFixed(1)}% (${usd(s.maxStakeDollars)})`:''} · flat 1%: {pct(s.flat.change)}</small>
  </section>)}</div>
 </main>;
}
