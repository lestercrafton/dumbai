import {TableCell} from '@/components/ui/table';
import {spreadDecision} from '@/lib/spread-display.mjs';
import {moneylinePair} from '@/lib/moneyline.mjs';
import {scoreUnit,shortScoreUnit} from '@/lib/sport-copy';

export default function SpreadDecisionCells({record,sport}:{record:any,sport:string}){
 const d=spreadDecision(record);
 const ml=moneylinePair(record,sport);
 return <>
  <TableCell className="decision-pick"><strong className="spread-line lean">{d.pick||'No ATS pick'}</strong>{d.difference!=null&&d.pick&&<span className="difference-badge">{d.difference.toFixed(1)} {shortScoreUnit(sport)} difference</span>}</TableCell>
  <TableCell className="decision-market">{d.market.length?d.market.map((line:string)=><span className="spread-line" key={line}>{line}</span>):<span className="muted">No market spread</span>}</TableCell>
  <TableCell className="decision-model"><strong className="spread-line">{d.modelLine||'No projection'}</strong>{d.modelWinner&&<span className="subline">{d.modelWinner}{d.modelLine!=='Pick’em'&&' '+scoreUnit(sport)}</span>}</TableCell>
  <TableCell className="decision-edge">{d.edge!=null&&d.pick?<><strong className="edge-value">{Math.abs(d.edge).toFixed(1)}</strong><span className="subline">{shortScoreUnit(sport)} edge</span></>:<span className="muted">—</span>}</TableCell>
  <TableCell className="decision-moneyline">{ml?<><span className="spread-line ml-line">Vegas implies {ml.team} {ml.vegasImplied}</span><span className="spread-line ml-line fair">Big Vin fair {ml.bigVinFair}</span></>:<span className="muted">—</span>}</TableCell>
  <TableCell className="decision-result"><strong className={'result-badge '+d.color}>{d.label}</strong>{d.score&&<span className="score-line">Final {d.score}</span>}</TableCell>
 </>;
}
