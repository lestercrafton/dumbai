import {collectorConfig,collectorAuthorization} from '../lib/collector-access.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {EXPERIMENT_ID,EXPERIMENT_SPORTS,dayAt,previousDay,summarizeExperimentSport,dailyLearningEntry} from '../lib/daily-experiment.mjs';

const checkout=fileURLToPath(new URL('..',import.meta.url));
const defaultRoot=path.join(os.homedir(),'.local/share/big-vin/daily-experiment');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
function atomicWrite(file,value){const tmp=file+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value,null,2),{mode:0o600});fs.renameSync(tmp,file);}
function alive(pid){if(!Number.isSafeInteger(pid)||pid<=0)return false;try{process.kill(pid,0);return true;}catch(e){return e.code==='EPERM';}}

// One process owns the whole daily experiment, including child collectors. A
// second scheduler wake may resume failures but cannot overlap a live process.
async function claimLock(root){
 // The inode is never renamed/unlinked: flock serializes stale-owner recovery,
 // including two wake-ups arriving immediately after a crashed process.
 const guard=spawn(process.env.BIG_VIN_PYTHON||'python3',[path.join(checkout,'scripts/hold-experiment-lock.py'),path.join(root,'run.lock')],{stdio:['pipe','pipe','pipe']});
 let releasing=false;const controller=new AbortController();
 const closed=new Promise(resolve=>guard.once('close',()=>{if(!releasing)controller.abort();resolve();}));
 const ready=await new Promise((resolve,reject)=>{let output='';guard.once('error',reject);guard.stdout.on('data',b=>{output+=b;if(output.includes('\n'))resolve(output.trim());});guard.once('close',()=>{if(!output)reject(new Error('The experiment lock could not be acquired.'));});});
 const close=async()=>{releasing=true;guard.stdin.end();await closed;};
 if(ready==='BUSY'){await close();return null;}
 const file=path.join(root,'run-owner.json');
 try{
  if(fs.existsSync(file)){const old=read(file);if(alive(old.pid)||alive(old.childPid)){await close();return null;}}
  const value={id:randomUUID(),pid:process.pid,childPid:null,claimedAt:new Date().toISOString()};atomicWrite(file,value);
  return {file,value,close,signal:controller.signal};
 }catch(e){await close();throw e;}
}

function defaultDependencies({config,runDir,onChild,signal}){
 const site=process.env.BIG_VIN_SITE_URL||config.url;
 const redact=text=>config.token?String(text).split(config.token).join('[redacted]'):String(text);
 async function api(route,body){
  const r=await fetch(site+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(body?{Authorization:await collectorAuthorization(config)}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.any([signal,AbortSignal.timeout(120000)])});
  const value=await r.json();if(!r.ok)throw new Error(`Site request failed (${r.status}).`);return value;
 }
 async function child(script,args,env,name,timeout=900000){
  return new Promise((resolve,reject)=>{
   const p=spawn(process.execPath,[path.join(checkout,'scripts',script),...args],{cwd:checkout,env:{...process.env,...env},stdio:['ignore','pipe','pipe'],signal});
   onChild(p.pid);let output='',errors='',timedOut=false,killTimer,done=false;
   const limit=2*1024*1024;
   p.stdout.on('data',b=>{output=(output+b).slice(-limit)});p.stderr.on('data',b=>{errors=(errors+b).slice(-limit)});
   const timer=setTimeout(()=>{timedOut=true;p.kill('SIGTERM');killTimer=setTimeout(()=>p.kill('SIGKILL'),5000);},timeout);
   p.on('error',e=>{errors+='\n'+e.message;});
   p.on('close',code=>{if(done)return;done=true;clearTimeout(timer);clearTimeout(killTimer);onChild(null);fs.writeFileSync(path.join(runDir,name+'.log'),redact(output+'\n'+errors),{mode:0o600});resolve({code:timedOut?124:code,output:redact(output)});});
  });
 }
 return {
  async collectSport(sport,artifact){
   const r=await child('collect-results.mjs',[`--sport=${sport}`,'--results-only'],{BIG_VIN_COLLECTION_DIR:artifact},'collect-'+sport);
   const file=path.join(artifact,'report.json');if(!fs.existsSync(file))throw new Error(`${sport}: collector did not produce an audit report (exit ${r.code}).`);
   const report=read(file);if(r.code!==0||!collectionSucceeded(report,sport))throw new Error(`${sport}: collection has unresolved failures; saved partial observations are preserved.`);
   return report;
  },
  async collectBaseball(){
   const r=await child('collect-mlb-stats.mjs',[],{},'baseball-research',660000);
   if(r.code!==0)throw new Error('Baseball research refresh failed; forecast collection is preserved.');
   const value=JSON.parse(r.output.trim().split('\n').at(-1));if(value.completedThrough===undefined)throw new Error('Missing baseball research summary.');return value;
  },
  async readSport(sport){
   const first=await api(`/api/results?sport=${sport}&cohort=live`);
   const remaining=await Promise.all((first.versions||[]).filter(v=>v.id!==first.version).map(async v=>{const data=await api(`/api/results?sport=${sport}&cohort=live&version=${encodeURIComponent(v.id)}`);if(data.version!==v.id)throw new Error('Results returned a different formula version.');return data;}));
   return [first,...remaining];
  },
  async readLearning(){return (await api('/api/learning')).entries;},
  async publish(entry){return api('/api/learning',entry);},
 };
}

export function collectionSucceeded(report,sport){return report?.finished===true&&Array.isArray(report.failures)&&!report.failures.length&&report.reports?.some(r=>r.sport===sport);}

/** Collect, score and journal every supported sport once per Chicago date.
 * Dependencies are injectable for tests; live runs use the existing free-source
 * collector and its protected configuration. No wagers or model edits occur.
 */
export async function runDailyExperiment({root=defaultRoot,now=new Date(),dependencies,configFile=path.join(os.homedir(),'.config/big-vin/collector.json')}={}){
 fs.mkdirSync(root,{recursive:true,mode:0o700});
 const lock=await claimLock(root);if(!lock)return {status:'running',message:'An experiment process or its collector is already running.'};
 let state,runDir,stateFile;
 try{
  const runDate=dayAt(now,'America/Chicago'),today=dayAt(now),gameDate=previousDay(today);
  runDir=path.join(root,runDate);fs.mkdirSync(runDir,{recursive:true,mode:0o700});stateFile=path.join(runDir,'state.json');
  state=fs.existsSync(stateFile)?read(stateFile):{experiment:EXPERIMENT_ID,runDate,today,gameDate,startedAt:new Date(now).toISOString(),collections:{},attempts:0};
  if(state.status==='completed')return {status:'already-completed',runDate,artifact:path.join(runDir,'report.json'),learningId:state.entry.id};
  state.attempts++;state.status='running';state.errors=[];atomicWrite(stateFile,state);
  const onChild=pid=>{if(!lock.signal.aborted&&read(lock.file).id===lock.value.id){lock.value.childPid=pid;atomicWrite(lock.file,lock.value);}};
  const deps=dependencies||defaultDependencies({config:collectorConfig(configFile),runDir,onChild,signal:lock.signal});
  // Collection checkpoints are per sport: a failed NBA feed never prevents MLB
  // and WNBA from running, nor causes completed sports to be retried later.
  for(const sport of EXPERIMENT_SPORTS){
   lock.signal.throwIfAborted();
   if(state.collections[sport]?.complete)continue;
   const priorFile=state.collections[sport]?.artifact&&path.join(state.collections[sport].artifact,'report.json');
   if(priorFile&&fs.existsSync(priorFile)){
    const report=read(priorFile);if(collectionSucceeded(report,sport)){state.collections[sport]={...state.collections[sport],complete:true,report};atomicWrite(stateFile,state);continue;}
   }
   const artifact=path.join(os.homedir(),'.local/share/big-vin/collections',new Date().toISOString().replaceAll(':','-')+'-'+sport+'-daily');
   state.collections[sport]={artifact,complete:false};atomicWrite(stateFile,state);
   try{const report=await deps.collectSport(sport,artifact);state.collections[sport]={artifact,complete:true,report};}
   catch(e){state.errors.push(String(e.message).slice(0,500));}
   atomicWrite(stateFile,state);
  }
  // Keep each available results snapshot even if another source has failed.
  if(!state.entry){
   state.snapshots||={};
   for(const sport of EXPERIMENT_SPORTS){
    if(state.snapshots[sport]?.collectionArtifact===state.collections[sport].artifact&&state.collections[sport].complete)continue;
    try{const data=await deps.readSport(sport);state.snapshots[sport]={observedAt:new Date().toISOString(),collectionArtifact:state.collections[sport].artifact,data};}
    catch(e){state.errors.push(`${sport} results: ${String(e.message).slice(0,450)}`);}
    atomicWrite(stateFile,state);
   }
  }
  const coreErrors=[...state.errors];
  if(!state.baseball){try{state.baseball=await deps.collectBaseball();state.baseballError=null;}catch(e){state.baseballError=String(e.message).slice(0,500);}atomicWrite(stateFile,state);}
  if(coreErrors.length){state.status='partial';state.errors=[...coreErrors,...(state.baseballError?[state.baseballError]:[])];atomicWrite(stateFile,state);return {status:'partial',runDate,artifact:stateFile,errors:state.errors};}
  // Freeze the full report AND exact journal body before any publication.
  // A timeout after POST can then be retried without changing its daily ID/body.
  if(!state.entry){
   const sports=[];
   for(const sport of EXPERIMENT_SPORTS){const snapshot=state.snapshots[sport];sports.push({...summarizeExperimentSport(sport,snapshot.data,state.collections[sport].report,state.gameDate,state.today),observedAt:snapshot.observedAt});}
   const report={experiment:EXPERIMENT_ID,runDate:state.runDate,gameDate:state.gameDate,startedAt:state.startedAt,finishedAt:new Date().toISOString(),sports,baseball:state.baseball||{status:'unavailable',error:state.baseballError},collectionArtifacts:Object.fromEntries(EXPERIMENT_SPORTS.map(s=>[s,state.collections[s].artifact]))};
   state.entry=dailyLearningEntry(report);atomicWrite(path.join(runDir,'report.json'),report);atomicWrite(stateFile,state);
  }
  let existing=(await deps.readLearning()).find(e=>e.id===state.entry.id);
  if(!existing){const response=await deps.publish(state.entry);if(response?.inserted!==true){existing=(await deps.readLearning()).find(e=>e.id===state.entry.id);if(!existing)throw new Error('Daily journal publication was not verified.');}}
  if(existing){
   const comparable=e=>JSON.stringify(Object.fromEntries(Object.keys(state.entry).sort().map(k=>[k,e[k]])));
   if(comparable(existing)!==comparable(state.entry))throw new Error('The daily journal ID already has different content; preserve it and publish a separate correction after review.');
  }
  if(state.baseballError){state.status='partial';state.errors=[state.baseballError];atomicWrite(stateFile,state);return {status:'partial',runDate,artifact:path.join(runDir,'report.json'),learningId:state.entry.id,errors:state.errors};}
  state.status='completed';state.completedAt=new Date().toISOString();atomicWrite(stateFile,state);
  return {status:'completed',runDate:state.runDate,sports:EXPERIMENT_SPORTS.length,artifact:path.join(runDir,'report.json'),learningId:state.entry.id};
 }catch(e){
  if(state&&stateFile){state.status='partial';state.errors=[String(e.message).slice(0,500)];atomicWrite(stateFile,state);}
  return {status:'partial',artifact:stateFile,errors:[String(e.message).slice(0,500)]};
 }finally{try{if(read(lock.file).id===lock.value.id)fs.unlinkSync(lock.file);}catch(e){if(e.code!=='ENOENT')throw e;}finally{await lock.close();}}
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const result=await runDailyExperiment();console.log(JSON.stringify(result));if(result.status==='partial')process.exitCode=1;
}
