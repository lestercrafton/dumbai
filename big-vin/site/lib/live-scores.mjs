/** Server live-score reads for the card overlay (Covering by / Needs X boxes).
 * ESPN rejects a same-day range like dates=20261023-20261023 with a 400, which
 * silently emptied the overlay, so a single day is requested as one date. */
import {scoreboardUrls} from './feeds/adapter.mjs';
const oneDay=(sport,d)=>scoreboardUrls(sport,{startDate:d}).map(u=>{const url=new URL(u);url.searchParams.set('dates',d.replaceAll('-',''));return url.toString();});
export function liveScoreUrls(sport,date,endDate=date){
 if(!endDate||endDate===date)return oneDay(sport,date);
 const start=Date.parse(date+'T00:00:00Z'),end=Date.parse(endDate+'T00:00:00Z');
 const days=Math.max(1,Math.min(8,Math.round((end-start)/86400000)+1));
 return Array.from({length:days},(_,i)=>new Date(start+i*86400000).toISOString().slice(0,10)).flatMap(d=>oneDay(sport,d));
}
