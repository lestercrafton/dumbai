import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {SqliteD1} from './render/sqlite-d1.mjs';
import {sync,SPORTS} from './render-read-cache.mjs';
import {RENDER_TABLES,maxRowids,rowsAfter,rowsChanged,recentRuns} from '../lib/render-source.mjs';

function database(file=':memory:'){
 const d1=new SqliteD1(file);const dir=new URL('../drizzle/',import.meta.url);
 for(const f of fs.readdirSync(dir).filter(f=>f.endsWith('.sql')).sort())for(const s of fs.readFileSync(new URL(f,dir),'utf8').split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))d1.sqlite.exec(s);
 return d1;
}
const fakeRemote=db=>({get:async p=>{
 if(p.op==='max')return maxRowids(db);
 if(p.op==='rows')return (await rowsAfter(db,p.table,p.after,p.limit)).map(r=>({...r}));
 if(p.op==='changed')return (await rowsChanged(db,p.table,p.since,p.afterRowid,p.limit)).map(r=>({...r}));
 if(p.op==='runs')return (await recentRuns(db,p.sport,p.limit)).map(r=>({...r}));
 throw new Error(p.op);
}});
const forecast=(db,id,graded=null)=>db.sqlite.prepare('INSERT INTO forecasts (id,sport,week_key,cohort,start_time,captured_at,payload,result,graded_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id,'nfl','w','live','2026-10-19T17:00:00Z','2026-10-19T10:00:00Z','{"id":"'+id+'"}',graded?'{}':null,graded);
const dump=(db,t)=>db.sqlite.prepare(`SELECT rowid AS r,* FROM ${t} ORDER BY rowid`).all().map(r=>JSON.stringify(r));

test('the local copy matches the site after a full copy and after incremental syncs',async()=>{
 const remote=database(),file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'bv-render-')),'site.sqlite');
 for(let i=0;i<450;i++)forecast(remote,'f'+String(i).padStart(4,'0'),i%3?null:'2026-10-19T09:00:00.000Z');
 for(const s of SPORTS)for(let i=0;i<100;i++)remote.sqlite.prepare('INSERT INTO collection_runs (id,completed_at,sport,payload) VALUES (?,?,?,?)').run(`${s}-${i}`,`2026-10-${String(1+i%18).padStart(2,'0')}T00:00:${String(i%60).padStart(2,'0')}.000Z`,s,'{}');
 remote.sqlite.prepare('INSERT INTO pick_revision_states (forecast_id,payload) VALUES (?,?)').run('f0001','{"v":1}');
 remote.sqlite.prepare('INSERT INTO feed_cache (key,payload,fetched_at) VALUES (?,?,?)').run('k','{}','2026-10-19T09:00:00.000Z');
 const t1=Date.parse('2026-10-19T10:00:00Z');
 let {d1,full,counts}=await sync(fakeRemote(remote),file,t1);
 assert.equal(full,true);assert.equal(counts.forecasts,450);assert.equal(counts.collection_runs,SPORTS.length*90);
 for(const t of Object.keys(RENDER_TABLES))if(t!=='collection_runs')assert.deepEqual(dump(d1,t),dump(remote,t),t);
 // Top 90 runs per sport, as the pages read them.
 const top=(db,s)=>db.sqlite.prepare('SELECT id FROM collection_runs WHERE sport=? ORDER BY completed_at DESC LIMIT 90').all(s).map(r=>r.id);
 for(const s of SPORTS)assert.deepEqual(top(d1,s),top(remote,s));
 // A local write the site rejected (a phantom) is replaced once the site's own row arrives.
 forecast(d1,'phantom');d1.close();
 forecast(remote,'new1');forecast(remote,'phantom');
 remote.sqlite.prepare("UPDATE forecasts SET result='{\"x\":1}',graded_at=? WHERE id=?").run('2026-10-19T10:20:00.000Z','f0001');
 remote.sqlite.prepare("UPDATE pick_revision_states SET payload='{\"v\":2}'").run();
 remote.sqlite.prepare("INSERT INTO feed_cache (key,payload,fetched_at) VALUES ('k','{\"n\":2}','2026-10-19T10:21:00.000Z') ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,fetched_at=excluded.fetched_at").run();
 remote.sqlite.prepare('INSERT INTO collection_runs (id,completed_at,sport,payload) VALUES (?,?,?,?)').run('nfl-new','2026-10-19T10:22:00.000Z','nfl','{}');
 ({d1,full,counts}=await sync(fakeRemote(remote),file,t1+30*60_000));
 assert.equal(full,false);
 for(const t of Object.keys(RENDER_TABLES))if(t!=='collection_runs')assert.deepEqual(dump(d1,t).map(r=>JSON.parse(r)).map(({r,...x})=>x).sort((a,b)=>JSON.stringify(a)<JSON.stringify(b)?-1:1),dump(remote,t).map(r=>JSON.parse(r)).map(({r,...x})=>x).sort((a,b)=>JSON.stringify(a)<JSON.stringify(b)?-1:1),t);
 for(const s of SPORTS)assert.deepEqual(top(d1,s),top(remote,s));
 assert.ok(counts.forecasts<20,'incremental pull is small: '+counts.forecasts);
 d1.close();
 // Twelve hours on, the copy is rebuilt from scratch.
 ({d1,full}=await sync(fakeRemote(remote),file,t1+13*3600_000));assert.equal(full,true);
 assert.deepEqual(dump(d1,'forecasts'),dump(remote,'forecasts'));d1.close();
});
test('the renderer also prepares the week boards and the record views the home page asks for',async()=>{
 const {weekSlateKeys,recordKeys}=await import('./render-read-cache.mjs');
 assert.deepEqual(weekSlateKeys('2026-10-19'),['api:/api/slate?date=2026-10-13&days=7&sport=nfl','api:/api/slate?date=2026-10-19&days=7&sport=cfb']);
 const now=Date.parse('2026-10-19T12:00:00Z');
 const season={year:2026,startDate:'2026-08-01T00:00Z',endDate:'2027-02-01T00:00Z'};
 const keys=recordKeys([{sport:'nfl',days:1,body:JSON.stringify({sport:'nfl',seasonContext:season})},{sport:'mlb',days:1,body:JSON.stringify({sport:'mlb',seasonContext:{year:2026,startDate:'2026-03-01T00:00Z',endDate:'2026-10-01T00:00Z'}})},{sport:'cfb',days:7,body:JSON.stringify({sport:'cfb',seasonContext:season})},{sport:'nba',days:1,body:'not json'}],'2026-10-19',now);
 // Summary record views bypass the read cache so the board strip grades live; nothing to prerender.
 assert.deepEqual(keys,[]);
});
