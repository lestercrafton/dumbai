import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {handleExport,readRows,listTables} from './site-export.mjs';
import {exportSite,scanForPrivate} from '../scripts/site-export-client.mjs';

function fakeD1(){
 const sqlite=new DatabaseSync(':memory:');
 const wrap=(sql,args=[])=>({bind:(...next)=>wrap(sql,next),all:async()=>({results:sqlite.prepare(sql).all(...args)}),first:async()=>sqlite.prepare(sql).get(...args)??null,run:async()=>{throw Error('export must not write');}});
 return {sqlite,prepare:sql=>{if(!/^\s*(SELECT|PRAGMA table_info)/i.test(sql))throw Error('non-read statement: '+sql);return wrap(sql);}};
}
function fakeR2(entries,pageSize=2){
 const keys=[...entries.keys()].sort();
 const meta=key=>{const bytes=entries.get(key);return {key,size:bytes.length,etag:createHash('md5').update(bytes).digest('hex'),uploaded:new Date('2026-10-01T00:00:00Z'),checksums:{toJSON:()=>({sha256:createHash('sha256').update(bytes).digest('hex')})}};};
 return {list:async({cursor,limit})=>{const start=cursor?Number(cursor):0,size=Math.min(limit,pageSize),slice=keys.slice(start,start+size);return {objects:slice.map(meta),truncated:start+size<keys.length,cursor:String(start+size)};},
  get:async key=>{if(!entries.has(key))return null;const bytes=entries.get(key);return {...meta(key),body:new Blob([bytes]).stream()};},
  put:async()=>{throw Error('export must not write');},delete:async()=>{throw Error('export must not write');}};
}
function seed(){
 const db=fakeD1();
 db.sqlite.exec(`CREATE TABLE things(id TEXT PRIMARY KEY, n INTEGER, x REAL, payload TEXT, data BLOB);
  CREATE INDEX things_n ON things(n);
  CREATE TABLE many(id INTEGER PRIMARY KEY, v TEXT);
  CREATE TABLE _cf_KV(k TEXT); CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
  INSERT INTO d1_migrations(name) VALUES ('0000_init.sql');`);
 const big='é'.repeat(30)+'🏈'.repeat(40)+'x'.repeat(5);
 const ins=db.sqlite.prepare('INSERT INTO things VALUES (?,?,?,?,?)');
 ins.run('a',9007199254740993n,1.5,'{"small":true}',Buffer.from([0,1,2,255]));
 ins.run('b',null,-0.25,big,Buffer.alloc(300,7));
 ins.run('c',-4,3,null,null);
 const many=db.sqlite.prepare('INSERT INTO many VALUES (?,?)');for(let i=1;i<=57;i++)many.run(i*3,'row '+i);
 return {db,big};
}
const options={inlineLimit:40,pageBudget:500,maxChunk:64};
const auth=(db,bucket,calls=[])=>async(url,init)=>{calls.push(new URL(url).searchParams.get('op'));assert.equal(init.headers.authorization,'Bearer test-token');return handleExport(String(url),{db,bucket,options});};

test('lists tables with counts and hides platform internals',async()=>{
 const {db}=seed();const r=await listTables(db);
 assert.deepEqual(r.tables.map(t=>[t.name,t.rows]),[['d1_migrations',1],['many',57],['things',3]]);
 assert.ok(r.schemaObjects.some(x=>x.name==='things_n'));
 assert.deepEqual(r.tables.find(t=>t.name==='things').columns.map(c=>c.name),['id','n','x','payload','data']);
});
test('rows keep exact types and defer oversized cells',async()=>{
 const {db}=seed();const page=await readRows(db,'things',{},options);
 assert.equal(page.rows[0].v[1],'9007199254740993');assert.equal(page.rows[0].t[1],'integer');
 assert.equal(page.rows[0].v[4],'000102FF');
 assert.equal(page.rows[1].v[3],null);assert.equal(page.rows[1].t[3],'text');assert.ok(page.rows[1].l[3]>40);
 assert.equal(page.rows[2].t[3],'null');
});
test('rejects unknown tables, columns and non-numeric cursors without touching SQL text',async()=>{
 const {db}=seed();
 for(const q of ['op=rows&table=nope','op=rows&table=things%22;DROP','op=rows&table=_cf_KV','op=rows&table=sqlite_sequence','op=rows&table=things&after=1%20OR%201','op=cell&table=things&column=zz&rowid=1','op=bogus']){
  const r=await handleExport('https://site.test/api/site-export?'+q,{db});assert.ok(r.status>=400&&r.status<500,q);
 }
});
test('full export round-trips every row, chunked cell and file with matching counts and checksums',async()=>{
 const {db,big}=seed();const out=await mkdtemp(join(tmpdir(),'site-export-'));
 try{
  const files=new Map([['releases/a.json',Buffer.from('{"a":1}')],['blobs/x.bin',Buffer.alloc(5000,9)],['z',Buffer.alloc(0)]]);
  const calls=[];
  const counts=await exportSite({site:'https://site.test',out,token:async()=>'test-token',fetchImpl:auth(db,fakeR2(files),calls),pageSize:5,chunkSize:64,log:()=>{}});
  assert.equal(counts.ok,true,counts.problems.join('; '));
  assert.deepEqual(Object.fromEntries(Object.entries(counts.tables).map(([k,v])=>[k,v.exported])),{d1_migrations:1,many:57,things:3});
  assert.ok(calls.filter(c=>c==='cell').length>1);
  const things=(await readFile(join(out,'tables/things.jsonl'),'utf8')).trim().split('\n').map(l=>JSON.parse(l));
  assert.deepEqual(things[0].cells,[{text:'a'},{integer:'9007199254740993'},{real:1.5},{text:'{"small":true}'},{blob:Buffer.from([0,1,2,255]).toString('base64')}]);
  assert.equal(things[1].cells[3].text,big);assert.equal(Buffer.from(things[1].cells[4].blob,'base64').length,300);
  assert.deepEqual(things[2].cells,[{text:'c'},{integer:'-4'},{real:3},null,null]);
  const many=(await readFile(join(out,'tables/many.jsonl'),'utf8')).trim().split('\n');assert.equal(many.length,57);assert.equal(JSON.parse(many[56]).rowid,'171');
  const listing=JSON.parse(await readFile(join(out,'files.json'),'utf8'));assert.equal(listing.objects.length,3);
  for(const f of listing.objects)assert.deepEqual(await readFile(join(out,f.file)),files.get(f.key));
  const sums=await readFile(join(out,'SHA256SUMS'),'utf8');
  for(const line of sums.trim().split('\n')){const [digest,path]=line.split('  ');assert.equal(createHash('sha256').update(await readFile(join(out,path))).digest('hex'),digest);}
  assert.ok(sums.includes('counts.json')&&sums.includes('tables/things.jsonl'));
 }finally{await rm(out,{recursive:true,force:true});}
});
test('a site without file storage reports none',async()=>{
 const {db}=seed();const out=await mkdtemp(join(tmpdir(),'site-export-'));
 try{const counts=await exportSite({site:'https://site.test',out,token:async()=>'test-token',fetchImpl:auth(db,null),log:()=>{}});assert.deepEqual(counts.files,{configured:false,listed:0,downloaded:0,bytes:0});}
 finally{await rm(out,{recursive:true,force:true});}
});
test('count drift and private-looking values are reported',async()=>{
 const {db}=seed();const out=await mkdtemp(join(tmpdir(),'site-export-'));
 try{
  db.sqlite.exec(`INSERT INTO things VALUES ('k',1,1,'url?apiKey=abcdef123456&x=1',NULL),('m',1,1,'contact fan@example.com',NULL)`);
  let tablesCalls=0;const inner=auth(db,null);
  const counts=await exportSite({site:'https://site.test',out,token:async()=>'test-token',log:()=>{},fetchImpl:async(url,init)=>{if(new URL(url).searchParams.get('op')==='tables'&&++tablesCalls===2)db.sqlite.exec(`DELETE FROM many WHERE id<30`);return inner(url,init);}});
  assert.equal(counts.ok,true);assert.equal(counts.tables.many.rowsAtEnd,48);
  const findings=await scanForPrivate(out);assert.deepEqual(findings.map(f=>f.kind).sort(),['email','key_param']);
  assert.equal((await scanForPrivate(out,{allowEmails:['fan@example.com']})).length,1);
 }finally{await rm(out,{recursive:true,force:true});}
});
