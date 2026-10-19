#!/usr/bin/env node
// Seeds a new host's completed games so its ratings train on the same finals as the old site.
// Fetches ESPN scoreboards with the runner's own source code and posts them as historical-only
// collector boards (finals and grades only, no new forecasts).
// Usage: BIG_VIN_ADMIN_TOKEN_FILE=... node scripts/backfill-finals.mjs <site-url> sport:YYYY-MM-DD[:YYYY-MM-DD] ...
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFileSync} from 'node:fs';
import {collectSourceRange,boardBatches} from '../../lib/collector-sources.mjs';
const exec=promisify(execFile);
const addDays=(d,n)=>{const t=new Date(d+'T12:00:00Z');t.setUTCDate(t.getUTCDate()+n);return t.toISOString().slice(0,10);};
const yesterday=()=>addDays(new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(new Date()),-1);
async function read(url){const {stdout}=await exec('curl',['--fail','--silent','--show-error','--max-time','30','--retry','2',url],{maxBuffer:64*1024*1024});return JSON.parse(stdout);}
const [site,...specs]=process.argv.slice(2);
if(!site||!specs.length){console.error('Usage: node scripts/backfill-finals.mjs <site-url> sport:start[:end] ...');process.exit(2);}
const token=readFileSync(process.env.BIG_VIN_ADMIN_TOKEN_FILE||'','utf8').trim();
async function post(body){const r=await fetch(site.replace(/\/$/,'')+'/api/collector',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify(body),signal:AbortSignal.timeout(120000)});const t=await r.text();if(!r.ok)throw Error(`HTTP ${r.status} ${t.slice(0,200)}`);return JSON.parse(t);}
for(const spec of specs){
 const [sport,start,end=yesterday()]=spec.split(':');
 for(let from=start;from<=end;from=addDays(from,7)){
  const to=[addDays(from,6),end].sort()[0];
  const ranges=sport==='cbb'?Array.from({length:7},(_,i)=>addDays(from,i)).filter(d=>d<=to).map(date=>({date})):[{date:from,endDate:to}];
  for(const range of ranges){
   const got=await collectSourceRange(sport,range,read);
   for(const batch of boardBatches(got.boards)){
    try{const r=await post({sport,historicalOnly:true,boards:batch.map(({rawSummary,rawOdds,...b})=>b)});console.log(JSON.stringify({sport,range,sourceGames:r.sourceGames,graded:r.graded}));}
    catch(e){console.log(JSON.stringify({sport,range,error:e.message}));}
   }
   if(got.missing.length)console.log(JSON.stringify({sport,range,missing:got.missing.length}));
  }
 }
}
