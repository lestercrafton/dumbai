/** Runner records in the Site's learning-loop contract (big-vin/site/docs/learning-loop-contract.md).
 * Every document is first queued in an append-only outbox (checkpoint + workflow artifact), then
 * posted to the Cloudflare site's POST /api/playbook when BIG_VIN_PLAYBOOK_POST=1. The ChatGPT Sites
 * host has no such endpoint. Documents queued by an earlier run are replayed as a labeled backfill.
 */
import fs from 'node:fs';
import path from 'node:path';
import {currentPicks} from './shadow-ledger.mjs';
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const LIVE_ID='v1';
/** The site's live id is 'v1'; runner control mirrors are their own frozen rows. */
export const contractVersionId=version=>version;

export function manifestDocument(manifest,{generatedAt=new Date().toISOString()}={}){
 const sports=Object.entries(manifest.bigVin.sports);
 const versions=[
  {id:LIVE_ID,label:'Playbook v1',role:'live',createdAt:'2026-10-19T05:00:00.000Z',frozenAt:'2026-10-19T05:00:00.000Z',tag:manifest.tag,
   modelVersions:[...new Set(sports.map(([,s])=>s.liveModel))],summary:'Live Big Vin formulas per sport, frozen on October 19, 2026. Earlier results are training history only.'},
  ...sports.map(([sport,s])=>({id:s.version,label:`Playbook v1 ${sport.toUpperCase()} runner mirror`,role:'frozen',sports:[sport],parent:LIVE_ID,createdAt:'2026-10-19T05:00:00.000Z',frozenAt:'2026-10-19T05:00:00.000Z',modelVersions:[s.liveModel],
   summary:'The live formula re-applied by the runner at the same capture times and prices as the challengers, so comparisons are like for like.'})),
  ...manifest.challengers.map(c=>({id:c.version,label:`${c.sport.toUpperCase()} ${c.feature}`,role:c.status==='retired'?'retired':'challenger',sports:[c.sport],parent:LIVE_ID,createdAt:new Date(c.registeredAt).toISOString(),idea:c.feature,
   summary:`${c.why} Parameters: ${JSON.stringify(c.parameters)}.`.slice(0,2000)})),
 ];
 return {schema:'big-vin-versions/1',id:`versions-${manifest.playbook}-${manifest.history.length}`,generatedAt,versions};
}
function note(reasoning){
 const adj=(reasoning?.adjustments||[]).map(a=>a.player?`${a.team} ${a.player} out (${a.effectOnHomeMargin>0?'+':''}${a.effectOnHomeMargin})`:a.flags?`weather ${a.flags.join('/')}`:a.move!==undefined?`line moved ${a.move}`:a.input);
 return (adj.length?adj.join('; '):reasoning?.note||(reasoning?.feature?'No adjustment.':'Control mirror.')).slice(0,2000);
}
export function pickDocument(e){
 return {id:e.id,revision:e.revision??null,supersedes:e.supersedes??null,versionId:contractVersionId(e.version),sport:e.sport,gameId:String(e.gameId),weekKey:e.weekKey,startTime:new Date(e.startTime).toISOString(),capturedAt:new Date(e.at).toISOString(),
  home:e.home.name,away:e.away.name,side:e.side,homeSpread:finite(e.market?.homeSpread)?e.market.homeSpread:null,odds:finite(e.odds)?e.odds:null,
  predictedMargin:finite(e.predictedMargin)?Math.round(e.predictedMargin*100)/100:null,stakeUnits:1,provider:e.market?.provider??null,note:note(e.reasoning)};
}
export function resultDocument(g,events){
 const close=events.find(e=>e.type==='close'&&e.gameId===g.gameId);
 return {pickId:g.pickId,status:g.status,homeScore:g.homeScore,awayScore:g.awayScore,gradedAt:new Date(g.at).toISOString(),
  closingHomeSpread:finite(close?.homeSpread)?close.homeSpread:null,closingOdds:null,clv:finite(g.clvPoints)?g.clvPoints:null,sourceUrl:g.sourceUrl??null};
}
/** Documents not yet queued, given the ids already in the outbox. */
export function pendingDocuments(events,queued=new Set()){
 const picks=events.filter(e=>e.type==='pick'&&!queued.has('pick:'+e.id)).map(pickDocument);
 const latestGrade=new Map();for(const e of events)if(e.type==='grade')latestGrade.set(e.pickId,e);
 const results=[...latestGrade.values()].filter(g=>!queued.has('result:'+g.id)).map(g=>({key:'result:'+g.id,doc:resultDocument(g,events)}));
 return {picks,results};
}
export function chunks(list,size=400){const out=[];for(let i=0;i<list.length;i+=size)out.push(list.slice(i,i+size));return out;}

export const PLAYBOOK_URL='https://big-vin.lestercrafton.workers.dev';
export function readQueue(dir){const f=path.join(dir,'queued.json');return fs.existsSync(f)?new Set(JSON.parse(fs.readFileSync(f,'utf8'))):new Set();}
/** Outbox files and the key each document is tracked by. */
export const KINDS=[
 {kind:'versions',file:'versions',key:d=>'versions:'+d.id,body:docs=>docs.map(d=>({kind:'versions',manifest:d}))},
 {kind:'challenger-picks',file:'challenger-picks',key:d=>'pick:'+d.id,size:400},
 {kind:'challenger-results',file:'challenger-results',key:d=>`result:${d.pickId}@${d.gradedAt}`,size:400},
 {kind:'odds-snapshots',file:'odds-snapshots',key:d=>'odds:'+d.id,size:1000},
 {kind:'scoreboard',file:'scoreboard',key:d=>'scoreboard:'+d.id,body:docs=>docs.map(d=>({kind:'scoreboard',scoreboard:d}))},
 {kind:'promotion',file:'promotion',key:d=>'promotion:'+d.id,body:docs=>docs.map(d=>({kind:'promotion',promotion:d}))},
];
/** Append each new document to outbox/<kind>.jsonl and remember it as queued. Returns the keys added. */
export function queue(dir,{manifestDoc,picks=[],results=[],odds=[],scoreboard=null,promotion=null}){
 fs.mkdirSync(dir,{recursive:true});const queued=readQueue(dir);const added=[];
 const add=(file,key,doc)=>{if(queued.has(key))return;fs.appendFileSync(path.join(dir,file+'.jsonl'),JSON.stringify(doc)+'\n');queued.add(key);added.push(key);};
 if(manifestDoc)add('versions','versions:'+manifestDoc.id,manifestDoc);
 for(const p of picks)add('challenger-picks','pick:'+p.id,p);
 for(const r of results)add('challenger-results',r.key,r.doc);
 for(const l of odds)add('odds-snapshots','odds:'+l.id,l);
 if(scoreboard)add('scoreboard','scoreboard:'+scoreboard.id,scoreboard);
 if(promotion)add('promotion','promotion:'+promotion.id,promotion);
 fs.writeFileSync(path.join(dir,'queued.json'),JSON.stringify([...queued]));
 return added;
}
const readLines=f=>fs.existsSync(f)?fs.readFileSync(f,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l)):[];
const readPosted=dir=>{const f=path.join(dir,'posted.json');return fs.existsSync(f)?new Set(JSON.parse(fs.readFileSync(f,'utf8'))):new Set();};

/** GitHub OIDC token whose audience is the playbook site's own origin (as the Cloudflare mirror does). */
let identity=null;
export async function playbookAuthorization(siteUrl,{env=process.env,fetchImpl=globalThis.fetch,now=Date.now}={}){
 if(env.BIG_VIN_PLAYBOOK_TOKEN)return 'Bearer '+env.BIG_VIN_PLAYBOOK_TOKEN;
 const audience=new URL(siteUrl).origin;
 if(identity&&identity.audience===audience&&identity.expires>now()+60000)return identity.header;
 if(!env.ACTIONS_ID_TOKEN_REQUEST_URL||!env.ACTIONS_ID_TOKEN_REQUEST_TOKEN)throw new Error('No GitHub workflow identity (needs id-token: write).');
 const url=new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);if(url.protocol!=='https:')throw new Error('Secure GitHub identity endpoint required.');
 url.searchParams.set('audience',audience);
 const r=await fetchImpl(url,{headers:{Authorization:'Bearer '+env.ACTIONS_ID_TOKEN_REQUEST_TOKEN},signal:AbortSignal.timeout(30000)});
 if(!r.ok)throw new Error('GitHub identity HTTP '+r.status);
 const token=(await r.json())?.value;if(typeof token!=='string'||token.split('.').length!==3)throw new Error('GitHub did not return a signed identity token.');
 const exp=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString()).exp*1000;
 identity={audience,header:'Bearer '+token,expires:exp};return identity.header;
}
export async function post(siteUrl,authorization,body,{fetchImpl=globalThis.fetch}={}){
 const r=await fetchImpl(new URL('/api/playbook',siteUrl).href,{method:'POST',headers:{'Content-Type':'application/json',Authorization:authorization},body:JSON.stringify(body),signal:AbortSignal.timeout(90000)});
 const text=await r.text();if(!r.ok)throw new Error(`POST /api/playbook ${body.kind}: HTTP ${r.status} ${text.slice(0,200)}`);
 try{return JSON.parse(text);}catch{return {};}
}
/** Post every queued document not yet accepted. Keys queued by an earlier run go as a backfill.
 * Stops at the first failure; nothing is marked posted unless the site accepted it. Never throws. */
export async function flush(dir,{siteUrl=PLAYBOOK_URL,fresh=new Set(),ref=null,fetchImpl=globalThis.fetch,authorize=playbookAuthorization,now=Date.now}={}){
 const posted=readPosted(dir);const report={siteUrl,posted:{},responses:{},error:null};
 const save=()=>fs.writeFileSync(path.join(dir,'posted.json'),JSON.stringify([...posted]));
 try{
  let auth=null;
  for(const k of KINDS){
   const docs=readLines(path.join(dir,k.file+'.jsonl')).filter(d=>!posted.has(k.key(d)));if(!docs.length)continue;
   auth??=await authorize(siteUrl,{fetchImpl});
   const tally=report.responses[k.kind]={received:0,inserted:0,backfilled:0,saved:0};
   const send=async(body,keys)=>{const r=await post(siteUrl,auth,body,{fetchImpl});
    for(const f of ['received','inserted','backfilled','saved'])if(typeof r[f]==='number')tally[f]+=r[f];else if(r[f]===true)tally[f]+=1;
    for(const key of keys)posted.add(key);report.posted[k.kind]=(report.posted[k.kind]||0)+keys.length;save();};
   if(k.body){for(const d of docs)await send(k.body([d])[0],[k.key(d)]);continue;}
   const field=k.kind==='challenger-picks'?'picks':k.kind==='challenger-results'?'results':'lines';
   const groups=k.kind==='challenger-picks'?[docs.filter(d=>fresh.has(k.key(d))&&Date.parse(d.startTime)>now()+90000),docs.filter(d=>!(fresh.has(k.key(d))&&Date.parse(d.startTime)>now()+90000))]:[docs];
   for(const [g,group] of groups.entries())for(const c of chunks(group,k.size)){
    const body={kind:k.kind,[field]:c};
    if(k.kind==='challenger-picks'&&g===1)body.backfill={source:'checkpoint-outbox',...(ref?{ref}:{})};
    await send(body,c.map(k.key));
   }
  }
 }catch(e){report.error=e.message;}
 return report;
}
export {currentPicks};
