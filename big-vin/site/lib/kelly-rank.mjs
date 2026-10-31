/** One ranking for the board and the bankroll: full-Kelly share from the win
 * chance and the price taken. Ties go to the bigger points edge (model vs
 * market spread), then the win-chance order (compareSignal). */
import {kellyStake} from './kelly-bankroll.mjs';
import {compareSignal} from './rank-signal.mjs';
const finite=x=>typeof x==='number'&&Number.isFinite(x);
export function pickPrice(g){
 const pick=g?.pickRevision??{},side=pick.side??g?.side;
 if(finite(pick.odds))return pick.odds;
 const m=g?.market??{};return side==='home'?m.homeSpreadPrice:side==='away'?m.awaySpreadPrice:null;
}
export function kellyConfidence(g){
 const p=g?.rankSignal?.winChance,o=pickPrice(g);
 return finite(p)&&finite(o)&&Math.abs(o)>=100?kellyStake(p,o):0;
}
export function compareKelly(a,b){
 const d=kellyConfidence(b)-kellyConfidence(a);
 if(Math.abs(d)>1e-12)return d;
 const e=(finite(b?.edge)?b.edge:-1)-(finite(a?.edge)?a.edge:-1);
 return Math.abs(e)>1e-9?e:compareSignal(a,b);
}
/** Raw points edge, biggest first; ties go to higher Kelly %, then kickoff. */
export function compareEdge(a,b){
 const e=(finite(b?.edge)?Math.abs(b.edge):-1)-(finite(a?.edge)?Math.abs(a.edge):-1);
 if(Math.abs(e)>1e-9)return e;
 const d=kellyConfidence(b)-kellyConfidence(a);
 if(Math.abs(d)>1e-12)return d;
 return String(a?.startTime??'').localeCompare(String(b?.startTime??''));
}
/** Renumber board ranks by raw edge (display only). Unranked games stay unranked. */
export function rankByEdge(games){
 const ranked=games.filter(g=>g?.rank).sort(compareEdge);const map=new Map(ranked.map((g,i)=>[g,i+1]));
 return games.map(g=>map.has(g)?{...g,kellyRank:g.rank,rank:map.get(g)}:g);
}
