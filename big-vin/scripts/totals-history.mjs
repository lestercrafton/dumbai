/** Build free game histories with closing totals for the over/under experiment.
 * ESPN scoreboards (keyless) list finals by date; ESPN's core odds endpoint keeps each event's
 * last sportsbook total. Files: big-vin/data/totals/history-<sport>.json, refreshed incrementally.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {SPORT_PATHS} from '../lib/feeds/adapter.mjs';
export const historyFile=sport=>fileURLToPath(new URL(`../data/totals/history-${sport}.json`,import.meta.url));
const UA={'User-Agent':'big-vin-research/1.0 (+https://github.com/lestercrafton/dumbai)',Accept:'application/json'};
// Season windows (UTC dates) per sport: the two completed seasons plus the current one.
export const WINDOWS={
 cfb:[['2024-08-24','2025-01-21'],['2025-08-23','2026-01-20'],['2026-08-22','2027-01-20']],
 nba:[['2024-10-22','2025-06-23'],['2025-10-21','2026-06-22'],['2026-10-20','2027-06-21']],
 wnba:[['2025-05-16','2025-10-12'],['2026-05-08','2026-10-25']],
 cbb:[['2024-11-04','2025-04-08'],['2025-11-03','2026-04-07'],['2026-11-02','2027-04-06']],
};
const GROUPS={cfb:'&groups=80',cbb:'&groups=50'};
async function get(url,fetchImpl){for(let i=0;i<3;i++){try{const r=await fetchImpl(url,{headers:UA,signal:AbortSignal.timeout(30000)});if(r.status===404)return null;if(!r.ok)throw new Error('HTTP '+r.status);return await r.json();}catch(e){if(i===2)throw e;await new Promise(r=>setTimeout(r,1000*(i+1)));}}}
const days=(a,b)=>{const out=[];for(let t=Date.parse(a+'T00:00:00Z');t<=Date.parse(b+'T00:00:00Z');t+=86400000)out.push(new Date(t).toISOString().slice(0,10));return out;};
async function pool(items,n,fn){let i=0;await Promise.all(Array.from({length:n},async()=>{while(i<items.length){const k=i++;await fn(items[k]);}}));}

export function parseEvents(payload){
 const out=[];
 for(const e of payload?.events||[]){const c=e.competitions?.[0];if(!c||c.status?.type?.completed!==true)continue;
  const h=c.competitors?.find(x=>x.homeAway==='home'),a=c.competitors?.find(x=>x.homeAway==='away');if(!h||!a)continue;
  const hs=Number(h.score),as=Number(a.score);if(!Number.isFinite(hs)||!Number.isFinite(as))continue;
  out.push({id:String(e.id),date:String(e.date).slice(0,10),startTime:e.date,homeId:String(h.team?.id),awayId:String(a.team?.id),homeScore:hs,awayScore:as,neutral:c.neutralSite===true,dome:c.venue?.indoor===true});
 }
 return out;
}
export async function build(sport,{fetchImpl=globalThis.fetch,today=new Date().toISOString().slice(0,10),log=()=>{}}={}){
 const file=historyFile(sport),prev=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{games:[],fetchedDates:[]};
 const recent=new Set(days(new Date(Date.parse(today)-3*86400000).toISOString().slice(0,10),today));
 const done=new Set(prev.fetchedDates.filter(d=>!recent.has(d)));
 const want=WINDOWS[sport].flatMap(([a,b])=>days(a,b<today?b:today)).filter(d=>d<=today&&!done.has(d));
 const games=new Map(prev.games.map(g=>[g.id,g])),errors=[];
 await pool(want,8,async d=>{try{const j=await get(`https://site.api.espn.com/apis/site/v2/sports/${SPORT_PATHS[sport]}/scoreboard?dates=${d.replaceAll('-','')}&limit=1000${GROUPS[sport]||''}`,fetchImpl);for(const g of parseEvents(j))if(!games.has(g.id))games.set(g.id,{...g,total:undefined});done.add(d);}catch(e){errors.push(`${d}: ${e.message}`);}});
 const league=SPORT_PATHS[sport].split('/');
 const need=[...games.values()].filter(g=>g.total===undefined);log(`${sport}: ${want.length} dates, ${need.length} odds lookups`);
 await pool(need,16,async g=>{try{const j=await get(`https://sports.core.api.espn.com/v2/sports/${league[0]}/leagues/${league[1]}/events/${g.id}/competitions/${g.id}/odds`,fetchImpl);
  const item=(j?.items||[]).find(i=>Number.isFinite(i.overUnder));g.total=item?item.overUnder:null;}catch(e){errors.push(`odds ${g.id}: ${e.message}`);}});
 const out={schema:'big-vin-totals-history/1',sport,source:'ESPN scoreboards and core odds (last listed sportsbook total)',updatedAt:new Date().toISOString(),fetchedDates:[...done].sort(),games:[...games.values()].filter(g=>g.total!==undefined).sort((a,b)=>a.startTime.localeCompare(b.startTime))};
 // Only rewrite when games changed; one game per line keeps git diffs small.
 const changed=JSON.stringify(out.games)!==JSON.stringify(prev.games)||out.fetchedDates.length!==prev.fetchedDates.length;
 if(changed){fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,'{"schema":'+JSON.stringify(out.schema)+',"sport":'+JSON.stringify(sport)+',"source":'+JSON.stringify(out.source)+',"updatedAt":'+JSON.stringify(out.updatedAt)+',\n"fetchedDates":'+JSON.stringify(out.fetchedDates)+',\n"games":[\n'+out.games.map(g=>JSON.stringify(g)).join(',\n')+'\n]}\n');}
 return {sport,games:out.games.length,withTotal:out.games.filter(g=>g.total!==null).length,errors:errors.length};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 for(const sport of (process.argv[2]||'cfb,nba,wnba,cbb').split(',')){try{console.log(JSON.stringify(await build(sport,{log:console.error})));}catch(e){console.log(`::warning title=Totals history ${sport}::${e.message}`);}}
}
