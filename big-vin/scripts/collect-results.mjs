import {collectorConfig,collectorAuthorization} from '../lib/collector-access.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {SPORT_PATHS} from '../lib/feeds/adapter.mjs';
import {collectSourceRange,boardBatches,rangeDates} from '../lib/collector-sources.mjs';
import {knownCollegeEvents,recoverCollegeEvents} from '../lib/collector-summary.mjs';
const exec=promisify(execFile);
const config=collectorConfig();
const site=process.env.BIG_VIN_SITE_URL||config.url;
const startedAt=Date.now();
const date=n=>new Date(startedAt+n*86400000).toLocaleDateString('en-CA',{timeZone:'America/New_York'});
const requested=process.argv.find(a=>a.startsWith('--sport='))?.slice(8);
const sports=requested?[requested]:Object.keys(SPORT_PATHS);
if(sports.some(sport=>!Object.hasOwn(SPORT_PATHS,sport)))throw new Error('Unsupported sport.');
const root=path.join(os.homedir(),'.local/share/big-vin/collections');
const outputDir=process.env.BIG_VIN_COLLECTION_DIR||path.join(root,new Date().toISOString().replaceAll(':','-'));
fs.mkdirSync(outputDir,{recursive:true,mode:0o700});
async function post(body){const r=await fetch(site+'/api/collector',{method:'POST',headers:{'Content-Type':'application/json',Authorization:await collectorAuthorization(config)},body:JSON.stringify(body),signal:AbortSignal.timeout(120000)});const text=await r.text();let value;try{value=JSON.parse(text)}catch{throw new Error(`Site response ${r.status} was not JSON.`)}if(!r.ok)throw new Error(value.error+': '+(value.detail||r.status));return value;}
async function read(url){const {stdout}=await exec('curl',['--fail','--silent','--show-error','--max-time','30','--retry','1',url],{maxBuffer:32*1024*1024});return JSON.parse(stdout);}
const reports=[],failures=[],sourceAttempts=[],recoveries=[];let baseballStats=null,finished=false;
const initialization=await post({action:'initialize'});
function saveReport(){const file=path.join(outputDir,'report.json');fs.writeFileSync(file+'.tmp',JSON.stringify({finished,completedAt:new Date().toISOString(),initialization,reports,failures,sourceAttempts,recoveries,baseballStats},null,2),{mode:0o600});fs.renameSync(file+'.tmp',file);}
for(const sport of sports){
 const archive=board=>{const url=new URL(board.sourceUrl);const suffix=url.searchParams.get('event')||url.searchParams.get('groups')||'all';fs.writeFileSync(path.join(outputDir,`${sport}-${board.date}-${board.endDate||board.date}-${suffix}.json`),JSON.stringify({url:board.sourceUrl,...board}),{mode:0o600});};
 // Finish historical training/grades before capturing any new future forecasts.
 for(const historicalOnly of [true,false]){try{
  const start=historicalOnly?date(sport==='cbb'?-7:-21):date(0),end=historicalOnly?date(-1):date(sport==='cbb'?0:6);
  const ranges=sport==='cbb'?rangeDates(start,end).map(date=>({date})):[{date:start,endDate:end}];
  const boards=[];
  for(const range of ranges){
   const collected=await collectSourceRange(sport,range,read,archive);boards.push(...collected.boards);
   sourceAttempts.push(...collected.failures.map(f=>({sport,...f})));
   recoveries.push(...collected.warnings.map(w=>({sport,warning:w})));
   if(collected.missing.length)failures.push({sport,historicalOnly,missing:collected.missing});
  }
  if(sport==='cfb'){
   const known=knownCollegeEvents(root,start,end);
   const recovered=await recoverCollegeEvents(boards,known,read,archive);boards.push(...recovered.boards);
   recoveries.push({sport,historicalOnly,knownGames:recovered.knownGames,summaryRequests:recovered.requested,summaryRecovered:recovered.boards.length});
   failures.push(...recovered.failures.map(f=>({sport,historicalOnly,...f})));
  }
  for(const batch of boardBatches(boards)){
   const report=await post({sport,historicalOnly,boards:batch.map(({rawSummary,...b})=>b)});reports.push(report);saveReport();
   console.log(JSON.stringify({sport,historicalOnly,inserted:report.inserted,marketCaptures:report.marketCaptures,graded:report.graded,sourceGames:report.sourceGames,warnings:report.warnings}));
  }
 }catch(e){failures.push({sport,historicalOnly,error:e.message});console.error(JSON.stringify({sport,historicalOnly,error:e.message}));}saveReport();}
}
if(sports.includes('mlb')&&!process.argv.includes('--results-only')){try{const {stdout}=await exec(process.execPath,[fileURLToPath(new URL('./collect-mlb-stats.mjs',import.meta.url))],{maxBuffer:2*1024*1024,timeout:660000});baseballStats=JSON.parse(stdout.trim());console.log(JSON.stringify({sport:'mlb',stage:'stats',games:baseballStats.games,collectedAt:baseballStats.collectedAt}));}catch(e){failures.push({sport:'mlb',stage:'stats',error:e.message});}}
finished=true;saveReport();console.log(JSON.stringify({artifact:outputDir,failures:failures.length,recoveredSourceFailures:sourceAttempts.length}));
if(failures.length)process.exitCode=1;
