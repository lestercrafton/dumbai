// Precompute the Cloudflare site's public reads (see cloudflare/read-cache.mjs).
//
// Runs on GitHub Actions (big-vin-cloudflare-cache.yml): keeps a copy of the
// site's D1 database in a local SQLite file, runs the site's own GET handlers
// against it in Node, sends back the writes those requests made (the same ones
// a visitor's request makes), then uploads the finished response bodies.
// Visitor requests then read one row instead of recomputing on the free plan.
//
// Env: BV_SITE (default https://big-vin.lestercrafton.workers.dev), BV_RENDER_DB
// (local copy, default /tmp/bv-render/site.sqlite), and either GitHub's OIDC
// request variables or BV_RENDER_TOKEN_FILE (the site's admin token, for runs
// outside Actions).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {SqliteD1} from './render/sqlite-d1.mjs';
import {RENDER_TABLES} from '../lib/render-source.mjs';
import zlib from 'node:zlib';
import {apiCacheKey,storableHeaders,VINEXT_VARY,MAX_BODY_CHARS,GZIP_PREFIX} from '../cloudflare/read-cache.mjs';
import {activeProviderSeason} from '../lib/provider-season.mjs';
import {footballWeekStart} from '../lib/board-window.mjs';

const site=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const SPORTS=['nfl','cfb','nba','wnba','cbb','nhl','mlb'];
export const SCHEMA_VERSION='1';
const FULL_EVERY_MS=12*3600_000;
const OVERLAP_MS=30*60_000;
const REGISTERED_DAYS=3;
const REFRESH_UNCHANGED_MS=20*60_000;
const log=(...a)=>console.log(new Date().toISOString(),...a);

export function easternDay(ms=Date.now()){
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(ms));
 const get=k=>parts.find(p=>p.type===k)?.value;return `${get('year')}-${get('month')}-${get('day')}`;
}
/** Keys rendered every run, whether or not anyone has asked for them yet. */
export function baseKeys(today=easternDay()){
 const urls=['/api/learning','/api/playbook?view=challengers','/api/playbook?view=versions','/api/playbook?view=scoreboards','/api/college-experiment?date=2026-09-26'];
 for(const s of SPORTS)urls.push(`/api/slate?sport=${s}&date=${today}&days=1`,`/api/results?sport=${s}&rankPeriod=week`,`/api/results?sport=${s}&history=1&cohort=live`);
 return urls.map(u=>apiCacheKey(new URL(u,'https://x')));
}
export const keyUrl=(key,origin)=>origin+key.slice('api:'.length);
const keyOf=url=>apiCacheKey(new URL(url,'https://x'));
/** Football week boards the home page asks for when NFL or college football is picked. */
export function weekSlateKeys(today=easternDay()){
 return ['nfl','cfb'].map(s=>keyOf(`/api/slate?sport=${s}&date=${footballWeekStart(today,s)}&days=7`));
}
/** The record requests the home page makes once a board is loaded, built the way
 * components/record-summary.tsx builds them (the season comes from that board). */
export function recordKeys(boards,today=easternDay(),now=Date.now()){
 const keys=[];
 for(const {sport,days,body} of boards){
  let board;try{board=JSON.parse(body);}catch{continue;}
  if(board?.sport!==sport)continue;
  const season=activeProviderSeason(board.seasonContext,now);
  const week=days===7;
  const params=new URLSearchParams({sport,cohort:'live',history:'1',summary:'1',rankPeriod:week?'week':'day',historyDate:today});
  if(season!==null)params.set('season',String(season));
  if(week)params.set('rankAnchor',footballWeekStart(today,sport));
  keys.push(keyOf('/api/results?'+params));
 }
 return keys;
}

/** Which registered keys to keep rendering, and which to drop so a later visit re-registers them. */
export function planKeys(remote,base,now=Date.now(),today=easternDay(now)){
 const baseSet=new Set(base),render=new Set(base),drop=[];
 for(const r of remote){
  if(r.key.startsWith('page:')||r.key.startsWith('rsc:')){const day=r.key.split(':')[2];if(day<easternDay(now-86400_000))drop.push(r.key);continue;}
  if(!r.key.startsWith('api:')||baseSet.has(r.key))continue;
  if(now-Date.parse(r.registered_at)>REGISTERED_DAYS*86400_000)drop.push(r.key);else render.add(r.key);
 }
 return {render:[...render],drop};
}

class Remote{
 constructor(origin){this.origin=origin;this.token=null;this.tokenAt=0;}
 async auth(){
  if(process.env.BV_RENDER_TOKEN_FILE)return fs.readFileSync(process.env.BV_RENDER_TOKEN_FILE,'utf8').trim();
  if(this.token&&Date.now()-this.tokenAt<240_000)return this.token;
  const url=new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL||'');url.searchParams.set('audience',this.origin+'/api/render');
  const r=await fetch(url,{headers:{authorization:'Bearer '+process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}});
  if(!r.ok)throw new Error('GitHub identity request failed: '+r.status);
  this.token=(await r.json()).value;this.tokenAt=Date.now();return this.token;
 }
 async call(method,params,{body,headers={}}={}){
  const url=new URL('/api/render',this.origin);for(const [k,v] of Object.entries(params))url.searchParams.set(k,String(v));
  for(let attempt=1;;attempt++){
   const r=await fetch(url,{method,headers:{authorization:'Bearer '+await this.auth(),...headers},body,signal:AbortSignal.timeout(60000)}).catch(e=>({ok:false,status:0,text:async()=>String(e)}));
   if(r.ok)return r.json();
   const text=await r.text();
   if(attempt>=4||(r.status>=400&&r.status<500&&r.status!==429))throw new Error(`${method} ${params.op} failed: ${r.status} ${text.slice(0,300)}`);
   await new Promise(res=>setTimeout(res,1000*attempt*attempt));
  }
 }
 get(params){return this.call('GET',params);}
 post(params,body,headers){return this.call('POST',params,{body,headers});}
}

function migrations(){
 const dir=path.join(site,'drizzle');
 return fs.readdirSync(dir).filter(f=>f.endsWith('.sql')).sort().flatMap(f=>fs.readFileSync(path.join(dir,f),'utf8').split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean));
}
function openLocal(file,fresh){
 fs.mkdirSync(path.dirname(file),{recursive:true});
 if(fresh)for(const f of [file,file+'-wal',file+'-shm'])fs.rmSync(f,{force:true});
 const d1=new SqliteD1(file);d1.recording=false;
 if(fresh){for(const s of migrations())d1.sqlite.exec(s);}
 d1.sqlite.exec('CREATE TABLE IF NOT EXISTS _render_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
 d1.sqlite.exec('CREATE TABLE IF NOT EXISTS _render_uploads (key TEXT PRIMARY KEY, hash TEXT NOT NULL, rendered_at TEXT NOT NULL)');
 return d1;
}
const getState=(d1,k)=>{const r=d1.sqlite.prepare('SELECT value FROM _render_state WHERE key=?').get(k);return r?JSON.parse(r.value):null;};
const setState=(d1,k,v)=>d1.sqlite.prepare('INSERT INTO _render_state (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k,JSON.stringify(v));
function upsert(d1,table,rows){
 if(!rows.length)return;
 const cols=Object.keys(rows[0]).filter(c=>c!=='__rowid');
 const st=d1.sqlite.prepare(`INSERT OR REPLACE INTO ${table} (rowid,${cols.join(',')}) VALUES (?${',?'.repeat(cols.length)})`);
 for(const r of rows)st.run(r.__rowid,...cols.map(c=>r[c]));
}
// Page sizes keep each request's JSON small enough for the Worker's CPU limit.
const PAGE={forecasts:40,collection_runs:15,feed_cache:3,completed_games:200,pick_revision_states:150,challenger_picks:150,learning_entries:40};
async function pullAfter(remote,d1,table,after){
 let n=0;
 for(;;){const rows=await remote.get({op:'rows',table,after,limit:PAGE[table]||500});upsert(d1,table,rows);n+=rows.length;if(rows.length<(PAGE[table]||500))return n;after=rows.at(-1).__rowid;}
}
async function pullChanged(remote,d1,table,since){
 const column=RENDER_TABLES[table].changed;let afterRowid=0,n=0;
 for(;;){const rows=await remote.get({op:'changed',table,since,afterRowid,limit:PAGE[table]||500});upsert(d1,table,rows);n+=rows.length;if(rows.length<(PAGE[table]||500))return n;since=rows.at(-1)[column];afterRowid=rows.at(-1).__rowid;}
}
/** Bring the local copy up to date. Returns rows fetched per table. */
export async function sync(remote,file,now=Date.now()){
 let d1=openLocal(file,false);
 const state=getState(d1,'sync');
 const full=!state||state.version!==SCHEMA_VERSION||state.dirty||now-Date.parse(state.fullAt)>FULL_EVERY_MS;
 if(full){d1.close();d1=openLocal(file,true);}
 const startedAt=new Date(now).toISOString();
 const max=await remote.get({op:'max'});
 const counts={};
 d1.sqlite.exec('BEGIN');
 try{
  for(const [table,how] of Object.entries(RENDER_TABLES)){
   const known=full?0:Number(state.max?.[table]??0);
   if(how.recentBySport&&full){counts[table]=0;for(const sport of SPORTS){const rows=await remote.get({op:'runs',sport,limit:90});upsert(d1,table,rows);counts[table]+=rows.length;}continue;}
   if(how.full){d1.sqlite.exec(`DELETE FROM ${table}`);counts[table]=await pullAfter(remote,d1,table,0);continue;}
   counts[table]=max[table]>known?await pullAfter(remote,d1,table,known):0;
   if(how.changed&&!full)counts[table]+=await pullChanged(remote,d1,table,new Date(Date.parse(state.syncedAt)-OVERLAP_MS).toISOString());
  }
  setState(d1,'sync',{version:SCHEMA_VERSION,syncedAt:startedAt,fullAt:full?startedAt:state.fullAt,max,dirty:false});
  d1.sqlite.exec('COMMIT');
 }catch(e){d1.sqlite.exec('ROLLBACK');d1.close();throw e;}
 return {d1,full,counts};
}
function chunks(writes){
 const out=[];let cur=[],size=0;
 for(const w of writes){const s=JSON.stringify(w).length;if(cur.length&&(cur.length>=60||size+s>150_000)){out.push(cur);cur=[];size=0;}cur.push(w);size+=s;}
 if(cur.length)out.push(cur);return out;
}
async function loadHandlers(){
 const out=path.join(process.env.BV_RENDER_BUILD||'/tmp/bv-render','handlers.mjs');
 const esbuild=await import('esbuild');
 await esbuild.build({entryPoints:[path.join(site,'scripts/render/entry.ts')],bundle:true,platform:'node',format:'esm',target:'node22',outfile:out,
  alias:{'cloudflare:workers':path.join(site,'scripts/render/cloudflare-workers-shim.mjs')},tsconfig:path.join(site,'tsconfig.json'),logLevel:'warning',
  banner:{js:"import {createRequire as __cr} from 'node:module';const require=__cr(import.meta.url);"}});
 return import(pathToFileURL(out).href+'?t='+Date.now());
}
const HANDLERS={'/api/slate':'slate','/api/results':'results','/api/learning':'learning','/api/college-experiment':'collegeExperiment','/api/playbook':'playbook'};
export async function render(handlers,key,origin){
 const url=new URL(keyUrl(key,origin));
 const renderedAt=new Date().toISOString();
 const response=await handlers[HANDLERS[url.pathname]](new Request(url));
 const body=await response.text();
 const headers=storableHeaders(response.headers);if(!headers.some(h=>h[0]==='vary'))headers.push(['vary',VINEXT_VARY]);headers.sort((a,b)=>a[0]<b[0]?-1:1);
 return {key,status:response.status,headers,body,renderedAt};
}

export async function main(){
 const origin=(process.env.BV_SITE||'https://big-vin.lestercrafton.workers.dev').replace(/\/$/,'');
 const file=process.env.BV_RENDER_DB||'/tmp/bv-render/site.sqlite';
 const remote=new Remote(origin);
 const t0=Date.now();
 const {d1,full,counts}=await sync(remote,file);
 log(full?'full copy':'incremental sync',JSON.stringify(counts),`${Date.now()-t0} ms`);
 const handlers=await loadHandlers();handlers.env.DB=d1;
 const remoteKeys=await remote.get({op:'keys'});
 const today=easternDay();
 const plan=planKeys(remoteKeys,[...baseKeys(today),...weekSlateKeys(today)]);
 const remoteByKey=new Map(remoteKeys.map(r=>[r.key,r]));
 // Until the writes below reach the site, this copy may hold rows the site lacks.
 setState(d1,'sync',{...getState(d1,'sync'),dirty:true});
 d1.recording=true;
 const rendered=[];
 const renderKey=async key=>{try{rendered.push(await render(handlers,key,origin));}catch(e){console.error('Render failed',key,e);}};
 for(const key of plan.render)await renderKey(key);
 // Then the record views today's and this week's boards lead to, so the first visitor of the day does not compute them.
 const boardKeys=new Map([...SPORTS.map(s=>[keyOf(`/api/slate?sport=${s}&date=${today}&days=1`),{sport:s,days:1}]),...['nfl','cfb'].map((s,i)=>[weekSlateKeys(today)[i],{sport:s,days:7}])]);
 const boards=rendered.filter(r=>r.status===200&&boardKeys.has(r.key)).map(r=>({...boardKeys.get(r.key),body:r.body}));
 const renderedKeys=new Set(rendered.map(r=>r.key));
 for(const key of recordKeys(boards,today))if(!renderedKeys.has(key)){renderedKeys.add(key);await renderKey(key);}
 d1.recording=false;
 // Writes first, so the database matches what the pages show.
 const writes=d1.takeWrites();let mismatched=0;
 const byTable={};for(const w of writes){const t=/^\s*(?:INSERT INTO|UPDATE)\s+([a-z_]+)/i.exec(w.sql)?.[1]||'other';byTable[t]=(byTable[t]||0)+1;}
 for(const part of chunks(writes)){
  const {changes}=await remote.post({op:'apply'},JSON.stringify({statements:part.map(w=>({sql:w.sql,params:w.params}))}),{'content-type':'application/json'});
  changes.forEach((c,i)=>{if(c!==part[i].changes)mismatched++;});
 }
 setState(d1,'sync',{...getState(d1,'sync'),dirty:mismatched>0});
 if(mismatched)log(`${mismatched} writes landed differently on the site; next run takes a full copy`);
 let uploaded=0,skipped=0;
 for(const r of rendered){
  if(r.status!==200||r.body.length>MAX_BODY_CHARS){log('not cached',r.key,r.status);continue;}
  const hash=crypto.createHash('sha256').update(JSON.stringify([r.status,r.headers,r.body])).digest('hex');
  const last=d1.sqlite.prepare('SELECT hash FROM _render_uploads WHERE key=?').get(r.key);
  const remoteRow=remoteByKey.get(r.key);
  if(last?.hash===hash&&remoteRow&&Date.now()-Date.parse(remoteRow.rendered_at)<REFRESH_UNCHANGED_MS){skipped++;continue;}
  const stored=GZIP_PREFIX+zlib.gzipSync(Buffer.from(r.body,'utf8'),{level:9}).toString('base64');
  await remote.post({op:'put',key:r.key,status:r.status,renderedAt:r.renderedAt},stored,{'content-type':'text/plain; charset=utf-8','x-render-headers':JSON.stringify(r.headers)});
  d1.sqlite.prepare('INSERT INTO _render_uploads (key,hash,rendered_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET hash=excluded.hash,rendered_at=excluded.rendered_at').run(r.key,hash,r.renderedAt);
  uploaded++;
 }
 for(let i=0;i<plan.drop.length;i+=200)await remote.post({op:'drop'},JSON.stringify({keys:plan.drop.slice(i,i+200)}),{'content-type':'application/json'});
 const {pruned}=await remote.post({op:'prune'});
 d1.close();
 log(`rendered ${rendered.length}/${plan.render.length}, uploaded ${uploaded}, unchanged ${skipped}, writes ${writes.length} ${JSON.stringify(byTable)}, dropped ${plan.drop.length}, pruned parts ${pruned}, ${Date.now()-t0} ms`);
 return {rendered:rendered.length,uploaded,writes:writes.length};
}
if(process.argv[1]===fileURLToPath(import.meta.url))await main();
