import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
let serial=0;
async function storeModule(db){
 const key='__pickStoreTest'+serial++;globalThis[key]=db;
 const bundle=await build({entryPoints:['lib/pick-revision-store.ts'],absWorkingDir:root,bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent',plugins:[{name:'sqlite-db',setup(b){
  b.onResolve({filter:/^\.\/db$/},()=>({path:'db',namespace:'mock'}));
  b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`export const db=()=>testDb;`,loader:'js'}));
 }}]});
 const dir=mkdtempSync(join(tmpdir(),'vin-pick-store-')),file=join(dir,'store.mjs');
 try{writeFileSync(file,`const testDb=globalThis[${JSON.stringify(key)}];\n`+bundle.outputFiles[0].text);return await import(pathToFileURL(file).href);}
 finally{delete globalThis[key];rmSync(dir,{recursive:true,force:true});}
}
async function setup(t){
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
 sql.exec('PRAGMA foreign_keys=ON; CREATE TABLE forecasts(id TEXT PRIMARY KEY,sport TEXT,result TEXT);');
 sql.exec(readFileSync(new URL('../drizzle/0004_strong_hydra.sql',import.meta.url),'utf8'));
 const db={delay:null,prepare(query){return {bind(...args){const statement=sql.prepare(query);return {
  async all(){return {results:statement.all(...args)};},async first(){return statement.get(...args)??null;},
  async run(){if(db.delay&&/INSERT INTO pick_revision/.test(query)){const wait=db.delay;db.delay=null;await new Promise(r=>setTimeout(r,wait));}const r=statement.run(...args);return {meta:{changes:Number(r.changes)}};}
 };}};}};
 const now=Date.now(),iso=ms=>new Date(ms).toISOString();
 const f={id:'test:123',gameId:'123',sport:'cfb',cohort:'live',origin:'collector',modelVersion:'test',homeId:'H',awayId:'A',predictedMargin:5.4,marketHomeSpread:-5.5,side:'away',odds:-110,capturedAt:iso(now-60000),marketObservedAt:iso(now-61000),startTime:iso(now+3600000)};
 sql.prepare('INSERT INTO forecasts VALUES(?,?,NULL)').run(f.id,f.sport);
 const game=(spread,observedAt=iso(now))=>({id:'123',sport:'cfb',homeId:'H',awayId:'A',status:'scheduled',startTime:f.startTime,market:{homeSpread:spread,awaySpread:-spread,homeSpreadPrice:-110,awaySpreadPrice:-110,observedAt,timing:'current-displayed-snapshot',provider:'Book'}});
 return {sql,db,f,game,...await storeModule(db)};
}

test('actual SQL CAS retains one current revision under overlapping writes and rejects older observations',async t=>{
 const {sql,f,game,capturePickRevisions,pickStates}=await setup(t);
 await Promise.all(Array.from({length:6},()=>capturePickRevisions([f],[game(-4.5)])));
 let state=(await pickStates('cfb')).get(f.id);assert.equal(state.revisions.length,1);assert.equal(state.revisions[0].side,'home');
 await capturePickRevisions([f],[game(-8,new Date(Date.now()-5000).toISOString())]);
 state=(await pickStates('cfb')).get(f.id);assert.equal(state.revisions.length,1);
 assert.equal(sql.prepare('SELECT result FROM forecasts').get().result,null);
});

test('DB clock prevents a delayed pregame insert from crossing kickoff',async t=>{
 const {db,f,game,capturePickRevisions,pickStates}=await setup(t);
 f.startTime=new Date(Date.now()+50).toISOString();db.delay=120;
 await capturePickRevisions([f],[game(-4.5)]);
 assert.equal((await pickStates('cfb')).size,0);
});

test('settled row cannot acquire a new revision even with a stale pregame caller',async t=>{
 const {sql,f,game,capturePickRevisions,pickStates}=await setup(t);
 sql.prepare('UPDATE forecasts SET result=?').run('{"status":"completed"}');
 await capturePickRevisions([f],[game(-4.5)]);
 assert.equal((await pickStates('cfb')).size,0);
});
