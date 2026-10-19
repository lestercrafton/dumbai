import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {SqliteD1} from './render/sqlite-d1.mjs';

// edge.mjs imports ./index.js (the built app); give it a stand-in.
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bv-edge-'));
for(const f of ['edge.mjs','read-cache.mjs'])fs.copyFileSync(new URL('../cloudflare/'+f,import.meta.url),path.join(dir,f));
fs.writeFileSync(path.join(dir,'index.js'),"export const calls=[];export default {async fetch(request){calls.push(new URL(request.url).pathname+new URL(request.url).search);const p=new URL(request.url).pathname;if(p==='/api/slate')return Response.json({n:calls.length});if(p==='/')return new Response('<html>'+calls.length+'</html>',{headers:{'content-type':'text/html; charset=utf-8'}});if(p.endsWith('.rsc'))return new Response('0:rsc'+calls.length,{headers:{'content-type':'text/x-component'}});if(p==='/api/results')return Response.json({error:'x'},{status:503});return new Response('app');}};");
const edge=(await import(path.join(dir,'edge.mjs'))).default;
const {calls}=await import(path.join(dir,'index.js'));
function database(){
 const d1=new SqliteD1(':memory:');const m=new URL('../drizzle/',import.meta.url);
 for(const f of fs.readdirSync(m).filter(f=>f.endsWith('.sql')).sort())for(const s of fs.readFileSync(new URL(f,m),'utf8').split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))d1.sqlite.exec(s);
 return d1;
}
function ctx(){const waits=[];return {waits,waitUntil:p=>waits.push(p),passThroughOnException(){}};}
test('a miss runs the app and fills the cache; the next request reads the cache only',async()=>{
 const env={DB:database(),CF_VERSION:{id:'v1'}};
 let c=ctx();let r=await edge.fetch(new Request('https://x/api/slate?sport=nfl&date=2026-10-19&days=1'),env,c);
 assert.deepEqual(await r.json(),{n:1});await Promise.all(c.waits);
 c=ctx();r=await edge.fetch(new Request('https://x/api/slate?days=1&date=2026-10-19&sport=nfl'),env,c);
 assert.deepEqual(await r.json(),{n:1});assert.equal(r.headers.get('x-big-vin-cache'),'hit');assert.equal(r.headers.get('content-type'),'application/json');
 assert.equal(calls.length,1);
 // Errors are never cached, but the key is registered for the renderer.
 c=ctx();await edge.fetch(new Request('https://x/api/results?sport=nfl'),env,c);await Promise.all(c.waits);
 c=ctx();await edge.fetch(new Request('https://x/api/results?sport=nfl'),env,c);assert.equal(calls.length,3);
 assert.equal(await env.DB.prepare('SELECT status FROM read_cache WHERE key=?').bind('api:/api/results?sport=nfl').first('status'),0);
 // Writes, router requests and uncached routes go straight to the app.
 await edge.fetch(new Request('https://x/api/slate?sport=nfl',{method:'POST',body:'{}'}),env,ctx());
 await edge.fetch(new Request('https://x/api/slate?sport=nfl&date=2026-10-19&days=1',{headers:{RSC:'1'}}),env,ctx());
 // A page's navigation payload is cached per router state.
 c=ctx();await edge.fetch(new Request('https://x/challengers.rsc',{headers:{RSC:'1'}}),env,c);await Promise.all(c.waits);
 assert.equal(await (await edge.fetch(new Request('https://x/api/ledger'),env,ctx())).text(),'app');
 assert.equal(calls.length,7);
 // Stale bodies are recomputed.
 env.DB.sqlite.prepare("UPDATE read_cache SET rendered_at='2026-01-01T00:00:00.000Z'").run();
 c=ctx();r=await edge.fetch(new Request('https://x/api/slate?sport=nfl&date=2026-10-19&days=1'),env,c);assert.deepEqual(await r.json(),{n:8});
});
test('navigation payloads are reused for the same router state only',async()=>{
 const env={DB:database(),CF_VERSION:{id:'v1'}};
 const get=async h=>{const c=ctx();const r=await edge.fetch(new Request('https://x/challengers.rsc',{headers:h}),env,c);const t=await r.text();await Promise.all(c.waits);return t;};
 const a=await get({RSC:'1'});assert.equal(await get({RSC:'1'}),a);
 assert.notEqual(await get({RSC:'1','Next-Router-State-Tree':'x'}),a);
});
test('the home page HTML is reused for the same deployment and day',async()=>{
 const env={DB:database(),CF_VERSION:{id:'v1'}};
 let c=ctx();const first=await (await edge.fetch(new Request('https://x/'),env,c)).text();await Promise.all(c.waits);
 const again=await edge.fetch(new Request('https://x/'),env,ctx());
 assert.equal(await again.text(),first);assert.equal(again.headers.get('content-type'),'text/html; charset=utf-8');
 env.CF_VERSION={id:'v2'};
 assert.notEqual(await (await edge.fetch(new Request('https://x/'),env,ctx())).text(),first);
});
test('gzipped bodies from the renderer go out as stored bytes, or unpacked for clients without gzip',async()=>{
 const zlib=await import('node:zlib');const {storeStatements,GZIP_PREFIX}=await import('../cloudflare/read-cache.mjs');
 const env={DB:database(),CF_VERSION:{id:'v1'}};
 const body=JSON.stringify({games:Array.from({length:500},(_,i)=>({id:i,name:'Team '+i}))});
 await env.DB.batch(storeStatements(env.DB,{key:'api:/api/learning',status:200,headers:[['content-type','application/json']],renderedAt:new Date().toISOString(),source:'render',body:GZIP_PREFIX+zlib.gzipSync(body).toString('base64')}));
 let r=await edge.fetch(new Request('https://x/api/learning',{headers:{'accept-encoding':'gzip, br'}}),env,ctx());
 assert.equal(r.headers.get('content-encoding'),'gzip');
 assert.equal(zlib.gunzipSync(Buffer.from(await r.arrayBuffer())).toString(),body);
 r=await edge.fetch(new Request('https://x/api/learning',{headers:{'accept-encoding':'identity'}}),env,ctx());
 assert.equal(r.headers.get('content-encoding'),null);assert.equal(await r.text(),body);
});
test('cacheable responses carry an edge-only cache directive; everything else is marked no-store',async()=>{
 const {EDGE_HEADER,edgeDirective,secondsToEasternMidnight}=await import('../cloudflare/read-cache.mjs');
 const env={DB:database(),CF_VERSION:{id:'v1'}};
 let c=ctx();let r=await edge.fetch(new Request('https://x/api/slate?sport=nba&date=2026-10-19&days=1'),env,c);await Promise.all(c.waits);
 assert.equal(r.headers.get(EDGE_HEADER),'public, max-age=60, stale-while-revalidate=300');assert.equal(r.headers.get('cache-control'),null);
 r=await edge.fetch(new Request('https://x/api/slate?sport=nba&date=2026-10-19&days=1'),env,ctx());
 assert.equal(r.headers.get('x-big-vin-cache'),'hit');assert.equal(r.headers.get(EDGE_HEADER),'public, max-age=60, stale-while-revalidate=300');
 r=await edge.fetch(new Request('https://x/api/results?sport=nba'),env,ctx());assert.equal(r.status,503);assert.equal(r.headers.get(EDGE_HEADER),'no-store');
 r=await edge.fetch(new Request('https://x/api/ledger'),env,ctx());assert.equal(r.headers.get(EDGE_HEADER),'no-store');
 r=await edge.fetch(new Request('https://x/api/slate',{method:'POST',body:'{}'}),env,ctx());assert.equal(r.headers.get(EDGE_HEADER),'no-store');
 c=ctx();r=await edge.fetch(new Request('https://x/'),env,c);await Promise.all(c.waits);assert.match(r.headers.get(EDGE_HEADER),/^public, max-age=\d+/);
 // Per-day pages never stay cached past Eastern midnight.
 const nearMidnight=Date.parse('2026-10-20T03:59:00Z');
 assert.equal(secondsToEasternMidnight(nearMidnight),60);
 assert.equal(edgeDirective('page',nearMidnight),'public, max-age=60, stale-while-revalidate=60');
 assert.equal(edgeDirective('page',Date.parse('2026-10-20T03:59:58Z')),'no-store');
 assert.equal(edgeDirective('page',Date.parse('2026-10-19T16:00:00Z')),'public, max-age=300, stale-while-revalidate=300');
});
