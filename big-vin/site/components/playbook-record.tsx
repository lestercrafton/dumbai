const signed=(n:number,d=2)=>`${n>0?'+':''}${n.toFixed(d)}`;
export const recordText=(r:any)=>r?`${r.wins}–${r.losses}${r.pushes?`–${r.pushes}`:''}`:'—';
export const roiText=(r:any)=>typeof r?.roi==='number'?`${signed(100*r.roi,1)}%`:'—';
export const clvText=(r:any)=>typeof r?.clv==='number'?`${signed(r.clv,2)} pts`:'—';
export const bankrollText=(r:any)=>typeof r?.bankroll==='number'?r.bankroll.toLocaleString('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}):'—';
/** One row of W-L, ROI, CLV and paper bankroll. */
export function RecordCells({record,bankroll=true}:{record:any,bankroll?:boolean}){
 return <><td>{recordText(record)}{record?.pending?<small> · {record.pending} pending</small>:null}{record?.backfilled?<small title="Captured before kickoff and committed to the runner's log, but posted here after the game started."> · {record.backfilled} posted late</small>:null}</td><td>{roiText(record)}</td><td>{clvText(record)}</td>{bankroll&&<td>{bankrollText(record)}{record?.bankrollBlockedBy?<small> · waiting on {record.bankrollBlockedBy}</small>:null}</td>}</>;
}
