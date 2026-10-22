#!/usr/bin/env node
// Pulls a complete read-only export from the site's /api/site-export endpoint.
// Writes schema.json, tables/<name>.jsonl, files/, files.json, counts.json and SHA256SUMS.
import {createHash} from 'node:crypto';
import {mkdir,writeFile,readFile,readdir,stat} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {once} from 'node:events';
import {join,relative} from 'node:path';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export function githubTokenSource(audience,env=process.env,fetchImpl=fetch){
 let cached=null;
 return async()=>{
  if(cached&&cached.expires>Date.now())return cached.value;
  if(!env.ACTIONS_ID_TOKEN_REQUEST_URL||!env.ACTIONS_ID_TOKEN_REQUEST_TOKEN)throw Error('GitHub OIDC is unavailable; run this inside the site-export workflow with id-token: write.');
  const url=new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);url.searchParams.set('audience',audience);
  const response=await fetchImpl(url,{headers:{authorization:'Bearer '+env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}});
  if(!response.ok)throw Error('Could not obtain a GitHub OIDC token: HTTP '+response.status);
  const {value}=await response.json();cached={value,expires:Date.now()+4*60*1000};return value;
 };
}
function hexBytes(hex){if(typeof hex!=='string'||hex.length%2||!/^[0-9a-fA-F]*$/.test(hex))throw Error('Malformed hex chunk');return Buffer.from(hex,'hex');}
const safeName=name=>{if(!/^[A-Za-z0-9_.-]{1,200}$/.test(name)||name.startsWith('.'))throw Error('Unsupported table name for a file: '+name);return name;};

export async function exportSite({site,token,out,fetchImpl=fetch,pageSize=200,chunkSize=1_048_576,log=console.log,retries=4}){
 const call=async(params,{raw=false}={})=>{
  const url=new URL('/api/site-export',site);for(const [k,v] of Object.entries(params))url.searchParams.set(k,String(v));
  for(let attempt=0;;attempt++){
   let response;
   try{response=await fetchImpl(url,{headers:{authorization:'Bearer '+await token(),accept:'application/json'},redirect:'error'});}
   catch(error){if(attempt>=retries)throw error;await sleep(1000*2**attempt);continue;}
   if(response.ok)return raw?response:response.json();
   const text=await response.text().catch(()=>'');
   if((response.status>=500||response.status===429)&&attempt<retries){await sleep(1000*2**attempt);continue;}
   const error=Error(`Export ${params.op} failed: HTTP ${response.status} ${text.slice(0,300)}`);error.status=response.status;throw error;
  }
 };
 await mkdir(join(out,'tables'),{recursive:true});await mkdir(join(out,'files'),{recursive:true});
 const schema=await call({op:'tables'});
 await writeFile(join(out,'schema.json'),JSON.stringify(schema,null,1));
 const counts={site,startedAt:new Date().toISOString(),tables:{},files:null,problems:[]};
 for(const table of schema.tables){
  const file=join(out,'tables',safeName(table.name)+'.jsonl'),stream=createWriteStream(file),hash=createHash('sha256');
  const write=async line=>{hash.update(line);if(!stream.write(line))await once(stream,'drain');};
  let after='0',exported=0,lastRowid=-1n,chunkedCells=0,limit=pageSize;
  for(;;){
   let page;
   try{page=await call({op:'rows',table:table.name,after,limit});}
   catch(error){if(error.status>=500&&limit>1){limit=Math.max(1,Math.floor(limit/4));log(`${table.name}: retrying with ${limit} rows per page`);continue;}throw error;}
   if(JSON.stringify(page.columns)!==JSON.stringify(table.columns.map(c=>c.name)))throw Error(table.name+': column list changed during export');
   for(const row of page.rows){
    const id=BigInt(row.rowid);if(id<=lastRowid)throw Error(table.name+': rowids are not strictly increasing');lastRowid=id;
    const cells=[];
    for(let i=0;i<page.columns.length;i++){
     const type=row.t[i],length=row.l[i];let value=row.v[i];
     if(type==='null'){cells.push(null);continue;}
     if(type==='integer'){if(typeof value!=='string'||!/^-?\d+$/.test(value))throw Error(`${table.name}#${row.rowid}: bad integer`);cells.push({integer:value});continue;}
     if(type==='real'){if(typeof value!=='number')throw Error(`${table.name}#${row.rowid}: bad real`);cells.push({real:value});continue;}
     let bytes;
     if(value===null){
      chunkedCells++;const parts=[];let offset=0;
      while(offset<length){const chunk=await call({op:'cell',table:table.name,column:page.columns[i],rowid:row.rowid,offset,length:chunkSize});
       if(chunk.type!==type||chunk.total!==length)throw Error(`${table.name}#${row.rowid}.${page.columns[i]} changed during export`);
       const b=hexBytes(chunk.hex);if(!b.length)throw Error('Empty chunk before end of cell');parts.push(b);offset+=b.length;}
      bytes=Buffer.concat(parts);
     }else bytes=type==='blob'?hexBytes(value):Buffer.from(value,'utf8');
     if(bytes.length!==length)throw Error(`${table.name}#${row.rowid}.${page.columns[i]}: expected ${length} bytes, received ${bytes.length}`);
     if(type==='text'){const text=bytes.toString('utf8');if(Buffer.byteLength(text,'utf8')!==length)throw Error(`${table.name}#${row.rowid}: text is not valid UTF-8`);cells.push({text});}
     else if(type==='blob')cells.push({blob:bytes.toString('base64')});
     else throw Error(`${table.name}#${row.rowid}: unsupported type ${type}`);
    }
    await write(JSON.stringify({rowid:row.rowid,cells})+'\n');exported++;
   }
   if(page.next===null)break;
   if(page.next===after&&!page.rows.length)throw Error(table.name+': export made no progress');
   after=page.next;limit=pageSize;
  }
  stream.end();await once(stream,'finish');
  counts.tables[table.name]={rowsAtStart:table.rows,exported,chunkedCells,sha256:hash.digest('hex')};
  log(`${table.name}: ${exported} rows (${table.rows} counted at start)`);
 }
 const objects=[];let cursor=null,configured=false;
 do{const page=await call({op:'files',...(cursor?{cursor}:{})});configured=page.configured;objects.push(...page.objects);cursor=page.truncated?page.cursor:null;}while(cursor);
 const files=[];
 for(const object of objects){
  const name=createHash('sha256').update(object.key).digest('hex'),path=join(out,'files',name);
  const response=await call({op:'file',key:object.key},{raw:true});
  const sha=createHash('sha256'),md5=createHash('md5'),stream=createWriteStream(path);let size=0;
  for await(const chunk of response.body){sha.update(chunk);md5.update(chunk);size+=chunk.length;if(!stream.write(chunk))await once(stream,'drain');}
  stream.end();await once(stream,'finish');
  const digest={sha256:sha.digest('hex'),md5:md5.digest('hex')};
  if(size!==object.size)counts.problems.push(`file ${object.key}: expected ${object.size} bytes, received ${size}`);
  const etag=String(object.etag||'').replaceAll('"','');
  if(/^[0-9a-f]{32}$/.test(etag)&&etag!==digest.md5)counts.problems.push(`file ${object.key}: MD5 does not match its etag`);
  for(const [kind,value] of Object.entries(object.checksums||{}))if(digest[kind]&&value!==digest[kind])counts.problems.push(`file ${object.key}: ${kind} checksum mismatch`);
  files.push({...object,file:'files/'+name,received:size,...digest});
 }
 await writeFile(join(out,'files.json'),JSON.stringify({configured,objects:files},null,1));
 counts.files={configured,listed:objects.length,downloaded:files.length,bytes:files.reduce((s,f)=>s+f.received,0)};
 const after=await call({op:'tables'});
 for(const t of after.tables){
  const entry=counts.tables[t.name];if(!entry){counts.problems.push(`table ${t.name} appeared during export`);continue;}
  entry.rowsAtEnd=t.rows;entry.verified=entry.exported===entry.rowsAtStart||entry.exported===entry.rowsAtEnd;
  if(!entry.verified)counts.problems.push(`table ${t.name}: exported ${entry.exported}, counted ${entry.rowsAtStart} at start and ${t.rows} at end`);
 }
 for(const name of Object.keys(counts.tables))if(!after.tables.some(t=>t.name===name))counts.problems.push(`table ${name} disappeared during export`);
 counts.finishedAt=new Date().toISOString();counts.ok=counts.problems.length===0;
 await writeFile(join(out,'counts.json'),JSON.stringify(counts,null,1));
 await writeChecksums(out);
 return counts;
}
async function walk(dir){const out=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())out.push(...await walk(p));else out.push(p);}return out;}
export async function writeChecksums(out){
 const lines=[];
 for(const path of (await walk(out)).sort()){const rel=relative(out,path);if(rel==='SHA256SUMS')continue;lines.push(createHash('sha256').update(await readFile(path)).digest('hex')+'  '+rel);}
 await writeFile(join(out,'SHA256SUMS'),lines.join('\n')+'\n');
}
// Flags credential-like or personal values without copying them anywhere.
const PATTERNS={openai_key:/\bsk-[A-Za-z0-9_-]{20,}/,github_token:/\bgh[pousr]_[A-Za-z0-9]{30,}/,jwt:/\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,bearer:/\bBearer\s+[A-Za-z0-9._~+\/-]{20,}/i,key_param:/\b(?:api[_-]?key|apikey|access[_-]?token|client[_-]?secret|password)["']?\s*[=:]\s*["']?[^\s"'&,}]{8,}/i,email:/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/};
export async function scanForPrivate(out,{allowEmails=[]}={}){
 const findings=[];
 for(const name of (await readdir(join(out,'tables'))).sort()){
  const text=await readFile(join(out,'tables',name),'utf8');let line=0;
  for(const raw of text.split('\n')){if(!raw)continue;line++;const row=JSON.parse(raw);
   row.cells.forEach((cell,i)=>{if(!cell?.text)return;for(const [kind,re] of Object.entries(PATTERNS)){const m=cell.text.match(re);if(m&&!(kind==='email'&&allowEmails.includes(m[0].toLowerCase())))findings.push({table:name.replace(/\.jsonl$/,''),rowid:row.rowid,column:i,kind});}});
  }
 }
 return findings;
}
if(import.meta.url===`file://${process.argv[1]}`){
 const [site,out]=process.argv.slice(2);
 if(!site||!out){console.error('Usage: site-export-client.mjs <site-url> <out-dir> [--scan-private]');process.exit(2);}
 const audience=process.env.EXPORT_AUDIENCE||new URL('/api/site-export',site).href;
 const counts=await exportSite({site,out,token:githubTokenSource(audience)});
 let findings=[];
 if(process.argv.includes('--scan-private')){
  const allow=(process.env.EXPORT_ALLOWED_EMAILS||'').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean);
  findings=await scanForPrivate(out,{allowEmails:allow});
  await writeFile(join(out,'..','private-scan.json'),JSON.stringify({findings},null,1));
  console.log(`Private-data scan: ${findings.length} finding(s)`);
 }
 console.log(JSON.stringify({ok:counts.ok,problems:counts.problems,files:counts.files,tables:Object.fromEntries(Object.entries(counts.tables).map(([k,v])=>[k,v.exported]))},null,1));
 if(!counts.ok||findings.length)process.exit(1);
}
