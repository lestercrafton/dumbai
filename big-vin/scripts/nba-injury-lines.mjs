/** NBA injury table: points of home margin lost to players listed out.
 * Sources (free, keyless): ESPN NBA injuries, ESPN team schedules and box scores.
 * Player value = average over the team's last 10 games of (game score - 0.30 x minutes),
 * floor 0, for players with 3+ appearances and 15+ minutes a game. Team loss =
 * 0.31 x sum(value x status weight). The 0.31 is the fitted coefficient on
 * missing-player value in the 2024-26 walk-forward fit (scripts/basketball-backtest.mjs research).
 * Status weight: Out 1, Doubtful 0.75, Questionable 0.4, Probable/Day-to-day 0.1.
 * Writes big-vin/data/injury-lines/nba.json. Any failure keeps the old table. */
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
const OUT=fileURLToPath(new URL('../data/injury-lines/nba.json',import.meta.url));
const BASE='https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const UA={'User-Agent':'big-vin-research/1.0 (+https://github.com/lestercrafton/dumbai)',Accept:'application/json'};
export const COEF=0.31,REPLACEMENT=0.30;
async function get(url){for(let i=0;i<3;i++){try{const r=await fetch(url,{headers:UA,signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error('HTTP '+r.status);return await r.json();}catch(e){if(i===2)throw e;await new Promise(r=>setTimeout(r,700*(i+1)));}}}
async function pool(items,n,fn){let i=0;await Promise.all(Array.from({length:n},async()=>{while(i<items.length){const k=i++;await fn(items[k]);}}));}
const num=x=>{const n=parseFloat(x);return Number.isFinite(n)?n:0;};
const pair=s=>String(s||'0-0').split('-').map(num);
export function statusWeight(inj){
 const s=String(inj.status||'').toLowerCase(),c=String(inj.shortComment||'').toLowerCase();
 if(s==='out'||/\bout\b|ruled out|will not play|won't play/.test(c))return {label:'Out',weight:1};
 if(/doubtful/.test(c))return {label:'Doubtful',weight:0.75};
 if(/questionable|game-time/.test(c))return {label:'Questionable',weight:0.4};
 return {label:inj.status||'Day-To-Day',weight:0.1};
}
export function gameScore(r){const [fg,fga]=pair(r.FG),[ft,fta]=pair(r.FT);return num(r.PTS)+0.4*fg-0.7*fga-0.4*(fta-ft)+0.7*num(r.OREB)+0.3*num(r.DREB)+num(r.STL)+0.7*num(r.AST)+0.7*num(r.BLK)-0.4*num(r.PF)-num(r.TO);}
async function main(){
 const inj=await get(BASE+'/injuries');
 const teams=(await get(BASE+'/teams')).sports[0].leagues[0].teams.map(t=>t.team);
 const recent=new Map();// teamId -> event ids
 await pool(teams,8,async t=>{const s=await get(`${BASE}/teams/${t.id}/schedule`);recent.set(String(t.id),(s.events||[]).filter(e=>e.competitions?.[0]?.status?.type?.completed).slice(-10).map(e=>e.id));});
 const ids=[...new Set([...recent.values()].flat())],box=new Map();
 await pool(ids,12,async id=>{try{const d=await get(`${BASE}/summary?event=${id}`);box.set(id,d.boxscore?.players||[]);}catch{}});
 const values={};// teamId -> athleteId -> {n,min,gs,name}
 for(const [tid,evs] of recent)for(const id of evs)for(const t of box.get(id)||[]){if(String(t.team.id)!==tid)continue;const st=t.statistics?.[0];if(!st)continue;
  for(const a of st.athletes||[]){if(a.didNotPlay||!a.stats?.length)continue;const r=Object.fromEntries(st.labels.map((l,i)=>[l,a.stats[i]]));const v=((values[tid]??={})[a.athlete?.id]??={n:0,min:0,gs:0,name:a.athlete?.displayName});v.n++;v.min+=num(r.MIN);v.gs+=gameScore(r);}}
 const out={schema:'big-vin-injury-lines/1',sport:'nba',generatedAt:new Date().toISOString(),method:`Player value = last-10-game average of (game score - ${REPLACEMENT} x minutes), floor 0, players with 3+ games and 15+ minutes a game. Team loss = ${COEF} x sum(value x status weight); Out 1, Doubtful 0.75, Questionable 0.4, other day-to-day 0.1. ${COEF} is fitted on 2024-26 games.`,sources:[BASE+'/injuries',BASE+'/teams/{id}/schedule',BASE+'/summary?event={id}'],teams:{}};
 for(const t of inj.injuries||[]){const tid=String(t.id),vals=values[tid]||{};const items=[];let loss=0;
  for(const i of t.injuries||[]){const href=i.athlete?.links?.[0]?.href||'';const pid=(href.match(/\/id\/(\d+)/)||[])[1];const v=pid&&vals[pid];
   const {label,weight}=statusWeight(i);let value=0;if(v&&v.n>=3&&v.min/v.n>=15)value=Math.max(0,(v.gs-REPLACEMENT*v.min)/v.n);
   const points=Math.round(COEF*value*weight*100)/100;loss+=points;
   items.push({player:i.athlete?.displayName,position:i.athlete?.position?.abbreviation??null,status:label,points,minutes:v?Math.round(v.min/v.n*10)/10:0});}
  out.teams[tid]={loss:Math.round(loss*100)/100,items:items.filter(x=>x.points>0||x.status==='Out')};}
 for(const t of teams)out.teams[String(t.id)]??={loss:0,items:[]};
 fs.mkdirSync(fileURLToPath(new URL('../data/injury-lines/',import.meta.url)),{recursive:true});
 fs.writeFileSync(OUT,JSON.stringify(out,null,1)+'\n');console.log('NBA injury table:',Object.keys(out.teams).length,'teams');
}
if(process.argv[1]===fileURLToPath(import.meta.url))main().catch(e=>{console.log('NBA injury table skipped:',e.message);});
