'use client';
import {useEffect,useState,FormEvent} from 'react';
import {MY_KELLY_NOTE,ENTERTAINMENT_NOTE,CARRY_NOTE} from '@/lib/bankroll-copy';
import {sportLabel,SUPPORTED_SPORTS} from '@/lib/presentation.mjs';
import {fetchSlate} from '@/lib/board-client';
import {todayPlays,ctDate} from '@/lib/today-plays.mjs';

type Point={t:string|null;kelly:number;reup:boolean};
type Sport={sport:string;picks:number;bets:number;maxStake:number;maxStakeDollars:number;start:number;kelly:{bankroll:number;maxDrawdown:number;putIn:number;net:number;reups:number};series:Point[]};
type Starts=Record<string,number|null>;

const DISCLAIMER=ENTERTAINMENT_NOTE;
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
  <defs><linearGradient id={'mg'+id} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="currentColor" stopOpacity=".28"/><stop offset="1" stopColor="currentColor" stopOpacity="0"/></linearGradient></defs>
  <line x1="0" x2={W} y1={base} y2={base} className="bk-base"/>
  <path d={`${d} L${W},${H} L0,${H} Z`} fill={`url(#mg${id})`} stroke="none"/>
  <path d={d} className="bk-line"/>
  {series.map((p,i)=>p.reup?<circle key={i} cx={xy[i][0]} cy={xy[i][1]} r="3.2" className="bk-reup"/>:null)}
 </svg>;
}

function Today({bankrolls,kalshi,kalshiReferral}:{bankrolls:Record<string,number>;kalshi:{connected?:boolean;goFull?:boolean};kalshiReferral?:{configured?:boolean;joinUrl?:string}}){
 const [games,setGames]=useState<any[]|null>(null),[now,setNow]=useState(Date.now());
 const [links,setLinks]=useState<Record<string,any>>({});
 const [placing,setPlacing]=useState<string>('');
 const [placeMsg,setPlaceMsg]=useState('');
 const [playMode,setPlayMode]=useState<'recommended'|'all'>('recommended');
 const [amounts,setAmounts]=useState<Record<string,string>>({});
 const today=ctDate(now);
 useEffect(()=>{let alive=true;const load=async()=>{const sports=Object.keys(bankrolls);const all=await Promise.allSettled(sports.map((s:string)=>fetchSlate(s,today,1)));
   if(!alive)return;
   const gs=all.flatMap((r:any)=>r.status==='fulfilled'?(r.value.games??[]).map((g:any)=>({...g,sport:g.sport??r.value.sport})):[]);
   setGames(gs);setNow(Date.now());
   const {rows}=todayPlays(gs,bankrolls,today) as {rows:any[]};
   const picks=rows.map((r:any)=>({
     id:r.id,sport:r.sport,home:r.home,away:r.away,pickName:r.pick,pickAbbr:r.pickAbbr,line:r.line,market:r.market,
   }));
   if(picks.length){
     try{
       const mr=await fetch('/api/my-bankroll/kalshi/matches',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({picks})});
       if(alive&&mr.ok){const j=await mr.json();setLinks(j.matches||{});}
     }catch{/* ignore */}
   }
 };
  load();const t=setInterval(load,60000);return()=>{alive=false;clearInterval(t);};},[today,Object.keys(bankrolls).join(','),kalshi?.connected,kalshi?.goFull]);
 if(!games)return <p className="bk-sub">Loading today's games…</p>;
 const {rows,bySport,total}=todayPlays(games,bankrolls,today) as {rows:any[];bySport:Record<string,number>;total:number};
 const sports=Object.keys(bySport).sort((a,b)=>bySport[b]-bySport[a]);
 const odds=(o:number)=>o>0?`+${o}`:`−${-o}`;
 const line=(l:number|null)=>l==null?'ML':l===0?'PK':(l>0?'+':'−')+Math.abs(l);
 const resolveAmount=(r:any)=>{
  if(playMode!=='all')return r.wager;
  const raw=amounts[r.id]?.trim();
  if(!raw)return r.wager>0?r.wager:0;
  const n=Number(raw.replace(/[$,]/g,''));
  return Number.isFinite(n)&&n>0?n:0;
 };
 const place=async(r:any,m:any)=>{
  const wager=resolveAmount(r);
  if(!m?.placeable||!m.marketTicker||wager<=0)return;
  const ok=window.confirm(`Place about ${usd(wager)} on Kalshi for:
${m.title||r.pick}

Entertainment only — confirm to submit with your connected key.`);
  if(!ok)return;
  setPlacing(r.id);setPlaceMsg('');
  try{
   const res=await fetch('/api/my-bankroll/kalshi/place',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirm:true,ticker:m.marketTicker,side:m.side||'yes',wagerDollars:wager,yesAskDollars:m.yesAsk})});
   const j=await res.json();
   if(!res.ok)setPlaceMsg(j.error||'Order failed.');
   else setPlaceMsg(`Order submitted for ${r.pick}.`);
  }catch{setPlaceMsg('Order failed.');}
  finally{setPlacing('');}
 };
 const allMode=playMode==='all';
 return <>
  <div className="bk-play-modes" role="tablist" aria-label="Plays view">
   <button type="button" role="tab" aria-selected={!allMode} className={!allMode?'on':''} onClick={()=>setPlayMode('recommended')}>Today&apos;s plays</button>
   <button type="button" role="tab" aria-selected={allMode} className={allMode?'on':''} onClick={()=>setPlayMode('all')}>All picks</button>
  </div>
  {allMode
   ?<p className="bk-explain">Every board pick ranked by Kelly / confidence — including Kelly-zero games Big Vin would pass. Type any amount (or leave blank to use the recommended size when there is one). Deep links and Place still work.</p>
   :<p className="bk-explain">Big Vin handicaps every game, but bets by confidence — not on every game. These wagers are sized to <b>your</b> bankroll with full Kelly.</p>}
  <p className="bk-foot">{DISCLAIMER}</p>
  {placeMsg&&<p className="bk-ok">{placeMsg}</p>}
  {!allMode&&<section className="bk-total">
   <div><span>Wagered today</span><strong>{usd(total)}</strong></div>
   <div><span>Plays</span><b>{rows.filter(r=>r.wager>0).length} / {rows.length}</b></div>
   {sports.slice(0,2).map(s=><div key={s}><span>{sportLabel(s)}</span><b>{usd(bySport[s])}</b></div>)}
  </section>}
  {allMode&&<section className="bk-total">
   <div><span>Board picks</span><strong>{rows.length}</strong></div>
   <div><span>Recommended</span><b>{rows.filter(r=>r.wager>0).length}</b></div>
   <div><span>Pass / no pick</span><b>{rows.filter(r=>!(r.wager>0)).length}</b></div>
  </section>}
  {!allMode&&sports.length>2&&<div className="bk-chips">{sports.map(s=><span key={s} className="bk-chip">{sportLabel(s)} <b>{usd(bySport[s])}</b></span>)}</div>}
  {!rows.length?<p className="bk-sub">No games left today for sports you’ve set.</p>:<div className="bk-table-wrap"><table className="bk-table">
   <thead><tr><th>Sport</th><th>Game</th><th>Pick</th><th>Win chance</th><th>Kelly</th><th>{allMode?'Amount':'Wager'}</th><th>To win</th><th>Spread</th><th>Total</th><th>Kalshi</th></tr></thead>
   <tbody>{rows.map(r=>{
    const m=links[r.id];
    const amt=resolveAmount(r);
    const canPlace=!!(kalshi?.goFull&&m?.placeable&&amt>0);
    return <tr key={r.id} className={`${r.wager>0?'':'bk-row-pass'} ${r.cover?.state==='covering'?'bk-row-cover':r.cover?.state==='not-covering'?'bk-row-need':''}`}>
    <td><span className="bk-type">{r.sport.toUpperCase()}</span>{r.live&&!r.done&&<span className="bk-live">LIVE</span>}{(r.done||r.cover?.final)&&<span className="bk-live">FINAL</span>}</td>
    <td className="bk-game">{r.game}{r.scoreClock&&<div className="bk-score">{r.scoreClock.score}{' '}{r.scoreClock.clock&&<span className="bk-clock">{r.scoreClock.clock}</span>}</div>}</td>
    <td>{r.pick} {line(r.line)} {r.odds!=null&&<span className="bk-dim">{odds(r.odds)}</span>}</td>
    <td>{r.winChance==null?'—':`${(r.winChance*100).toFixed(1)}%`}</td>
    <td>{r.stake>0?`${(r.stake*100).toFixed(1)}%`:'—'}</td>
    <td>{allMode
      ?<label className="bk-amt"><span className="bk-amt-prefix">$</span><input type="text" inputMode="decimal" className="bk-amt-input" placeholder={r.wager>0?String(Math.round(r.wager)):'0'} value={amounts[r.id]??''} onChange={e=>setAmounts(a=>({...a,[r.id]:e.target.value}))} aria-label={`Amount for ${r.pick}`}/></label>
      :<b>{r.wager>0?usd(r.wager):'No pick'}</b>}</td>
    <td className={r.wager>0?'bk-up':''}>{r.wager>0?usd(r.toWin):'—'}</td>
    <td className={r.cover?.state==='covering'?'bk-status bk-status-cover':r.cover?.state==='not-covering'?'bk-status bk-status-need':'bk-status'}>{r.cover?.label||'—'}</td>
    <td className={r.totalCover?.state==='covering'?'bk-status bk-status-cover':r.totalCover?.state==='not-covering'?'bk-status bk-status-need':'bk-status'}>{r.totalCover?.label||'—'}</td>
    <td className="bk-kalshi-cell">{m?.url?<a className="bk-kalshi-link" href={m.url} target="_blank" rel="noopener noreferrer">Open on Kalshi</a>:<span className="bk-kalshi-miss">No Kalshi market</span>}
     {canPlace&&<button type="button" className="bk-kalshi-place" disabled={placing===r.id} onClick={()=>place(r,m)}>{placing===r.id?'Placing…':'Place on Kalshi'}</button>}
    </td>
   </tr>;})}</tbody></table></div>}
  {kalshiReferral?.configured&&kalshiReferral.joinUrl&&<p className="bk-note">New to Kalshi? <a className="bk-kalshi-link" href={kalshiReferral.joinUrl} target="_blank" rel="noopener noreferrer">Open Kalshi with Big Vin&apos;s referral</a>.</p>}
 </>
}


export default function MyBankroll(){
 const [phase,setPhase]=useState<'loading'|'login'|'code'|'app'>('loading');
 const [email,setEmail]=useState('');
 const [code,setCode]=useState('');
 const [demo,setDemo]=useState(false);
 const [demoCode,setDemoCode]=useState('');
 const [emailDelivery,setEmailDelivery]=useState(true);
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 const [starts,setStarts]=useState<Starts|{[k:string]:string}>({});
 const [draft,setDraft]=useState<Record<string,string>>({});
 const [tab,setTab]=useState<'history'|'today'|'setup'>('history');
 const [data,setData]=useState<Sport[]|null>(null);
 const [saved,setSaved]=useState('');
 const [kalshi,setKalshi]=useState<{connected?:boolean;goFull?:boolean;apiKeyIdSuffix?:string;lastError?:string|null}>({});
 const [kalshiKeyId,setKalshiKeyId]=useState('');
 const [kalshiPem,setKalshiPem]=useState('');
 const [kalshiMsg,setKalshiMsg]=useState('');
 const [showKalshiForm,setShowKalshiForm]=useState(false);
 const [kalshiReferral,setKalshiReferral]=useState<{configured?:boolean;joinUrl?:string}>({});

 const blankDraft=(s:Starts)=>{
  const d:Record<string,string>={};
  for(const sport of SUPPORTED_SPORTS)d[sport]=s[sport]==null?'':String(s[sport]);
  return d;
 };

 const refreshMe=async()=>{
  const r=await fetch('/api/my-bankroll/me',{credentials:'same-origin'});
  const v=await r.json();
  if(!v.configured){setError('Sign-in secret is not configured on this Worker yet.');setPhase('login');return;}
  setEmailDelivery(!!v.emailDelivery);
  if(!v.user){setPhase('login');return;}
  setEmail(v.user.email);
  setStarts(v.user.starts);
  setKalshi(v.kalshi||{});
  setKalshiReferral(v.kalshiReferral||{});
  const has=SUPPORTED_SPORTS.some((s:string)=>v.user.starts[s]!=null);
  // First screen: Starting bankrolls prefilled with carried Kelly balances (what you'd have if you took Vin's plays).
  setTab('setup');
  setPhase('app');
  if(has){
   const b=await fetch('/api/my-bankroll',{credentials:'same-origin'});
   if(b.ok){
    const j=await b.json();
    setData(j.sports);
    const carried:Record<string,string>={};
    for(const sport of SUPPORTED_SPORTS){
     const row=j.sports?.find((x:Sport)=>x.sport===sport);
     if(row)carried[sport]=String(Math.round(row.kelly.bankroll));
     else carried[sport]=v.user.starts[sport]==null?'':String(v.user.starts[sport]);
    }
    setDraft(carried);
   }else setDraft(blankDraft(v.user.starts));
  }else{setData([]);setDraft(blankDraft(v.user.starts));}
 };

 useEffect(()=>{refreshMe().catch(()=>{setError('Could not load My Bankroll.');setPhase('login');});},[]);

 const requestCode=async(e:FormEvent)=>{
  e.preventDefault();setBusy(true);setError('');
  try{
   const r=await fetch('/api/my-bankroll/auth/request',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})});
   const v=await r.json();
   if(!r.ok){setError(v.error||'Could not send code.');return;}
   setDemo(!!v.demo);setDemoCode(v.demoCode||'');setPhase('code');
  }catch{setError('Could not send code.');}
  finally{setBusy(false);}
 };

 const verify=async(e:FormEvent)=>{
  e.preventDefault();setBusy(true);setError('');
  try{
   const r=await fetch('/api/my-bankroll/auth/verify',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,code})});
   const v=await r.json();
   if(!r.ok){setError(v.error||'Wrong code.');return;}
   await refreshMe();
  }catch{setError('Could not verify.');}
  finally{setBusy(false);}
 };

 const logout=async()=>{
  await fetch('/api/my-bankroll/auth/logout',{method:'POST',credentials:'same-origin'});
  setData(null);setStarts({});setDraft({});setCode('');setKalshi({});setKalshiKeyId('');setKalshiPem('');setPhase('login');
 };

 const saveStarts=async(e:FormEvent)=>{
  e.preventDefault();setBusy(true);setError('');setSaved('');
  try{
   const startsBody:Record<string,number|null>={};
   for(const sport of SUPPORTED_SPORTS){
    const raw=draft[sport]?.trim();
    if(!raw){startsBody[sport]=null;continue;}
    const n=Number(raw.replace(/[$,]/g,''));
    if(!Number.isFinite(n)||n<=0){setError(`Check the ${sportLabel(sport)} amount.`);setBusy(false);return;}
    startsBody[sport]=n;
   }
   const r=await fetch('/api/my-bankroll/starts',{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({starts:startsBody})});
   const v=await r.json();
   if(!r.ok){setError(v.error||'Could not save.');return;}
   setStarts(v.starts);
   const b=await fetch('/api/my-bankroll',{credentials:'same-origin'});
   if(b.ok){
    const j=await b.json();setData(j.sports);
    const carried:Record<string,string>={};
    for(const sport of SUPPORTED_SPORTS){
     const row=j.sports?.find((x:Sport)=>x.sport===sport);
     if(row)carried[sport]=String(Math.round(row.kelly.bankroll));
     else carried[sport]=v.starts[sport]==null?'':String(v.starts[sport]);
    }
    setDraft(carried);setTab('today');
   }else setDraft(blankDraft(v.starts));
   setSaved('Saved.');
  }catch{setError('Could not save.');}
  finally{setBusy(false);}
 };

 const bankrolls=Object.fromEntries(SUPPORTED_SPORTS.filter((s:string)=>starts[s]!=null).map((s:string)=>[s,data?.find(x=>x.sport===s)?.kelly.bankroll??(starts[s] as number)]));
 const total=data?data.reduce((a,s)=>({bankroll:a.bankroll+s.kelly.bankroll,putIn:a.putIn+s.kelly.putIn,reups:a.reups+s.kelly.reups}),{bankroll:0,putIn:0,reups:0}):null;

 return <main className="bk">
  <div className="bk-navrow"><a href="/bankroll" className="bk-back">← Bankroll</a><a href="/" className="bk-back">Home</a></div>
  <h1>My Bankroll</h1>
  <p className="bk-sub">Your starting bankroll · from the day you arrived · full Kelly · re-up below 10%</p>
  <p className="bk-disclaimer">{DISCLAIMER}</p>

  {phase==='loading'&&<p className="bk-sub">Loading…</p>}
  {error&&phase!=='app'&&<p className="bk-err">{error}</p>}

  {phase==='login'&&<form className="bk-auth" onSubmit={requestCode}>
   <p className="bk-explain">Sign in with your email. We’ll send a one-time code — no password.</p>
   {!emailDelivery&&<p className="bk-note">Email delivery isn’t configured yet. You’ll see the code on the next screen (demo mode).</p>}
   <label>Email<input type="email" required value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com"/></label>
   <button type="submit" disabled={busy}>{busy?'Sending…':'Send code'}</button>
  </form>}

  {phase==='code'&&<form className="bk-auth" onSubmit={verify}>
   <p className="bk-explain">Enter the 6-digit code{demo?' shown below':' emailed to'} <b>{email}</b>.</p>
   {demo&&<p className="bk-demo">Demo code: <strong>{demoCode}</strong></p>}
   <label>Code<input type="text" inputMode="numeric" pattern="\d{6}" maxLength={6} required value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,''))} autoComplete="one-time-code" placeholder="123456"/></label>
   <button type="submit" disabled={busy||code.length!==6}>{busy?'Checking…':'Sign in'}</button>
   <button type="button" className="bk-linkish" onClick={()=>setPhase('login')}>Use a different email</button>
   {error&&<p className="bk-err">{error}</p>}
  </form>}

  {phase==='app'&&<>
   <div className="bk-userbar"><span>Signed in as <b>{email}</b></span><button type="button" className="bk-linkish" onClick={logout}>Log out</button></div>
   <p className="bk-explain">{MY_KELLY_NOTE}</p>
   <nav className="bk-tabs" role="tablist">
    {(['setup','history','today'] as const).map(t=><button key={t} role="tab" aria-selected={tab===t} className={tab===t?'on':''} onClick={()=>setTab(t)}>{t==='setup'?'Starting bankrolls':t==='history'?'History':"Today's plays"}</button>)}
   </nav>

   {tab==='setup'&&<form className="bk-setup" onSubmit={saveStarts}>
    <p className="bk-explain">Enter a starting bankroll for each sport you want to follow. Leave blank to skip.</p>
    <p className="bk-note">{CARRY_NOTE}</p>
    <div className="bk-setup-grid">{SUPPORTED_SPORTS.map((s:string)=><label key={s}>{sportLabel(s)}
     <input type="text" inputMode="decimal" placeholder="e.g. 1000" value={draft[s]??''} onChange={e=>setDraft(d=>({...d,[s]:e.target.value}))}/>
    </label>)}</div>
    {error&&<p className="bk-err">{error}</p>}
    {saved&&<p className="bk-ok">{saved}</p>}
    <button type="submit" disabled={busy}>{busy?'Saving…':'Save bankrolls'}</button>

    <div className="bk-kalshi">
     <h2 className="bk-kalshi-title">Kalshi</h2>
     <p className="bk-explain">Deep links open matching Kalshi markets for each pick (game winner first; spreads/totals when Kalshi lists a clear line). No trades are placed unless you Go full.</p>
     <p className="bk-explain"><a className="bk-kalshi-link" href={kalshiReferral?.joinUrl||"https://kalshi.com"} target="_blank" rel="noopener noreferrer">Open on Kalshi</a>{kalshiReferral?.configured?" (Big Vin referral attached).":"."}</p>
     <p className="bk-note">{DISCLAIMER}</p>
     {!kalshi.connected&&!showKalshiForm&&<button type="button" className="bk-kalshi-go" onClick={()=>setShowKalshiForm(true)}>Go full with Kalshi</button>}
     {!kalshi.connected&&showKalshiForm&&<div className="bk-kalshi-form">
      <p className="bk-explain">Connect <b>your</b> Kalshi API Key ID and private key PEM. We encrypt them per account and only use them to place the recommended size when you confirm. Keys are never written to logs.</p>
      <label>API Key ID<input value={kalshiKeyId} onChange={e=>setKalshiKeyId(e.target.value)} autoComplete="off" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"/></label>
      <label>Private key PEM<textarea rows={6} value={kalshiPem} onChange={e=>setKalshiPem(e.target.value)} autoComplete="off" spellCheck={false} placeholder="-----BEGIN PRIVATE KEY-----"/></label>
      <button type="button" disabled={busy} onClick={async()=>{
        setBusy(true);setKalshiMsg('');setError('');
        try{
          const r=await fetch('/api/my-bankroll/kalshi',{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKeyId:kalshiKeyId,privateKeyPem:kalshiPem,goFull:true})});
          const j=await r.json();
          if(!r.ok){setError(j.error||'Could not connect.');return;}
          setKalshi(j.kalshi||{connected:true,goFull:true});setKalshiPem('');setKalshiMsg(j.balance!=null?`Connected. Kalshi balance about $${Number(j.balance).toLocaleString('en-US')}.`:'Connected.');setShowKalshiForm(false);
        }catch{setError('Could not connect.');}
        finally{setBusy(false);}
      }}>{busy?'Testing…':'Save & test connection'}</button>
      <button type="button" className="bk-linkish" onClick={()=>setShowKalshiForm(false)}>Cancel</button>
     </div>}
     {kalshi.connected&&<div className="bk-kalshi-connected">
      <p className="bk-ok">Connected{kalshi.apiKeyIdSuffix?` · key …${kalshi.apiKeyIdSuffix}`:''}{kalshi.goFull?' · Go full on':''}</p>
      {kalshi.lastError&&<p className="bk-err">Last Kalshi error: {kalshi.lastError}</p>}
      {kalshiMsg&&<p className="bk-ok">{kalshiMsg}</p>}
      <p className="bk-explain">Today&apos;s plays and All picks can show <b>Place on Kalshi</b> (confirm step). All picks uses your typed amount, or the recommended size if blank. YES-side contracts only in this build; otherwise use Open on Kalshi.</p>
      <div className="bk-kalshi-actions">
       <button type="button" className="bk-linkish" onClick={async()=>{
         setBusy(true);setKalshiMsg('');
         try{const r=await fetch('/api/my-bankroll/kalshi/test',{method:'POST',credentials:'same-origin'});const j=await r.json();setKalshiMsg(r.ok?(j.balance!=null?`Still good. Balance about $${Number(j.balance).toLocaleString('en-US')}.`:'Still good.'):(j.error||'Test failed'));}catch{setKalshiMsg('Test failed');}
         finally{setBusy(false);}
       }}>Test connection</button>
       <button type="button" className="bk-linkish" onClick={async()=>{
         if(!window.confirm('Disconnect Kalshi and delete your stored key from Big Vin?'))return;
         setBusy(true);
         try{await fetch('/api/my-bankroll/kalshi',{method:'DELETE',credentials:'same-origin'});setKalshi({});setKalshiMsg('Disconnected.');}finally{setBusy(false);}
       }}>Disconnect</button>
      </div>
     </div>}
    </div>

   </form>}

   {tab==='today'&&(Object.keys(bankrolls).length?<Today bankrolls={bankrolls} kalshi={kalshi} kalshiReferral={kalshiReferral}/>:<p className="bk-sub">Set at least one starting bankroll first.</p>)}

   {tab==='history'&&<>
    <p className="bk-note">{CARRY_NOTE}</p>
    {total&&<section className="bk-total">
     <div><span>All sports</span><strong>{usd(total.bankroll)}</strong></div>
     <div><span>Put in</span><b>{usd(total.putIn)}</b></div>
     <div><span>Net</span><b className={total.bankroll-total.putIn>=0?'bk-up':'bk-down'}>{signed(total.bankroll-total.putIn)}</b></div>
     <div><span>Re-ups</span><b>{total.reups}</b></div>
    </section>}
    {!data?.length&&<p className="bk-sub">Set starting bankrolls to see your History.</p>}
    <div className="bk-grid">{data?.map(s=><a key={s.sport} href={`/my-bankroll/${s.sport}`} className="bk-card">
     <div className="bk-head"><h2>{sportLabel(s.sport)}</h2><span className={s.kelly.net>=0?'bk-pill bk-pill-up':'bk-pill bk-pill-down'}>{signed(s.kelly.net)}</span></div>
     <strong className="bk-big">{usd(s.kelly.bankroll)}</strong>
     <Chart series={s.series} start={s.start} id={'m'+s.sport}/>
     <dl className="bk-stats">
      <div><dt>Started</dt><dd>{usd(s.start)}</dd></div>
      <div><dt>Put in</dt><dd>{usd(s.kelly.putIn)}</dd></div>
      <div><dt>Re-ups</dt><dd>{s.kelly.reups}</dd></div>
      <div><dt>Max drawdown</dt><dd>{(s.kelly.maxDrawdown*100).toFixed(1)}%</dd></div>
      <div><dt>Bets</dt><dd>{s.betCount ?? 0} / {s.picks}</dd></div>
     </dl>
    </a>)}</div>
   </>}

   <p className="bk-disclaimer bk-disclaimer-bottom">{DISCLAIMER}</p>
  </>}
 </main>;
}
