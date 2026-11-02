/** Free opening and closing spreads for basketball research.
 * Game list: big-vin/data/totals/history-<sport>.json (ESPN finals).
 * Lines: ESPN core odds per event (first listed book), home-team open and close point spread.
 * Output: big-vin/data/spreads/history-<sport>.json, refreshed incrementally. */
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
const LEAGUE={nba:['basketball','nba'],cbb:['basketball','mens-college-basketball']};
const UA={'User-Agent':'big-vin-research/1.0 (+https://github.com/lestercrafton/dumbai)',Accept:'application/json'};
const num=s=>{const n=Number(String(s??'').replace('PK','0'));return Number.isFinite(n)?n:null;};
async function get(url){for(let i=0;i<3;i++){try{const r=await fetch(url,{headers:UA,signal:AbortSignal.timeout(20000)});if(r.status===404)return null;if(!r.ok)throw new Error('HTTP '+r.status);return await r.json();}catch(e){if(i===2)throw e;await new Promise(r=>setTimeout(r,800*(i+1)));}}}
async function pool(items,n,fn){let i=0;await Promise.all(Array.from({length:n},async()=>{while(i<items.length){const k=i++;await fn(items[k]);}}));}
export async function build(sport){
 const out=fileURLToPath(new URL(`../data/spreads/history-${sport}.json`,import.meta.url));
 const games=JSON.parse(fs.readFileSync(fileURLToPath(new URL(`../data/totals/history-${sport}.json`,import.meta.url)))).games;
 const prev=fs.existsSync(out)?JSON.parse(fs.readFileSync(out)).lines:{};
 const lines={...prev};const [a,b]=LEAGUE[sport];let errors=0;
 await pool(games.filter(g=>!(g.id in lines)),24,async g=>{try{
  const j=await get(`https://sports.core.api.espn.com/v2/sports/${a}/leagues/${b}/events/${g.id}/competitions/${g.id}/odds`);
  const i=(j?.items||[]).find(x=>x.homeTeamOdds);if(!i){lines[g.id]=null;return;}
  const h=i.homeTeamOdds;
  lines[g.id]={open:num(h.open?.pointSpread?.american),close:num(h.close?.pointSpread?.american)??num(i.spread),closePrice:num(h.close?.spread?.american),provider:i.provider?.name??null};
 }catch{errors++;}});
 fs.writeFileSync(out,JSON.stringify({schema:'big-vin-spread-history/1',sport,source:'ESPN core odds, home open and close point spread',updatedAt:new Date().toISOString(),lines}));
 console.log(sport,Object.keys(lines).length,'lines',errors,'errors');
}
if(process.argv[1]===fileURLToPath(import.meta.url))for(const s of process.argv.slice(2))await build(s);
