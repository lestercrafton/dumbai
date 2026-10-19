#!/usr/bin/env node
// Turns the runner's checkpoint artifact (collections/<run>/report.json) into collection_runs rows,
// so a new host shows the same coverage and "last collected" history the old site had.
// Usage: node scripts/checkpoint-recovery.mjs <unzipped-checkpoint-dir> <out.sql>
import {readdirSync,readFileSync,existsSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const q=v=>v===null||v===undefined?'NULL':"'"+String(v).replaceAll("'","''")+"'";
export function collectionRows(dir){
 const root=join(dir,'collections'),rows=[];
 for(const run of readdirSync(root).sort()){
  const file=join(root,run,'report.json');if(!existsSync(file))continue;
  let report;try{report=JSON.parse(readFileSync(file,'utf8'));}catch{continue;}
  (report.reports||[]).forEach((r,i)=>{if(!r?.sport||!Number.isFinite(Date.parse(r.completedAt)))return;
   rows.push({id:`checkpoint:${run}:${i}`,completedAt:r.completedAt,sport:r.sport,payload:{...r,recovery:{source:'runner-checkpoint',run}}});});
 }
 return rows;
}
export const collectionSql=r=>`INSERT INTO collection_runs (id,completed_at,sport,payload) VALUES (${[r.id,r.completedAt,r.sport,JSON.stringify(r.payload)].map(q).join(',')}) ON CONFLICT(id) DO NOTHING;`;
if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
 const [dir,out]=process.argv.slice(2);if(!dir||!out){console.error('Usage: node scripts/checkpoint-recovery.mjs <checkpoint-dir> <out.sql>');process.exit(2);}
 const rows=collectionRows(dir);const sql=rows.map(collectionSql).filter(l=>l.length<95000);
 writeFileSync(out,sql.join('\n')+'\n');
 console.log(JSON.stringify({runs:rows.length,written:sql.length,skippedTooLarge:rows.length-sql.length,first:rows[0]?.completedAt,last:rows.at(-1)?.completedAt}));
}
