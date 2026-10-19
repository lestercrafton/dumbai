/** Runner records in the Site's learning-loop contract (big-vin/site/docs/learning-loop-contract.md).
 * POST /api/playbook is not live until the hosting move, so every document is also queued in an
 * append-only outbox (checkpoint + workflow artifact). Posting is opt-in with BIG_VIN_PLAYBOOK_POST=1.
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
 return {id:e.id,versionId:contractVersionId(e.version),sport:e.sport,gameId:String(e.gameId),weekKey:e.weekKey,startTime:new Date(e.startTime).toISOString(),capturedAt:new Date(e.at).toISOString(),
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

export function readQueue(dir){const f=path.join(dir,'queued.json');return fs.existsSync(f)?new Set(JSON.parse(fs.readFileSync(f,'utf8'))):new Set();}
/** Append each new document to outbox/<kind>.jsonl and remember it as queued. */
export function queue(dir,{manifestDoc,picks=[],results=[],scoreboard=null,promotion=null}){
 fs.mkdirSync(dir,{recursive:true});const queued=readQueue(dir);const add=(kind,key,doc)=>{if(queued.has(key))return 0;fs.appendFileSync(path.join(dir,kind+'.jsonl'),JSON.stringify(doc)+'\n');queued.add(key);return 1;};
 let n=0;
 if(manifestDoc)n+=add('versions','versions:'+manifestDoc.id,manifestDoc);
 for(const p of picks)n+=add('challenger-picks','pick:'+p.id,p);
 for(const r of results)n+=add('challenger-results',r.key,r.doc);
 if(scoreboard)n+=add('scoreboard','scoreboard:'+scoreboard.id,scoreboard);
 if(promotion)n+=add('promotion','promotion:'+promotion.id,promotion);
 fs.writeFileSync(path.join(dir,'queued.json'),JSON.stringify([...queued]));
 return n;
}
/** Live posting, only when enabled. Picks are only accepted before kickoff, so post at capture time. */
export async function post(siteUrl,authorization,body,{fetchImpl=globalThis.fetch}={}){
 const r=await fetchImpl(siteUrl+'/api/playbook',{method:'POST',headers:{'Content-Type':'application/json',Authorization:authorization},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
 const text=await r.text();if(!r.ok)throw new Error(`POST /api/playbook ${body.kind}: HTTP ${r.status} ${text.slice(0,200)}`);
 try{return JSON.parse(text);}catch{return {};}
}
export {currentPicks};
