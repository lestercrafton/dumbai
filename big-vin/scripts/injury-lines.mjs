/** Build Big Vin's NFL injury table: points each team loses to unavailable starters this week.
 * Free inputs: ESPN injuries, ESPN depth charts and team list, nflverse weekly player stats and player ids.
 * Writes big-vin/data/injury-lines/nfl.json. Source problems become warnings; the run never fails.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {parseInjuries,injuriesUrl} from '../lib/injuries.mjs';
import {statusWeight,qbEpa,qbPoints,teamLoss,QB,POSITION_POINTS,DEPTH_GROUP} from '../lib/injury-values.mjs';

export const OUT_FILE=fileURLToPath(new URL('../data/injury-lines/nfl.json',import.meta.url));
const UA={'User-Agent':'big-vin-research/1.0 (+https://github.com/lestercrafton/dumbai)'};
const ALIAS={WSH:'WAS',LA:'LAR',JAC:'JAX'};
const NFLVERSE='https://github.com/nflverse/nflverse-data/releases/download';
async function get(url,fetchImpl,as='json'){for(let i=0;i<3;i++){try{const r=await fetchImpl(url,{headers:UA,signal:AbortSignal.timeout(60000)});if(!r.ok)throw new Error(`HTTP ${r.status}`);return as==='json'?await r.json():await r.text();}catch(e){if(i===2)throw new Error(`${url.split('?')[0]}: ${e.message}`);await new Promise(r=>setTimeout(r,1500*(i+1)));}}}
export function csv(text){
 const rows=[];let row=[],cell='',q=false;
 for(let i=0;i<text.length;i++){const ch=text[i];
  if(q){if(ch==='"'){if(text[i+1]==='"'){cell+='"';i++;}else q=false;}else cell+=ch;}
  else if(ch==='"')q=true;else if(ch===','){row.push(cell);cell='';}else if(ch==='\n'){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell='';}else cell+=ch;}
 if(cell||row.length){row.push(cell);rows.push(row);}
 const [head,...body]=rows;return body.filter(r=>r.length>1).map(r=>Object.fromEntries(head.map((h,i)=>[h,r[i]])));
}
const idOf=ref=>String(ref||'').match(/athletes\/(\d+)/)?.[1]??null;
/** Depth chart: position key -> ESPN athlete ids in rank order (first formation that lists it). */
export function parseDepth(payload){
 const out={};
 for(const item of payload?.items||[])for(const [key,v] of Object.entries(item.positions||{})){if(out[key])continue;out[key]=(v.athletes||[]).slice().sort((a,b)=>a.rank-b.rank).map(a=>idOf(a.athlete?.$ref)).filter(Boolean);}
 return out;
}
/** Per-team weekly usage from nflverse rows. */
export function usage(rows){
 const byTeam={};
 for(const r of rows){if(r.season_type&&r.season_type!=='REG'&&r.season_type!=='POST')continue;
  const t=ALIAS[r.team]||r.team,s=Number(r.season),w=Number(r.week);
  const plays=Number(r.attempts||0)+Number(r.sacks_suffered||0)+Number(r.carries||0);
  const team=byTeam[t]??={games:new Set(),players:{}};team.games.add(s+':'+w);
  const p=team.players[r.player_id]??={id:r.player_id,name:r.player_display_name,position:r.position,weeks:[],targets:0,carries:0,qbPlays:0,games:new Set()};
  p.games.add(s+':'+w);p.targets+=s===maxSeason(rows)?Number(r.targets||0):0;p.carries+=s===maxSeason(rows)?Number(r.carries||0):0;
  if(r.position==='QB'){p.weeks.push({season:s,week:w,team:t,plays,epa:Number(r.passing_epa||0)+Number(r.rushing_epa||0)});if(s===maxSeason(rows))p.qbPlays+=plays;}
 }
 return byTeam;
}
let _max=null;const maxSeason=rows=>_max??=Math.max(...rows.map(r=>Number(r.season)));

/** Evaluate one team. Pure given its inputs, so tests can feed fixtures. */
export function evaluateTeam({abbr,depth,injuries,teamUse,season,allQbRows,espnToGsis,gsisToEspn,names=new Map()}){
 const items=[],notes=[];
 const statusOf=espnId=>espnId?injuries.get(espnId):null;
 const cur=[...(teamUse?.games||[])].filter(g=>g.startsWith(season+':'));
 // Season starter = most QB plays for this team this season (depth charts drop injured starters).
 const qbs=Object.values(teamUse?.players||{}).filter(p=>p.position==='QB'&&p.qbPlays>0).sort((a,b)=>b.qbPlays-a.qbPlays);
 const starter=qbs[0];
 if(starter){
  const sEspn=gsisToEspn.get(starter.id),inj=statusOf(sEspn),w=statusWeight(inj?.status);
  if(w>0){
   const depthQbs=(depth.qb||[]).filter(id=>id!==sEspn&&statusWeight(statusOf(id)?.status)<1);
   const backupEspn=depthQbs[0]??null,backupGsis=backupEspn?espnToGsis.get(backupEspn):null;
   const rowsFor=id=>allQbRows.get(id)||[];
   const s=qbEpa(rowsFor(starter.id),{season,prior:QB.starterPriorEpa}),b=qbEpa(backupGsis?rowsFor(backupGsis):[],{season,prior:QB.replacementEpa});
   const v=qbPoints({starter:s,backup:b,teamGames:cur.length,starterGames:[...starter.games].filter(g=>g.startsWith(season+':')).length});
   const backupName=backupGsis?names.get(backupGsis)??injuriesName(injuries,backupEspn)??backupGsis:backupEspn?`ESPN ${backupEspn}`:'unknown backup';
   items.push({group:'qb',position:'QB',player:starter.name,espnId:sEspn??null,status:inj.status,reported:inj.reported,weight:w,replacement:backupName,starterEpaPerPlay:round(s.shrunk,3),starterPlays:Math.round(s.plays),backupEpaPerPlay:round(b.shrunk,3),backupPlays:Math.round(b.plays),...v,points:round(v.points*w,2)});
  }
 }else notes.push('No QB usage found in nflverse for this season.');
 // Skill starters by usage; line and defense starters by ESPN depth rank 1.
 const players=Object.values(teamUse?.players||{});
 const top=(pos,key,n)=>players.filter(p=>p.position===pos).sort((a,b)=>b[key]-a[key]).slice(0,n);
 const skill=[...top('WR','targets',2).map((p,i)=>[p,i?'wr2':'wr1']),...top('TE','targets',1).map(p=>[p,'te1']),...top('RB','carries',1).map(p=>[p,'rb1'])];
 const seen=new Set();
 for(const [p,group] of skill){const e=gsisToEspn.get(p.id),inj=statusOf(e),w=statusWeight(inj?.status);if(e)seen.add(e);if(w>0)items.push({group,position:group.slice(0,2).toUpperCase(),player:p.name,espnId:e,status:inj.status,reported:inj.reported,weight:w,points:round(POSITION_POINTS[group]*w,2)});}
 for(const [key,ids] of Object.entries(depth)){const group=DEPTH_GROUP[key];if(!group||!ids[0]||seen.has(ids[0]))continue;seen.add(ids[0]);
  const inj=statusOf(ids[0]),w=statusWeight(inj?.status);if(w>0)items.push({group,position:key.toUpperCase(),player:inj.name,espnId:ids[0],status:inj.status,reported:inj.reported,weight:w,points:round(POSITION_POINTS[group]*w,2)});}
 return {team:abbr,loss:teamLoss(items),items,notes};
}
const round=(x,d)=>Math.round(x*10**d)/10**d;
const injuriesName=(inj,id)=>id?inj.get(id)?.name??null:null;

export async function build({fetchImpl=globalThis.fetch,now=new Date(),log=console.error}={}){
 const warnings=[],season=now.getUTCMonth()<2?now.getUTCFullYear()-1:now.getUTCFullYear();
 const teamsPayload=await get('https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams',fetchImpl);
 const teams=(teamsPayload.sports?.[0]?.leagues?.[0]?.teams||[]).map(t=>({id:String(t.team.id),abbr:ALIAS[t.team.abbreviation]||t.team.abbreviation}));
 const url=injuriesUrl('nfl'),injuries=parseInjuries(await get(url,fetchImpl),{url,observedAt:now.toISOString()});
 const players=csv(await get(`${NFLVERSE}/players/players.csv`,fetchImpl,'text'));
 const espnToGsis=new Map(),gsisToEspn=new Map(),names=new Map();for(const p of players)if(p.gsis_id)names.set(p.gsis_id,p.display_name);for(const p of players)if(p.espn_id&&p.gsis_id){espnToGsis.set(String(p.espn_id),p.gsis_id);gsisToEspn.set(p.gsis_id,String(p.espn_id));}
 const rows=[];for(const s of [season-1,season]){try{rows.push(...csv(await get(`${NFLVERSE}/stats_player/stats_player_week_${s}.csv`,fetchImpl,'text')));}catch(e){warnings.push(`nflverse ${s} stats: ${e.message}`);}}
 _max=season;const use=usage(rows);
 const allQbRows=new Map();for(const t of Object.values(use))for(const p of Object.values(t.players))if(p.position==='QB')allQbRows.set(p.id,[...(allQbRows.get(p.id)||[]),...p.weeks]);
 const out={};
 for(const t of teams){
  let depth={};try{depth=parseDepth(await get(`https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${season}/teams/${t.id}/depthcharts`,fetchImpl));}catch(e){warnings.push(`${t.abbr} depth chart: ${e.message}`);}
  out[t.abbr]=evaluateTeam({abbr:t.abbr,depth,injuries,teamUse:use[t.abbr],season,allQbRows,espnToGsis,gsisToEspn,names});
 }
 return {schema:'big-vin-injury-lines/1',sport:'nfl',generatedAt:now.toISOString(),season,
  method:'QB: (starter EPA/play - backup EPA/play, each shrunk toward a prior over 250 plays) x 36 plays x 0.85, between 2 and 10 points, reduced 8% per game the starter already missed (max 50%). Other starters: fixed points by position, capped at 3 per team. Out/IR/Doubtful/suspended count fully, Questionable 25%.',
  sources:[url,'ESPN depth charts (sports.core.api.espn.com)',`${NFLVERSE}/stats_player/`,`${NFLVERSE}/players/players.csv`],warnings,teams:out};
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 try{const r=await build();fs.mkdirSync(path.dirname(OUT_FILE),{recursive:true});
  const prev=fs.existsSync(OUT_FILE)?JSON.parse(fs.readFileSync(OUT_FILE,'utf8')):null;
  const same=prev&&JSON.stringify(prev.teams)===JSON.stringify(r.teams);
  if(!same)fs.writeFileSync(OUT_FILE,JSON.stringify(r,null,1)+'\n');
  for(const w of r.warnings)console.log(`::warning title=Injury lines::${w}`);
  const hit=Object.values(r.teams).filter(t=>t.loss>0).map(t=>`${t.team} -${t.loss}`);console.log(same?'unchanged':'written',hit.join(', '));
 }catch(e){console.log(`::warning title=Injury lines::${e.message} (previous table kept)`);}
}
