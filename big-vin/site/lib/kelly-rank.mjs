/** One ranking for the board and the bankroll: full-Kelly share from the win
 * chance and the price taken. Kelly-zero games and ties fall back to the
 * win-chance order (compareSignal). */
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
 return Math.abs(d)>1e-12?d:compareSignal(a,b);
}
