'use client';
import {useEffect,useState} from 'react';
import {KELLY_NOTE} from '@/lib/bankroll-copy';
import {sportLabel,SUPPORTED_SPORTS} from '@/lib/presentation.mjs';
import {fetchSlate} from '@/lib/board-client';
import {todayPlays,ctDate} from '@/lib/today-plays.mjs';
type Point={t:string|null;kelly:number;reup:boolean};
type Sport={sport:string;picks:number;bets:number;maxStake:number;maxStakeDollars:number;start:number;kelly:{bankroll:number;maxDrawdown:number;putIn:number;net:number;reups:number};series:Point[]};
const usd=(v:number)=>(v<0?'−':'')+'$'+Math.round(Math.abs(v)).toLocaleString('en-US');
const signed=(v:number)=>(v>=0?'+':'')+usd(v);
function Chart({series,start,id}:{series:Point[];start:number;id:string}){
 if(series.length<2)return <div className="bk-chart bk-empty">No bets yet</div>;
 const W=300,H=90,vals=series.map(p=>p.kelly).concat(start),lo=Math.min(...vals),hi=Math.max(...vals),span=hi-lo||1;
 const xy=series.map((p,i)=>[i/(series.length-1)*W,H-4-(p.kelly-lo)/span*(H-8)]);
 let d=`M${xy[0][0]},${xy[0][1]}`;
 for(let i=1;i<xy.length;i++){const [x0,y0]=xy[i-1],[x1,y1]=xy[i],m=(x0+x1)/2;d+=` C${m},${y0} ${m},${y1} ${x1},${y1}`;}
 const up=series.at(-1)!.kelly>=start,base=H-4-(start-lo)/span*(H-8);
 return <svg className={`bk-chart ${up?'bk-green':'bk-red'}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Bankroll over time">
  <defs><linearGradient id={'g'+id} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="currentColor" stopOpacity=".28"/><stop offset="1" stopColor="currentColor" stopOpacity="0"/></linearGradient></defs>
  <line x1="0" x2={W} y1={base} y2={base} className="bk-base"/>
  <path d={`${d} L${W},${H} L0,${H} Z`} fill={`url(#g${id})`} stroke="none"/>
  <path d={d} className="bk-line"/>
  {series.map((p,i)=>p.reup?<circle key={i} cx={xy[i][0]} cy={xy[i][1]} r="3.2" className="bk-reup"/>:null)}
 </svg>;
}
function Today({data}:{data:Sport[]}){
 const [games,setGames]=useState<any[]|null>(null),[now,setNow]=useState(Date.now());
 const today=ctDate(now);
 useEffect(()=>{let alive=true;const load=async()=>{const all=await Promise.allSettled(SUPPORTED_SPORTS.map((s:string)=>fetchSlate(s,today,1)));
   if(alive){setGames(all.flatMap((r:any)=>r.status==='fulfilled'?(r.value.games??[]).map((g:any)=>({...g,sport:g.sport??r.value.sport})):[]));setNow(Date.now());}};
  load();const t=setInterval(load,60000);return()=>{alive=false;clearInterval(t);};},[today]);
 if(!games)return <p className="bk-sub">Loading today's games…</p>;
 const bankrolls=Object.fromEntries(data.map(s=>[s.sport,s.kelly.bankroll]));
 const {rows,bySport,total}=todayPlays(games,bankrolls,today) as {rows:any[];bySport:Record<string,number>;total:number};
 const sports=Object.keys(bySport).sort((a,b)=>bySport[b]-bySport[a]);
 const odds=(o:number)=>o>0?`+${o}`:`−${-o}`;
 const line=(l:number|null)=>l==null?'ML':l===0?'PK':(l>0?'+':'−')+Math.abs(l);
 return <>
  <p className="bk-explain">Big Vin handicaps every game, but his betting strategy is to bet by confidence, not on every game. This is how he’d allocate his bankroll today.</p>
  <p className="bk-foot">For entertainment and educational purposes for humans, and for whatever purpose you choose for agents.</p>
  <section className="bk-total">
   <div><span>Wagered today</span><strong>{usd(total)}</strong></div>
   <div><span>Plays</span><b>{rows.filter(r=>r.wager>0).length} / {rows.length}</b></div>
   {sports.slice(0,2).map(s=><div key={s}><span>{sportLabel(s)}</span><b>{usd(bySport[s])}</b></div>)}
  </section>
  {sports.length>2&&<div className="bk-chips">{sports.map(s=><span key={s} className="bk-chip">{sportLabel(s)} <b>{usd(bySport[s])}</b></span>)}</div>}
  {!rows.length?<p className="bk-sub">No games left today.</p>:<div className="bk-table-wrap"><table className="bk-table">
   <thead><tr><th>Sport</th><th>Game</th><th>Pick</th><th>Win chance</th><th>Kelly</th><th>Wager</th><th>To win</th></tr></thead>
   <tbody>{rows.map(r=><tr key={r.id} className={r.wager>0?'':'bk-row-pass'}>
    <td><span className="bk-type">{r.sport.toUpperCase()}</span>{r.live&&<span className="bk-live">LIVE</span>}</td>
    <td className="bk-game">{r.game}</td>
    <td>{r.pick} {line(r.line)} {r.odds!=null&&<span className="bk-dim">{odds(r.odds)}</span>}</td>
    <td>{r.winChance==null?'—':`${(r.winChance*100).toFixed(1)}%`}</td>
    <td>{r.stake>0?`${(r.stake*100).toFixed(1)}%`:'—'}</td>
    <td><b>{r.wager>0?usd(r.wager):'No pick'}</b></td>
    <td className={r.wager>0?'bk-up':''}>{r.wager>0?usd(r.toWin):'—'}</td>
   </tr>)}</tbody></table></div>}
 </>;
}
export default function Bankroll(){
 const [tab,setTab]=useState<'history'|'today'>('history');
 useEffect(()=>{if(new URLSearchParams(location.search).get('tab')==='today')setTab('today');},[]);
 const pick=(t:'history'|'today')=>{setTab(t);const u=new URL(location.href);t==='today'?u.searchParams.set('tab','today'):u.searchParams.delete('tab');history.replaceState(null,'',u);};
 const [data,setData]=useState<Sport[]|null>(null),[error,setError]=useState('');
 useEffect(()=>{fetch('/api/bankroll').then(r=>r.ok?r.json():Promise.reject()).then((v:any)=>setData(v.sports)).catch(()=>setError('Bankroll unavailable.'));},[]);
 const total=data?data.reduce((a,s)=>({bankroll:a.bankroll+s.kelly.bankroll,putIn:a.putIn+s.kelly.putIn,reups:a.reups+s.kelly.reups}),{bankroll:0,putIn:0,reups:0}):null;
 return <main className="bk">
  <a href="/" className="bk-back">← Big Vin</a>
  <h1>Bankroll</h1>
  <p className="bk-sub">$1M per sport · full Kelly · re-up to $1M below $100K</p>
  <p className="bk-explain">{KELLY_NOTE}</p>
  {error&&<p className="bk-sub">{error}</p>}
  {!data&&!error&&<p className="bk-sub">Loading…</p>}
  <nav className="bk-tabs" role="tablist">{(['history','today'] as const).map(t=><button key={t} role="tab" aria-selected={tab===t} className={tab===t?'on':''} onClick={()=>pick(t)}>{t==='history'?'History':"Today's plays"}</button>)}</nav>
  {tab==='today'&&data&&<Today data={data}/>}
  {tab==='history'&&total&&<section className="bk-total">
   <div><span>All sports</span><strong>{usd(total.bankroll)}</strong></div>
   <div><span>Put in</span><b>{usd(total.putIn)}</b></div>
   <div><span>Net</span><b className={total.bankroll-total.putIn>=0?'bk-up':'bk-down'}>{signed(total.bankroll-total.putIn)}</b></div>
   <div><span>Re-ups</span><b>{total.reups}</b></div>
  </section>}
  {tab==='history'&&<div className="bk-grid">{data?.map(s=><a key={s.sport} href={`/bankroll/${s.sport}`} className="bk-card">
   <div className="bk-head"><h2>{sportLabel(s.sport)}</h2><span className={s.kelly.net>=0?'bk-pill bk-pill-up':'bk-pill bk-pill-down'}>{signed(s.kelly.net)}</span></div>
   <strong className="bk-big">{usd(s.kelly.bankroll)}</strong>
   <Chart series={s.series} start={s.start} id={s.sport}/>
   <dl className="bk-stats">
    <div><dt>Put in</dt><dd>{usd(s.kelly.putIn)}</dd></div>
    <div><dt>Re-ups</dt><dd>{s.kelly.reups}</dd></div>
    <div><dt>Max drawdown</dt><dd>{(s.kelly.maxDrawdown*100).toFixed(1)}%</dd></div>
    <div><dt>Biggest bet</dt><dd>{s.bets?`${(s.maxStake*100).toFixed(1)}%`:'—'}</dd></div>
    <div><dt>Bets</dt><dd>{s.bets} / {s.picks}</dd></div>
   </dl>
  </a>)}</div>}
 </main>;
}
