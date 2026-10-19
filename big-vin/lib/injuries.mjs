/** Free public ESPN injury and news inputs for the injury challengers.
 * Endpoints are ESPN's keyless public JSON (the same family as the scoreboards).
 * Every input carries its source URL and the time it was observed.
 */
import {SPORT_PATHS} from './feeds/adapter.mjs';
export const OUT_STATUSES=new Set(['out','injured reserve','ir','doubtful','suspension','suspended','inactive','physically unable to perform','pup']);
const OUT_HEADLINE=/\b(ruled out|(?:is|are|will be|listed as) out|out (?:vs\.?|against|for|at|with|indefinitely|this week|for the season)|won['’]t play|will not play|not expected to play|to miss|will miss|misses|sidelined|season-ending|(?:place[sd]?|put) (?:\S+ ){0,3}on (?:injured reserve|ir)\b|out\b(?=[,;:]|\s*$))/i;
const NOT_OUT=/\b(questionable|probable|game-time decision|expected to play|will play|set to return|returns?|cleared|available|back at practice)\b/i;
const athleteId=value=>String(value||'').match(/athletes?\/(?:_\/id\/)?(\d+)/)?.[1]??String(value||'').match(/\/id\/(\d+)/)?.[1]??null;
export const injuriesUrl=sport=>`https://site.api.espn.com/apis/site/v2/sports/${SPORT_PATHS[sport]}/injuries`;
export const newsUrl=(sport,teamId)=>`https://site.api.espn.com/apis/site/v2/sports/${SPORT_PATHS[sport]}/news?team=${encodeURIComponent(teamId)}&limit=50`;
const LEADER_CATEGORY={nfl:'passingLeader',cfb:'passingLeader',nba:'pointsPerGame',wnba:'pointsPerGame',cbb:'pointsPerGame'};
async function getJson(url,fetchImpl){
 const r=await fetchImpl(url,{headers:{Accept:'application/json','User-Agent':'big-vin-research/1.0 (+https://github.com/lestercrafton/dumbai)'},signal:AbortSignal.timeout(30000)});
 if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json();
}

/** One request per sport: latest status per athlete id. */
export function parseInjuries(payload,{url,observedAt}){
 const byAthlete=new Map();
 for(const team of payload?.injuries||[])for(const item of team.injuries||[]){
  const a=item.athlete||{};const id=athleteId((a.links||[]).map(l=>l.href).find(h=>/\/id\/\d+/.test(h||''))||a.$ref||a.id);
  if(!id)continue;
  const entry={athleteId:id,name:a.displayName||null,position:a.position?.abbreviation||null,teamId:String(team.id),status:item.status||item.type?.description||null,reported:item.date||null,source:'espn-injuries',url,observedAt};
  const prev=byAthlete.get(id);if(!prev||String(entry.reported)>String(prev.reported))byAthlete.set(id,entry);
 }
 return byAthlete;
}

/** Season leaders that ESPN embeds in each scoreboard competitor (scheduled games included). */
export function scoreboardLeaders(rawEvent,sport,{url,observedAt}){
 const out={};
 for(const c of rawEvent?.competitions?.[0]?.competitors||[]){
  const cat=(c.leaders||[]).find(l=>l.name===LEADER_CATEGORY[sport])||(sport==='nba'||sport==='wnba'||sport==='cbb'?(c.leaders||[]).find(l=>/^points/.test(l.name)):null);
  out[String(c.team?.id)]=(cat?.leaders||[]).slice(0,1).map(l=>({athleteId:String(l.athlete?.id??''),name:l.athlete?.displayName??null,position:l.athlete?.position?.abbreviation??null,leader:l.displayValue??null,category:cat.name,source:'espn-scoreboard-leaders',url,observedAt})).filter(l=>l.athleteId);
 }
 return out;
}

/** A headline counts only if it names the player, says out, and is not hedged. */
export function headlineSaysOut(text,name){
 if(!text||!name)return false;
 const last=name.replace(/\b(jr|sr|ii|iii|iv)\.?$/i,'').trim().split(/\s+/).at(-1);
 if(!last||!new RegExp('\\b'+last.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\b','i').test(text))return false;
 return OUT_HEADLINE.test(text)&&!NOT_OUT.test(text);
}

/** Decide whether one key player is out for a game, with the evidence used. */
export function playerStatus(player,{injuries,news=[],kickoff,now}){
 const evidence=[];let out=false;
 const injury=injuries?.get(player.athleteId);
 if(injury){
  const isOut=OUT_STATUSES.has(String(injury.status).toLowerCase());
  evidence.push({source:injury.source,url:injury.url,observedAt:injury.observedAt,reported:injury.reported,status:injury.status,effectiveOut:isOut});
  out=isOut;
 }
 const windowStart=Date.parse(kickoff)-6*86400000;
 for(const a of news){
  const published=Date.parse(a.published);if(!(published>=windowStart&&published<=Date.parse(now)&&published<Date.parse(kickoff)))continue;
  const text=[a.headline,a.description].filter(Boolean).join(' — ');
  if(!headlineSaysOut(a.headline,player.name))continue;
  // A later Active injury status overrides an older headline.
  if(injury&&!OUT_STATUSES.has(String(injury.status).toLowerCase())&&Date.parse(injury.reported)>published)continue;
  evidence.push({source:'espn-team-news',url:a.url,observedAt:a.observedAt,published:a.published,headline:a.headline,text:text.slice(0,240),effectiveOut:true});
  out=true;
 }
 return {out,evidence};
}

/** Fetch and cache the inputs a sport needs for one run. */
export function injuryContext(sport,{fetchImpl=globalThis.fetch,now=new Date().toISOString(),log=()=>{}}={}){
 const cache=new Map(),errors=[];
 const once=(key,fn)=>{if(!cache.has(key))cache.set(key,fn().catch(e=>{errors.push({key,error:e.message});log(`${sport} ${key}: ${e.message}`);return null;}));return cache.get(key);};
 const injuries=()=>once('injuries',async()=>{const url=injuriesUrl(sport);return parseInjuries(await getJson(url,fetchImpl),{url,observedAt:new Date().toISOString()});});
 const teamNews=teamId=>once('news:'+teamId,async()=>{const url=newsUrl(sport,teamId),observedAt=new Date().toISOString();const v=await getJson(url,fetchImpl);return (v.articles||[]).map(a=>({headline:a.headline,description:a.description,published:a.published,url:a.links?.web?.href||url,observedAt}));});
 /** Key players (season leaders from the scoreboard) and whether each is out for this game. */
 async function keyPlayers(team,{leaders=[],kickoff}){
  if(!leaders.length)return {team:team.id,players:[],note:'No season leader listed by ESPN for this team; no adjustment.'};
  const [inj,news]=await Promise.all([injuries(),teamNews(team.id)]);
  const inputs={injuries:inj?'ok':'unavailable',news:news?'ok':'unavailable'};
  return {team:team.id,inputs,players:leaders.map(p=>({...p,...playerStatus(p,{injuries:inj,news:news||[],kickoff,now})})),note:inj&&news?null:'Some injury inputs were unavailable this run; absence of evidence is not evidence the player is active.'};
 }
 return {keyPlayers,errors};
}
