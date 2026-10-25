import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {apiCacheKey,pageCacheKey,canonicalQuery,splitBody,storeStatements,readCached,fresh,storableHeaders,routerRequest,easternDay} from '../cloudflare/read-cache.mjs';
import {SqliteD1} from '../scripts/render/sqlite-d1.mjs';
import {checkStatements,rowsChanged,rowsAfter,applyStatements,dropKeys,pruneParts,recentRuns,maxRowids} from './render-source.mjs';
import {planKeys,baseKeys,SPORTS} from '../scripts/render-read-cache.mjs';

function database(){
 const d1=new SqliteD1(':memory:');
 const dir=new URL('../drizzle/',import.meta.url);
 for(const f of readdirSync(dir).filter(f=>f.endsWith('.sql')).sort())for(const s of readFileSync(new URL(f,dir),'utf8').split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))d1.sqlite.exec(s);
 return d1;
}
test('one cache key per request, whatever order a page builds its query in',()=>{
 const a=apiCacheKey('https://x/api/results?sport=cfb&cohort=live&history=1&rankPeriod=week&historyDate=2026-10-19');
 const b=apiCacheKey('https://x/api/results?historyDate=2026-10-19&history=1&rankPeriod=week&cohort=live&sport=cfb');
 assert.equal(a,b);assert.equal(a,'api:/api/results?cohort=live&history=1&historyDate=2026-10-19&rankPeriod=week&sport=cfb');
 assert.equal(apiCacheKey('https://x/api/slate?sport=nfl&date=2026-10-19&days=1'),'api:/api/slate?date=2026-10-19&days=1&sport=nfl');
 assert.equal(apiCacheKey('https://x/api/learning'),'api:/api/learning');
 assert.equal(apiCacheKey('https://x/api/bankroll'),'api:/api/bankroll');
 assert.equal(apiCacheKey('https://x/api/bankroll?sport=cfb'),'api:/api/bankroll?sport=cfb');
 for(const live of ['/api/ledger','/api/collector','/api/render?op=keys','/api/playbook?view=odds&sport=nfl&gameId=1','/api/playbook','/api/baseball-data','/api/site-export'])assert.equal(apiCacheKey('https://x'+live),null,live);
 assert.equal(apiCacheKey('https://x/api/results?sport=nfl&cohort=live&history=1&summary=1&historyDate=2026-10-25&season=2026&rankPeriod=week'),null,'summary board strip stays live');
 assert.ok(apiCacheKey('https://x/api/results?sport=nfl&cohort=live&history=1&historyDate=2026-10-25&season=2026&rankPeriod=week'));
 assert.equal(apiCacheKey('https://x/api/playbook?view=challengers'),'api:/api/playbook?view=challengers');
 assert.equal(canonicalQuery(new URLSearchParams('b=2&a=1&a=0')),'?a=0&a=1&b=2');
});
test('the home page is cached per deployment and Eastern day; other pages are not',()=>{
 const at=Date.parse('2026-10-20T03:30:00Z');// 11:30 PM Eastern on the 19th
 assert.equal(easternDay(at),'2026-10-19');assert.equal(easternDay(Date.parse('2026-10-19T04:30:00Z')),'2026-10-19');assert.equal(easternDay(Date.parse('2026-10-19T03:30:00Z')),'2026-10-18');
 assert.equal(pageCacheKey('https://x/',"v1",at),'page:v1:2026-10-19:/');
 assert.equal(pageCacheKey('https://x/?sport=cfb',"v1",at),'page:v1:2026-10-19:/?sport=cfb');
 assert.equal(pageCacheKey('https://x/challengers','v1',at),null);
 assert.equal(routerRequest(new Request('https://x/',{headers:{RSC:'1'}})),true);
 assert.equal(routerRequest(new Request('https://x/')),false);
});
test('long bodies split into parts and read back whole; an older render never replaces a newer one',async()=>{
 const db=database();
 const body='x'.repeat(2_100_000)+'end';
 assert.equal(splitBody(body).length,3);
 await db.batch(storeStatements(db,{key:'api:/a',status:200,headers:[['content-type','application/json']],renderedAt:'2026-10-19T10:00:00.000Z',source:'render',body}));
 let hit=await readCached(db,'api:/a');assert.equal(hit.body,body);assert.deepEqual(hit.headers,[['content-type','application/json']]);
 await db.batch(storeStatements(db,{key:'api:/a',status:200,headers:[],renderedAt:'2026-10-19T09:00:00.000Z',source:'render',body:'old'}));
 hit=await readCached(db,'api:/a');assert.equal(hit.body,body,'older render ignored');
 await db.batch(storeStatements(db,{key:'api:/a',status:200,headers:[],renderedAt:'2026-10-19T11:00:00.000Z',source:'miss',body:'new'}));
 hit=await readCached(db,'api:/a');assert.equal(hit.body,'new');
 assert.equal(await pruneParts(db),2);
 assert.equal(await readCached(db,'api:/missing'),null);
 const reg=(await db.prepare('SELECT registered_at FROM read_cache WHERE key=?').bind('api:/a').first()).registered_at;
 assert.equal(reg,'2026-10-19T10:00:00.000Z','first registration kept');
 assert.equal(await dropKeys(db,['api:/a']),1);assert.equal(await readCached(db,'api:/a'),null);
});
test('stale or future-dated bodies are recomputed live',()=>{
 const now=Date.parse('2026-10-19T12:00:00Z');
 assert.equal(fresh({rendered_at:'2026-10-19T11:30:00Z'},now),true);
 assert.equal(fresh({rendered_at:'2026-10-19T11:00:00Z'},now),false);
 assert.equal(fresh({rendered_at:'1970-01-01T00:00:00.000Z'},now),false);
 assert.equal(fresh({rendered_at:'2026-10-19T13:00:00Z'},now),false);
 assert.deepEqual(storableHeaders(new Headers({'Content-Type':'application/json','Set-Cookie':'a=1','Cache-Control':'no-store'})),[['cache-control','no-store'],['content-type','application/json']]);
});
test('renderer writes must be inserts or updates on tables public reads write',()=>{
 assert.doesNotThrow(()=>checkStatements([{sql:'INSERT INTO feed_cache (key,payload,fetched_at) VALUES (?,?,?)',params:['k','{}','t']},{sql:'UPDATE forecasts SET result=?,graded_at=? WHERE id=? AND result IS ?',params:['{}','t','id',null]}]));
 for(const sql of ['DELETE FROM forecasts','DROP TABLE forecasts','INSERT INTO read_cache (key) VALUES (?)','UPDATE plays SET outcome=?; DROP TABLE plays','INSERT INTO learning_entries (id) VALUES (?)','SELECT 1','PRAGMA table_info(forecasts)','REPLACE INTO forecasts (id) VALUES (?)'])assert.throws(()=>checkStatements([{sql,params:[]}]),undefined,sql);
 assert.throws(()=>checkStatements([{sql:'UPDATE plays SET outcome=? WHERE id=?',params:[{}, 'x']}]));
 assert.throws(()=>checkStatements([]));
});
test('changed rows page through ties without repeats or gaps',async()=>{
 const db=database();
 for(let i=0;i<25;i++)db.sqlite.prepare("INSERT INTO forecasts (id,sport,week_key,cohort,start_time,captured_at,payload,result,graded_at) VALUES (?,?,?,?,?,?,?,?,?)").run('f'+i,'nfl','w','live','2026-10-19T00:00:00Z','c','{}',i<20?'{}':null,i<20?(i<15?'2026-10-19T10:00:00.000Z':'2026-10-19T11:00:00.000Z'):null);
 const seen=[];let since='2026-10-19T09:00:00.000Z',after=0;
 for(;;){const rows=await rowsChanged(db,'forecasts',since,after,4);seen.push(...rows.map(r=>r.id));if(rows.length<4)break;since=rows.at(-1).graded_at;after=rows.at(-1).__rowid;}
 assert.deepEqual(seen,Array.from({length:20},(_,i)=>'f'+i));
 assert.equal((await rowsAfter(db,'forecasts',20,100)).length,5);
 assert.equal((await maxRowids(db)).forecasts,25);
 const plan=db.sqlite.prepare("EXPLAIN QUERY PLAN SELECT rowid AS __rowid,* FROM forecasts WHERE graded_at>=? AND (graded_at>? OR rowid>?) ORDER BY graded_at,rowid LIMIT ?").all('a','a',0,1).map(r=>r.detail).join(' ');
 assert.match(plan,/forecasts_graded/);
 const runs=db.sqlite.prepare("EXPLAIN QUERY PLAN SELECT payload FROM collection_runs WHERE sport=? ORDER BY completed_at DESC LIMIT 90").all('nfl').map(r=>r.detail).join(' ');
 assert.match(runs,/collection_sport_completed/);
 const bySport=db.sqlite.prepare("EXPLAIN QUERY PLAN SELECT id,payload,result FROM forecasts WHERE sport=? AND id>? ORDER BY id ASC LIMIT ?").all('nfl','',1).map(r=>r.detail).join(' ');
 assert.match(bySport,/forecasts_sport_id/);
 assert.equal((await recentRuns(db,'nfl',90)).length,0);
});
test('applied writes report their changes, and the fake D1 records only writes',async()=>{
 const db=database();
 const changes=await applyStatements(db,[{sql:'INSERT INTO feed_cache (key,payload,fetched_at) VALUES (?,?,?) ON CONFLICT(key) DO NOTHING',params:['k','{}','t']},{sql:'INSERT INTO feed_cache (key,payload,fetched_at) VALUES (?,?,?) ON CONFLICT(key) DO NOTHING',params:['k','{}','t']}]);
 assert.deepEqual(changes,[1,0]);
 const w=db.takeWrites();assert.equal(w.length,2);assert.deepEqual(w.map(x=>x.changes),[1,0]);
 await db.prepare('SELECT * FROM feed_cache').all();assert.equal(db.takeWrites().length,0);
 await assert.rejects(db.batch([db.prepare('INSERT INTO feed_cache (key,payload,fetched_at) VALUES (?,?,?)').bind('z','{}','t'),db.prepare('INSERT INTO nope VALUES (1)')]));
 assert.equal(await db.prepare('SELECT count(*) n FROM feed_cache WHERE key=?').bind('z').first('n'),0,'batch rolled back');
 assert.throws(()=>db.prepare('SELECT ?').bind(undefined));
});
test('the renderer keeps base keys, renders registered ones for three days, and drops old home-page days',()=>{
 const now=Date.parse('2026-10-19T16:00:00Z');
 const base=baseKeys('2026-10-19');
 assert.equal(base.length,5+SPORTS.length*3);
 assert.ok(base.includes('api:/api/slate?date=2026-10-19&days=1&sport=cfb'));
 const plan=planKeys([
  {key:base[0],registered_at:'2026-09-01T00:00:00Z'},
  {key:'api:/api/results?sport=nfl&week=2026-W07',registered_at:'2026-10-18T00:00:00Z'},
  {key:'api:/api/results?sport=nfl&week=2026-W01',registered_at:'2026-10-10T00:00:00Z'},
  {key:'page:v1:2026-10-19:/',registered_at:'2026-10-19T00:00:00Z'},
  {key:'page:v1:2026-10-17:/',registered_at:'2026-10-17T00:00:00Z'},
 ],base,now);
 assert.ok(plan.render.includes('api:/api/results?sport=nfl&week=2026-W07'));
 assert.ok(plan.render.includes(base[0]));
 assert.deepEqual(plan.drop,['api:/api/results?sport=nfl&week=2026-W01','page:v1:2026-10-17:/']);
});
