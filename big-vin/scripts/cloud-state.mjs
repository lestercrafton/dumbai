import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath,pathToFileURL} from 'node:url';

const checkout=fileURLToPath(new URL('..',import.meta.url));
const defaultRoot=()=>path.join(os.homedir(),'.local/share/big-vin');
const defaultSite=()=>process.env.BIG_VIN_SITE_URL||'https://big-vin-grind-to-win.sunlightisfree.chatgpt.site';
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const dayAt=(time,zone='America/New_York')=>new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(time);
const entryKeys=['id','sport','weekKey','kind','modelVersion','title','learned','decision','priors','evidence','nextTest'];
export const HISTORY_FLOORS=Object.freeze({games:7243,seasons:Object.freeze({'2024':2472,'2025':2477,'2026':2294})});

function write(file,value){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const tmp=file+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value,null,2),{mode:0o600});fs.renameSync(tmp,file);}
function directories(root){return fs.existsSync(root)?fs.readdirSync(root,{withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>d.name).sort():[];}
function seedTree(source,target){
 if(!fs.existsSync(source))return;
 fs.mkdirSync(target,{recursive:true,mode:0o700});
 for(const item of fs.readdirSync(source,{withFileTypes:true})){
  if(item.isDirectory())seedTree(path.join(source,item.name),path.join(target,item.name));
  else if(item.isFile()&&item.name.endsWith('.json')&&!fs.existsSync(path.join(target,item.name)))fs.copyFileSync(path.join(source,item.name),path.join(target,item.name));
 }
}

/** Relocate only local artifact paths. Frozen journal entries are opaque. */
export function relocatePaths(value,stateRoot){
 if(Array.isArray(value))return value.map(v=>relocatePaths(v,stateRoot));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,key==='entry'?v:relocatePaths(v,stateRoot)]));
 if(typeof value!=='string'||!value.startsWith('/'))return value;
 const marker='/.local/share/big-vin',offset=value.indexOf(marker);
 if(offset<0||![undefined,'/'].includes(value[offset+marker.length]))return value;
 const suffix=value.slice(offset+marker.length).replace(/^\//,'');
 if(suffix.split('/').includes('..'))throw new Error('Checkpoint artifact path contains traversal.');
 return path.join(stateRoot,suffix);
}

/** Call only before this fresh runner starts any collector; Actions owns the
 * cross-machine concurrency lease. Never remove another running process's lock.
 */
export function normalizeRestoredState({stateRoot=defaultRoot()}={}){
 const root=path.join(stateRoot,'daily-experiment');let rewritten=0;
 for(const file of ['run-owner.json','run.lock'])fs.rmSync(path.join(root,file),{force:true});
 for(const date of directories(root))for(const name of ['state.json','report.json']){
  const file=path.join(root,date,name);if(!fs.existsSync(file))continue;
  const before=read(file),after=relocatePaths(before,stateRoot);
  if(JSON.stringify(before)!==JSON.stringify(after)){write(file,after);rewritten++;}
 }
 return {rewritten};
}

async function publicJson(siteUrl,route,fetchImpl=fetch){
 const response=await fetchImpl(siteUrl.replace(/\/$/,'')+route,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw new Error(`Public state request failed (${response.status}); publishing remains blocked.`);
 return response.json();
}

export async function recoverTodayJournal({stateRoot=defaultRoot(),siteUrl=defaultSite(),fetchImpl=fetch,now=new Date()}={}){
 const runDate=dayAt(now,'America/Chicago'),today=dayAt(now),file=path.join(stateRoot,'daily-experiment',runDate,'state.json');
 if(fs.existsSync(file))return {recovered:false,reason:'checkpoint-exists'};
 const data=await publicJson(siteUrl,'/api/learning',fetchImpl);
 if(!Array.isArray(data.entries))throw new Error('Public learning history is unavailable; cannot safely recover the daily journal.');
 const original=data.entries.find(entry=>entry.id===`daily-all-sports-v1-${runDate}`);
 if(!original)return {recovered:false,reason:'no-published-entry'};
 if(entryKeys.some(key=>original[key]===undefined))throw new Error('Published daily journal is incomplete.');
 const entry=Object.fromEntries(entryKeys.map(key=>[key,original[key]]));
 write(file,{experiment:'daily-all-sports-v1',runDate,today,gameDate:new Date(Date.parse(today+'T12:00:00Z')-86400000).toISOString().slice(0,10),startedAt:now.toISOString(),collections:{},attempts:0,status:'partial',entry,recoveredFromPublicJournal:true});
 return {recovered:true,id:entry.id};
}

async function inspectGames(file){
 const stream=fs.createReadStream(file),hash=createHash('sha256'),lines=readline.createInterface({input:stream,crlfDelay:Infinity});
 stream.on('data',chunk=>hash.update(chunk));
 let games=0,pitcherGames=0,dateMin=null,dateMax=null;const seasons={},ids=new Set(),teams=new Map();
 try{
  for await(const line of lines){
   if(!line.trim())continue;const row=JSON.parse(line);
   if(!Number.isSafeInteger(row.gamePk)||ids.has(row.gamePk)||!Number.isSafeInteger(row.season)||!/^\d{4}-\d{2}-\d{2}$/.test(row.date||'')||!Number.isFinite(Date.parse(row.date)))throw new Error('Invalid or duplicate normalized MLB game.');
   if(['home','away'].some(side=>['batting','pitching','fielding'].some(group=>row[`${side}_${group}_present`]!==true)))throw new Error('Normalized MLB game is missing required team statistics.');
   ids.add(row.gamePk);teams.set(row.gamePk,[row.homeId,row.awayId]);games++;seasons[row.season]=(seasons[row.season]||0)+1;
   if(row.home_pitcher_appearances_complete===true&&row.away_pitcher_appearances_complete===true)pitcherGames++;
   dateMin=dateMin===null||row.date<dateMin?row.date:dateMin;dateMax=dateMax===null||row.date>dateMax?row.date:dateMax;
  }
 }finally{lines.close();stream.destroy();}
 return {games,pitcherGames,seasons,dateMin,dateMax,sha256:hash.digest('hex'),teams};
}

async function inspectPitchers(file,teams){
 const stream=fs.createReadStream(file),lines=readline.createInterface({input:stream,crlfDelay:Infinity}),seen=new Set(),covered=new Map();let appearances=0;
 try{for await(const line of lines){
  if(!line.trim())continue;const row=JSON.parse(line),key=`${row.gamePk}:${row.teamId}:${row.playerId}`;
  if(![row.gamePk,row.teamId,row.playerId].every(Number.isSafeInteger)||seen.has(key))throw new Error('Invalid or duplicate pitcher appearance.');
  seen.add(key);appearances++;if(!covered.has(row.gamePk))covered.set(row.gamePk,new Set());covered.get(row.gamePk).add(row.teamId);
 }}finally{lines.close();stream.destroy();}
 if([...teams].some(([id,sides])=>sides.some(team=>!covered.get(id)?.has(team))))throw new Error('Pitcher appearance history is missing a normalized game or team.');
 return appearances;
}

/** Fail closed before a public baseball status update. Checks actual normalized
 * history, not just a potentially stale or partial manifest's claimed count.
 */
export async function verifyBaseball({dataDir=process.env.BIG_VIN_MLB_DATA_DIR||path.join(defaultRoot(),'baseball-stats'),siteUrl=defaultSite(),fetchImpl=fetch,publishedStatus,floors=HISTORY_FLOORS}={}){
 const published=publishedStatus===undefined?(await publicJson(siteUrl,'/api/baseball-data',fetchImpl)).collection:publishedStatus;
 if(published!==null&&(!published||!Number.isSafeInteger(published.games)||published.games<0||!Array.isArray(published.seasons)||!/^\d{4}-\d{2}-\d{2}$/.test(published.completedThrough||'')))throw new Error('Public baseball coverage is unavailable; publishing remains blocked.');
 const manifest=read(path.join(dataDir,'latest-manifest.json'));
 if(manifest.validation?.status!=='pass')throw new Error('Baseball history validation did not pass.');
 const actual=await inspectGames(path.join(dataDir,'games.jsonl'));
 const appearances=await inspectPitchers(path.join(dataDir,'pitcher-appearances.jsonl'),actual.teams);
 const summary=manifest.summary;
 if(actual.sha256!==manifest.outputs?.['games.jsonl']?.sha256||actual.games!==summary?.cumulativeGames||actual.games!==manifest.validation.games||actual.pitcherGames!==summary.pitcherGames||actual.dateMin!==summary.dateMin||actual.dateMax!==summary.dateMax||JSON.stringify(actual.seasons)!==JSON.stringify(summary.seasons))throw new Error('Baseball history disagrees with its validated manifest.');
 const minimum=Math.max(floors.games,published?.games||0);
 if(actual.games<minimum||actual.pitcherGames<minimum||Object.entries(floors.seasons).some(([season,count])=>(actual.seasons[season]||0)<count))throw new Error(`Baseball history is incomplete: ${actual.games} games / ${actual.pitcherGames} pitcher games; at least ${minimum} verified games are required.`);
 if(appearances!==manifest.pitcherAudit?.pitcherAppearances||appearances<(published?.pitcherGames||0))throw new Error('Pitcher appearance history would regress its manifest or published coverage.');
 if(published&&(actual.dateMax<published.completedThrough||published.seasons.some(season=>!actual.seasons[season])))throw new Error('Baseball history would regress published date or season coverage.');
 return {games:actual.games,pitcherGames:actual.pitcherGames,pitcherAppearances:appearances,seasons:actual.seasons,completedThrough:actual.dateMax,minimumGames:minimum};
}

export async function ensureBaseballHistory({dataDir=process.env.BIG_VIN_MLB_DATA_DIR||path.join(defaultRoot(),'baseball-stats'),siteUrl=defaultSite(),fetchImpl=fetch,floors=HISTORY_FLOORS,runHistory,now=new Date()}={}){
 // Capture the remote floor once. Network failure must not be mistaken for a
 // missing local history and trigger an expensive download that cannot verify.
 const publishedStatus=(await publicJson(siteUrl,'/api/baseball-data',fetchImpl)).collection;
 try{return {...await verifyBaseball({dataDir,publishedStatus,floors}),bootstrapped:false};}catch(error){
  if(publishedStatus!==null&&(!publishedStatus||!Number.isSafeInteger(publishedStatus.games)))throw error;
 }
 const args=[path.join(checkout,'scripts/baseball/collect.py'),'--mode','history','--seasons','2024,2025,2026','--as-of',dayAt(now),'--pitchers','--skip-current','--data-dir',dataDir];
 if(runHistory)await runHistory(args);
 else await promisify(execFile)(process.env.BIG_VIN_PYTHON||'python3',args,{maxBuffer:4*1024*1024,timeout:55*60*1000});
 return {...await verifyBaseball({dataDir,publishedStatus,floors}),bootstrapped:true};
}

/** Scan ALL archives, including the prior compact registry. The collector's
 * last-45 directory optimization is inappropriate for durable checkpoints.
 * Only original schedule group provenance may establish FBS/FCS membership.
 */
export function compactCollegeRegistry(collectionRoot){
 const entries=new Map();
 for(const directory of directories(collectionRoot))for(const name of fs.readdirSync(path.join(collectionRoot,directory)).filter(name=>name.startsWith('cfb-')&&name.endsWith('.json'))){
  const board=read(path.join(collectionRoot,directory,name));
  let direct,archived;try{direct=new URL(board.sourceUrl||board.url).searchParams.get('groups');archived=board.scheduleSourceUrl?new URL(board.scheduleSourceUrl).searchParams.get('groups'):null;}catch{continue;}
  const group=direct||(board.sourceGroup===archived?archived:null);if(!['80','81'].includes(group))continue;
  for(const event of board.payload?.events||[]){
   const competition=event.competitions?.[0],competitors=competition?.competitors;
   if(!/^\d+$/.test(String(event.id))||!Number.isFinite(Date.parse(event.date))||competitors?.length!==2||!['home','away'].every(side=>competitors.some(c=>c.homeAway===side&&c.team?.id)))continue;
   const prior=entries.get(String(event.id));if(prior?.sourceGroup==='80'&&group==='81')continue;
   const observedAt=board.scheduleObservedAt||board.observedAt;
   if(!Number.isFinite(Date.parse(observedAt)))continue;
   if(prior?.sourceGroup===group&&Date.parse(prior.observedAt)>Date.parse(observedAt))continue;
   const sourceUrl=board.scheduleSourceUrl||board.sourceUrl||board.url;
   entries.set(String(event.id),{sourceUrl,observedAt,sourceGroup:group,scheduleSourceUrl:sourceUrl,scheduleObservedAt:observedAt,archiveOnly:true,payload:{events:[{id:String(event.id),date:event.date,competitions:[{competitors:competitors.map(c=>({homeAway:c.homeAway,team:{id:String(c.team.id)}}))}]}]}});
  }
 }
 return [...entries.values()].sort((a,b)=>a.payload.events[0].id.localeCompare(b.payload.events[0].id));
}

export function packCheckpoint({stateRoot=defaultRoot(),output}={}){
 if(!output)throw new Error('An empty checkpoint output directory is required.');
 if(fs.existsSync(output)&&fs.readdirSync(output).length)throw new Error('Checkpoint output directory must be empty.');
 fs.mkdirSync(output,{recursive:true,mode:0o700});let files=0;
 for(const subtree of ['daily-experiment','collections'])for(const directory of directories(path.join(stateRoot,subtree)))for(const name of subtree==='daily-experiment'?['state.json','report.json']:['report.json']){
  const source=path.join(stateRoot,subtree,directory,name);if(!fs.existsSync(source)||!fs.lstatSync(source).isFile())continue;
  const destination=path.join(output,subtree,directory,name);fs.mkdirSync(path.dirname(destination),{recursive:true,mode:0o700});fs.copyFileSync(source,destination);files++;
 }
 const entries=compactCollegeRegistry(path.join(stateRoot,'collections'));
 for(const board of entries){write(path.join(output,'collections/zz-cfb-registry',`cfb-${board.payload.events[0].id}.json`),board);files++;}
 return {files,collegeEvents:entries.length,output};
}

export async function prepareCloudState({stateRoot=defaultRoot(),bootstrapDir=path.join(checkout,'bootstrap'),siteUrl=defaultSite(),fetchImpl=fetch,skipHistory=false,historyOptions={}}={}){
 seedTree(path.join(bootstrapDir,'daily-experiment'),path.join(stateRoot,'daily-experiment'));
 seedTree(path.join(bootstrapDir,'cfb-archive'),path.join(stateRoot,'collections/zz-cfb-registry'));
 const normalized=normalizeRestoredState({stateRoot});
 const journal=await recoverTodayJournal({stateRoot,siteUrl,fetchImpl});
 const baseball=skipHistory?{skipped:true}:await ensureBaseballHistory({...historyOptions,dataDir:process.env.BIG_VIN_MLB_DATA_DIR||path.join(stateRoot,'baseball-stats'),siteUrl,fetchImpl});
 return {normalized,journal,baseball};
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 try{
  const command=process.argv[2]||'prepare';let result;
  if(command==='prepare')result=await prepareCloudState({skipHistory:process.argv.includes('--skip-history')});
  else if(command==='verify-baseball')result=await verifyBaseball();
  else if(command==='pack'){const index=process.argv.indexOf('--output');result=packCheckpoint({output:index>=0?process.argv[index+1]:undefined});}
  else throw new Error('Use prepare, verify-baseball, or pack --output <empty-directory>.');
  console.log(JSON.stringify(result));
 }catch(error){console.error(error.message);process.exitCode=1;}
}
