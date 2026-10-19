#!/usr/bin/env node
// Rebuilds what a new host can recover from the old site's PUBLIC pages before the full export exists:
// saved forecasts (every sport, cohort, model version and week shown by /api/results) and the learning log.
// Output is SQL for `wrangler d1 execute --file`. Every insert is ON CONFLICT DO NOTHING, so the full export
// and live collection can fill in later without overwriting anything, and every recovered row is labeled.
// Usage: node scripts/public-recovery.mjs <old-site-url> <out-dir>
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

export const SPORTS=['nfl','cfb','nba','wnba','cbb','nhl','mlb'];
export const COHORTS=['live','recovered','retrospective'];
// Fields the results API adds when it reads a row; they are recomputed on the new host.
const DERIVED=['spreadGrade','cardRank','result'];
const q=v=>v===null||v===undefined?'NULL':typeof v==='number'?(Number.isFinite(v)?String(v):'NULL'):"'"+String(v).replaceAll("'","''")+"'";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

export function forecastRow(record,{fetchedAt,sourceUrl}){
 const payload={...record};for(const k of DERIVED)delete payload[k];
 payload.recovery={source:'public-results-api',sourceUrl,fetchedAt,note:'Recovered from the public site before the full database export; the export replaces nothing it already has.'};
 return {id:record.id,sport:record.sport,weekKey:record.weekKey,cohort:record.cohort,startTime:record.startTime,capturedAt:record.capturedAt,payload,result:record.result??null};
}
export function forecastSql(r){
 return `INSERT INTO forecasts (id,sport,week_key,cohort,start_time,captured_at,payload,result,graded_at) VALUES (${[r.id,r.sport,r.weekKey,r.cohort,r.startTime,r.capturedAt,JSON.stringify(r.payload),r.result?JSON.stringify(r.result):null,r.result?.observedAt??null].map(q).join(',')}) ON CONFLICT(id) DO NOTHING;`;
}
export function learningSql(e){
 return `INSERT INTO learning_entries (id,published_at,sport,week_key,payload) VALUES (${[e.id,e.publishedAt,e.sport,e.weekKey,JSON.stringify(e)].map(q).join(',')}) ON CONFLICT(id) DO NOTHING;`;
}
const valid=f=>f&&typeof f.id==='string'&&SPORTS.includes(f.sport)&&typeof f.weekKey==='string'&&typeof f.cohort==='string'&&Number.isFinite(Date.parse(f.startTime))&&Number.isFinite(Date.parse(f.capturedAt));

export async function recover(site,{fetchImpl=fetch,log=console.error,delay=250,learningSeedIds=new Set()}={}){
 const get=async path=>{for(let a=0;;a++){const r=await fetchImpl(site+path,{headers:{accept:'application/json'},signal:AbortSignal.timeout(60000)});if(r.ok)return r.json();if(a>=3||r.status<500)throw Error(`${path}: HTTP ${r.status}`);await sleep(2000*2**a);}};
 const forecasts=new Map(),requests=[],fetchedAt=new Date().toISOString();
 for(const sport of SPORTS)for(const cohort of COHORTS){
  const first=await get(`/api/results?sport=${sport}&cohort=${cohort}`);await sleep(delay);
  for(const {id:version} of first.versions||[]){
   const base=`/api/results?sport=${sport}&cohort=${cohort}&version=${encodeURIComponent(version)}`;
   const top=version===first.version?first:await get(base);if(top!==first)await sleep(delay);
   for(const {key} of top.weeks||[]){
    const path=`${base}&week=${encodeURIComponent(key)}`;
    const page=key===top.selectedWeek?top:await get(path);if(page!==top)await sleep(delay);
    let n=0;for(const f of page.records||[])if(valid(f)&&f.cohort===cohort&&!forecasts.has(f.id)){forecasts.set(f.id,forecastRow(f,{fetchedAt,sourceUrl:site+path}));n++;}
    requests.push({sport,cohort,version,week:key,records:(page.records||[]).length,added:n});
   }
  }
  log(`${sport}/${cohort}: ${[...forecasts.values()].filter(f=>f.sport===sport&&f.cohort===cohort).length} forecasts`);
 }
 const learning=((await get('/api/learning')).entries||[]).filter(e=>!learningSeedIds.has(e.id));
 return {fetchedAt,forecasts:[...forecasts.values()],learning,requests};
}
export async function writeRecovery(out,{forecasts,learning,requests,fetchedAt},site){
 await mkdir(out,{recursive:true});
 const lines=[...forecasts.map(forecastSql),...learning.map(learningSql)];
 const files=[];let chunk=[],size=0;
 const flush=async()=>{if(!chunk.length)return;const name=`recovery-${String(files.length+1).padStart(3,'0')}.sql`;await writeFile(join(out,name),chunk.join('\n')+'\n');files.push(name);chunk=[];size=0;};
 for(const l of lines){if(l.length>95000)throw Error('A recovered row is too large for one D1 statement.');if(size+l.length>3_000_000)await flush();chunk.push(l);size+=l.length;}
 await flush();
 const counts={};for(const f of forecasts){const k=`${f.sport}/${f.cohort}`;counts[k]=(counts[k]||0)+1;}
 const report={site,fetchedAt,forecasts:forecasts.length,graded:forecasts.filter(f=>f.result).length,byScope:counts,learningEntries:learning.length,files,requests};
 await writeFile(join(out,'recovery-report.json'),JSON.stringify(report,null,1));
 return report;
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
 const [site,out]=process.argv.slice(2);if(!site||!out){console.error('Usage: node scripts/public-recovery.mjs <old-site-url> <out-dir>');process.exit(2);}
 const seed=(await import('../lib/learning-seed.json',{with:{type:'json'}})).default;
 const data=await recover(site.replace(/\/$/,''),{learningSeedIds:new Set(seed.map(e=>e.id))});
 const report=await writeRecovery(out,data,site);
 console.log(JSON.stringify({forecasts:report.forecasts,graded:report.graded,learningEntries:report.learningEntries,files:report.files.length,byScope:report.byScope}));
}
