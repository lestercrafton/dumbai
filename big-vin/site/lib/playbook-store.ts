import {db} from './db';
import {readForecastRecords} from './result-store';
import {activeModels} from './model-versions';
import {validateManifest,validateChallengerPick,validateChallengerResult,validateScoreboard,validatePromotion,challengerBoard,PLAYBOOK_V1} from './playbook.mjs';
const parse=(rows:{payload:string}[])=>rows.map(r=>JSON.parse(r.payload));

/** Append-only writes from the authenticated runner. Existing pick and price rows are never changed. */
export async function savePlaybookDocument(v:any,now=Date.now()){
 const at=new Date(now).toISOString();
 if(v?.kind==='versions'){const m=validateManifest(v.manifest);const r=await db().prepare('INSERT INTO playbook_manifests (id,published_at,generated_at,payload) VALUES (?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(m.id,at,m.generatedAt,JSON.stringify(m)).run();return {kind:'versions',inserted:r.meta.changes>0,id:m.id};}
 if(v?.kind==='challenger-picks'){
  if(!Array.isArray(v.picks)||!v.picks.length||v.picks.length>400)throw new Error('Supply 1–400 challenger picks.');
  const picks=v.picks.map((p:any)=>validateChallengerPick(p,now));
  let inserted=0;
  for(let i=0;i<picks.length;i+=40){const out=await db().batch(picks.slice(i,i+40).map((p:any)=>db().prepare("INSERT INTO challenger_picks (id,version_id,sport,game_id,week_key,start_time,captured_at,published_at,payload) SELECT ?,?,?,?,?,?,?,?,? WHERE julianday('now')<julianday(?) ON CONFLICT(id) DO NOTHING").bind(p.id,p.versionId,p.sport,String(p.gameId),p.weekKey,p.startTime,p.capturedAt,at,JSON.stringify(p),p.startTime)));inserted+=out.reduce((s,r)=>s+(r.meta.changes??0),0);}
  return {kind:'challenger-picks',received:picks.length,inserted};
 }
 if(v?.kind==='challenger-results'){
  if(!Array.isArray(v.results)||!v.results.length||v.results.length>400)throw new Error('Supply 1–400 challenger results.');
  const results=v.results.map(validateChallengerResult);
  let saved=0;
  // Results live in their own table, so a corrected final never touches the saved pick. Newer grades win.
  for(let i=0;i<results.length;i+=40){const out=await db().batch(results.slice(i,i+40).map((r:any)=>db().prepare("INSERT INTO challenger_results (pick_id,graded_at,payload) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM challenger_picks WHERE id=?) ON CONFLICT(pick_id) DO UPDATE SET graded_at=excluded.graded_at,payload=excluded.payload WHERE excluded.graded_at>challenger_results.graded_at").bind(r.pickId,r.gradedAt,JSON.stringify(r),r.pickId)));saved+=out.reduce((s,r)=>s+(r.meta.changes??0),0);}
  return {kind:'challenger-results',received:results.length,saved};
 }
 if(v?.kind==='scoreboard'){const s=validateScoreboard(v.scoreboard);const r=await db().prepare('INSERT INTO scoreboards (id,week_key,published_for,published_at,payload) VALUES (?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(s.id,s.weekKey,s.publishedFor,at,JSON.stringify(s)).run();return {kind:'scoreboard',inserted:r.meta.changes>0,id:s.id};}
 if(v?.kind==='promotion'){const p=validatePromotion(v.promotion);const r=await db().prepare('INSERT INTO promotions (id,sport,effective_at,published_at,payload) VALUES (?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(p.id,p.sport,p.effectiveAt,at,JSON.stringify({...p,publishedAt:at})).run();return {kind:'promotion',inserted:r.meta.changes>0,id:p.id};}
 throw new Error('Choose kind versions, challenger-picks, challenger-results, scoreboard or promotion.');
}
export async function latestManifest(){
 const row=await db().prepare('SELECT payload FROM playbook_manifests ORDER BY generated_at DESC, published_at DESC LIMIT 1').first<{payload:string}>();
 return row?JSON.parse(row.payload):null;
}
export async function readPromotions(){return parse((await db().prepare('SELECT payload FROM promotions ORDER BY effective_at ASC').all<{payload:string}>()).results);}
export async function readScoreboards(){return parse((await db().prepare('SELECT payload FROM scoreboards ORDER BY published_for DESC, published_at DESC LIMIT 200').all<{payload:string}>()).results);}
export async function readVersions(){return {playbook:PLAYBOOK_V1,manifest:await latestManifest(),promotions:await readPromotions()};}
export async function readChallengers(){
 const picks=parse((await db().prepare('SELECT payload FROM challenger_picks ORDER BY week_key DESC, start_time ASC LIMIT 5000').all<{payload:string}>()).results);
 const results=parse((await db().prepare('SELECT payload FROM challenger_results LIMIT 5000').all<{payload:string}>()).results);
 const [manifest,promotions]=await Promise.all([latestManifest(),readPromotions()]);
 const sports=[...new Set(picks.map((p:any)=>p.sport))] as string[];
 const liveForecasts:any[]=[];
 for(const sport of sports){const live=activeModels[sport]?.id;for(const f of await readForecastRecords(sport))if(f.cohort==='live'&&(!live||f.modelVersion===live))liveForecasts.push(f);}
 return {playbook:PLAYBOOK_V1,manifest,promotions,weeks:challengerBoard({picks,results,manifest,liveForecasts,promotions})};
}
