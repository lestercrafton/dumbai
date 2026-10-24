'use client';
import {useMemo,useState} from 'react';
type Bet={t:string;betType?:string;game:string;pick:string;line:number;odds:number;edge:number|null;winChance:number|null;stake:number;amount:number;outcome:string;pl:number;after:number;reup:boolean;afterReup?:number};
const usd=(v:number)=>(v<0?'−':'')+'$'+Math.round(Math.abs(v)).toLocaleString('en-US');
const signed=(v:number)=>Math.round(v)===0?'$0':(v>0?'+':'')+usd(v);
const oddsFmt=(o:number)=>o>0?`+${o}`:`${o}`.replace('-','−');
const lineFmt=(l:number)=>l===0?'ML':(l>0?'+':'')+String(l).replace('-','−');
const day=(t:string)=>new Date(t).toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'America/Chicago'});
type Col='t'|'game'|'pick'|'edge'|'winChance'|'stake'|'amount'|'outcome'|'pl'|'after';
const COLS: {key:Col;label:string;num?:boolean}[]=[
 {key:'t',label:'Date'},{key:'game',label:'Game'},{key:'pick',label:'Pick'},
 {key:'edge',label:'Edge',num:true},{key:'winChance',label:'Win chance',num:true},
 {key:'stake',label:'Kelly',num:true},{key:'amount',label:'Bet',num:true},
 {key:'outcome',label:'Result'},{key:'pl',label:'P/L',num:true},{key:'after',label:'Bankroll',num:true},
];
function cmp(a:Bet,b:Bet,key:Col,dir:1|-1){
 const av=a[key],bv=b[key];
 if(av==null&&bv==null)return 0;
 if(av==null)return 1;
 if(bv==null)return -1;
 if(typeof av==='number'&&typeof bv==='number')return (av-bv)*dir;
 return String(av).localeCompare(String(bv),undefined,{numeric:true,sensitivity:'base'})*dir;
}
export default function SortableBetsTable({bets}:{bets:Bet[]}){
 const [sort,setSort]=useState<{key:Col;dir:1|-1}>({key:'t',dir:1});
 const rows=useMemo(()=>{
  const out=[...bets];
  out.sort((a,b)=>cmp(a,b,sort.key,sort.dir)||cmp(a,b,'t',1));
  return out;
 },[bets,sort]);
 const toggle=(key:Col)=>{
  setSort(s=>s.key===key?{key,dir:s.dir===1?-1:1}:{key,dir:key==='t'?1:-1});
 };
 const arrow=(key:Col)=>sort.key!==key?'':sort.dir===1?' ▲':' ▼';
 return <div className="bk-table-wrap"><table className="bk-table">
  <thead><tr>{COLS.map(c=><th key={c.key}><button type="button" className="bk-th" onClick={()=>toggle(c.key)} aria-sort={sort.key===c.key?(sort.dir===1?'ascending':'descending'):'none'}>{c.label}{arrow(c.key)}</button></th>)}</tr></thead>
  <tbody>{rows.map((b,i)=><tr key={i} className={b.reup?'bk-row-reup':b.stake>0?'':'bk-row-pass'}>
   <td>{day(b.t)}</td><td className="bk-game">{b.game}</td>
   <td>{b.betType&&b.betType!=='Spread'&&<span className="bk-type">{b.betType}</span>}{b.pick} {b.betType==='Moneyline'?'ML':lineFmt(b.line)} <span className="bk-dim">{oddsFmt(b.odds)}</span></td>
   <td>{b.edge==null?'—':b.edge.toFixed(1)}</td>
   <td>{b.winChance==null?'—':`${(b.winChance*100).toFixed(1)}%`}</td>
   <td>{b.stake>0?`${(b.stake*100).toFixed(1)}%`:'—'}</td>
   <td>{b.stake>0?usd(b.amount):'No bet'}</td>
   <td className={b.outcome==='win'?'bk-up':b.outcome==='loss'?'bk-down':''}>{b.outcome==='win'?'W':b.outcome==='loss'?'L':'Push'}</td>
   <td className={b.pl>0?'bk-up':b.pl<0?'bk-down':''}>{signed(b.pl)}</td>
   <td>{usd(b.after)}{b.reup&&<span className="bk-reup-tag">Re-up → {usd(b.afterReup??0)}</span>}</td>
  </tr>)}</tbody>
 </table></div>;
}
