import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {PLAYBOOK_V1,playbookVersionFor,liveVersionAt,validateManifest,validateChallengerPick,validateChallengerResult,validateScoreboard,validatePromotion,gradeChallenger,summarizeRecord,challengerBoard} from './playbook.mjs';

const now=Date.parse('2026-10-20T15:00:00Z');
const pick=(changes={})=>({id:'v2-injuries:nfl:401',versionId:'v2-injuries',sport:'nfl',gameId:'401',weekKey:'2026-W07',startTime:'2026-10-22T00:15:00Z',capturedAt:'2026-10-20T14:00:00Z',home:'Packers',away:'Bears',side:'home',homeSpread:-3.5,odds:-110,predictedMargin:6,...changes});
const promotion={id:'promo-nfl-1',sport:'nfl',fromVersionId:'v1',toVersionId:'v2-injuries',decidedAt:'2026-11-10T15:00:00Z',effectiveAt:'2026-11-10T16:00:00Z',reason:'Beat v1 on unseen games.',evidence:{unseenGames:64}};

test('picks saved before October 19, 2026 Central are always v1',()=>{
 assert.equal(PLAYBOOK_V1.frozenAt,'2026-10-19T05:00:00.000Z');
 assert.equal(playbookVersionFor({capturedAt:'2026-10-19T04:59:59Z',sport:'nfl',playbookVersion:'v9'},{promotions:[promotion]}),'v9');
 assert.equal(playbookVersionFor({capturedAt:'2026-10-19T04:59:59Z',sport:'nfl'},{promotions:[{...promotion,effectiveAt:'2026-01-01T00:00:00Z'}]}),'v1');
 assert.equal(playbookVersionFor({startTime:'2026-09-07T17:00:00Z',sport:'nfl'}),'v1');
 assert.equal(playbookVersionFor({}),'v1');
});
test('after the freeze the live version follows promotions, per sport',()=>{
 assert.equal(playbookVersionFor({capturedAt:'2026-10-25T12:00:00Z',sport:'nfl'},{promotions:[promotion]}),'v1');
 assert.equal(playbookVersionFor({capturedAt:'2026-11-12T12:00:00Z',sport:'nfl'},{promotions:[promotion]}),'v2-injuries');
 assert.equal(playbookVersionFor({capturedAt:'2026-11-12T12:00:00Z',sport:'cfb'},{promotions:[promotion]}),'v1');
 assert.equal(liveVersionAt('nfl','2026-12-01T00:00:00Z',[promotion,{...promotion,id:'p2',fromVersionId:'v2-injuries',toVersionId:'v3',effectiveAt:'2026-11-30T00:00:00Z',decidedAt:'2026-11-29T00:00:00Z'}]),'v3');
});
test('challenger picks must be saved before kickoff with real prices',()=>{
 assert.doesNotThrow(()=>validateChallengerPick(pick(),now));
 assert.doesNotThrow(()=>validateChallengerPick(pick({side:null,homeSpread:null}),now));
 for(const bad of [{startTime:'2026-10-20T15:00:30Z'},{capturedAt:'2026-10-22T01:00:00Z'},{capturedAt:'2026-10-21T00:00:00Z',startTime:'2026-10-20T23:00:00Z'},{odds:-50},{side:'over'},{homeSpread:null},{sport:'xfl'},{id:'bad id'},{stakeUnits:50}])
  assert.throws(()=>validateChallengerPick(pick(bad),now),JSON.stringify(bad));
});
test('manifest, results, scoreboards and promotions are validated',()=>{
 const manifest={schema:'big-vin-versions/1',id:'versions-2026-10-19',generatedAt:'2026-10-19T12:00:00Z',versions:[{id:'v1',label:'Playbook v1',role:'live',createdAt:'2026-10-19T05:00:00Z',frozenAt:'2026-10-19T05:00:00Z',tag:'playbook-v1-2026-10-19'},{id:'v2-injuries',label:'Injury and lineup news',role:'challenger',sports:['nfl'],parent:'v1',createdAt:'2026-10-19T12:00:00Z',idea:'injuries'}]};
 assert.doesNotThrow(()=>validateManifest(manifest));
 assert.throws(()=>validateManifest({...manifest,versions:[...manifest.versions,manifest.versions[0]]}),/unique/);
 assert.throws(()=>validateManifest({...manifest,schema:'other'}));
 assert.doesNotThrow(()=>validateChallengerResult({pickId:'a',status:'completed',homeScore:24,awayScore:20,gradedAt:'2026-10-22T04:00:00Z',closingHomeSpread:-4.5}));
 assert.throws(()=>validateChallengerResult({pickId:'a',status:'completed',gradedAt:'2026-10-22T04:00:00Z'}),/scores/);
 const board={schema:'big-vin-scoreboard/1',id:'scoreboard-2026-10-27',weekKey:'2026-W07',publishedFor:'2026-10-27',liveVersionId:'v1',entries:[{versionId:'v1',role:'live',decision:'kept',record:{wins:8,losses:6}},{versionId:'v2-injuries',role:'challenger',decision:'continuing'}],won:['Injury news caught the Eagles QB change.'],lost:[],kept:['v2-injuries'],dropped:[],lessonEntryId:'nfl-2026-w07-review'};
 assert.doesNotThrow(()=>validateScoreboard(board));
 assert.throws(()=>validateScoreboard({...board,publishedFor:'2026-10-26'}),/Tuesday/);
 assert.throws(()=>validateScoreboard({...board,entries:[{versionId:'v1',role:'live',decision:'maybe'}]}));
 assert.doesNotThrow(()=>validatePromotion(promotion));
 assert.throws(()=>validatePromotion({...promotion,evidence:{unseenGames:0}}),/unseen/);
 assert.throws(()=>validatePromotion({...promotion,effectiveAt:'2026-11-01T00:00:00Z'}),/before/);
});
test('grading uses the saved line and odds, with CLV toward the pick',()=>{
 const p=pick();
 assert.deepEqual(gradeChallenger(p,null),{outcome:'pending',pnl:null,clv:null});
 const win=gradeChallenger(p,{status:'completed',homeScore:24,awayScore:20,closingHomeSpread:-4.5});
 assert.equal(win.outcome,'win');assert.ok(Math.abs(win.pnl-100/110)<1e-12);assert.equal(win.clv,1);
 assert.equal(gradeChallenger(p,{status:'completed',homeScore:20,awayScore:20}).outcome,'loss');
 assert.equal(gradeChallenger(pick({homeSpread:-3}),{status:'completed',homeScore:23,awayScore:20}).outcome,'push');
 assert.equal(gradeChallenger(pick({side:'away',homeSpread:-3.5}),{status:'completed',homeScore:21,awayScore:20,closingHomeSpread:-2.5}).clv,1);
 assert.equal(gradeChallenger(p,{status:'void'}).outcome,'void');
 assert.equal(gradeChallenger(pick({odds:null}),{status:'completed',homeScore:30,awayScore:0}).pnl,null);
 const s=summarizeRecord([win,{outcome:'loss',pnl:-1,clv:-0.5,stake:1},{outcome:'pending',pnl:null,clv:null}]);
 assert.equal(s.wins,1);assert.equal(s.losses,1);assert.equal(s.pending,1);assert.ok(Math.abs(s.roi-(100/110-1)/2)<1e-12);assert.equal(s.clv,0.25);assert.ok(Math.abs(s.bankroll-(500+10*(100/110-1)))<1e-9);
});
test('the challenger board keeps running records and a post-freeze live row',()=>{
 const picks=[pick(),pick({id:'b',gameId:'402',weekKey:'2026-W08',startTime:'2026-10-29T00:15:00Z'}),pick({id:'c',versionId:'v3-sizing',gameId:'401'})];
 const results=[{pickId:'v2-injuries:nfl:401',status:'completed',homeScore:24,awayScore:20},{pickId:'b',status:'completed',homeScore:10,awayScore:20},{pickId:'c',status:'completed',homeScore:24,awayScore:20}];
 const liveForecasts=[{sport:'nfl',weekKey:'2026-W07',capturedAt:'2026-10-20T13:00:00Z',side:'home',marketHomeSpread:-3.5,odds:-110,result:{status:'completed',homeScore:24,awayScore:20}},{sport:'nfl',weekKey:'2026-W07',capturedAt:'2026-10-18T13:00:00Z',side:'home',marketHomeSpread:-3.5,odds:-110,result:{status:'completed',homeScore:0,awayScore:20}}];
 const weeks=challengerBoard({picks,results,liveForecasts,manifest:{versions:[{id:'v2-injuries',label:'Injury news'}]}});
 assert.deepEqual(weeks.map(w=>w.weekKey),['2026-W08','2026-W07']);
 const w8=weeks[0].challengers.find(c=>c.versionId==='v2-injuries');
 assert.equal(w8.label,'Injury news');assert.equal(w8.week.losses,1);assert.equal(w8.running.wins,1);assert.equal(w8.running.losses,1);
 const live=weeks[1].live[0];assert.equal(live.versionId,'v1');assert.equal(live.week.wins,1);assert.equal(live.week.losses,0,'pre-freeze live pick excluded');
});
test('the learning-loop migration only adds tables and indexes',()=>{
 const files=readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort();
 assert.equal(files.at(-1),'0005_playbook_learning_loop.sql');
 const sql=readFileSync(new URL('../drizzle/0005_playbook_learning_loop.sql',import.meta.url),'utf8');
 for(const statement of sql.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))assert.match(statement,/^CREATE (TABLE|INDEX) `(challenger_picks|challenger_results|playbook_manifests|promotions|scoreboards|challenger_picks_\w+|playbook_manifests_\w+|promotions_\w+|scoreboards_\w+)`/);
 const db=new DatabaseSync(':memory:');
 for(const f of files.slice(0,-1))for(const s of readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8').split('--> statement-breakpoint'))if(s.trim())db.exec(s);
 const before=db.prepare("SELECT name,sql FROM sqlite_master ORDER BY name").all();
 for(const s of sql.split('--> statement-breakpoint'))if(s.trim())db.exec(s);
 const after=db.prepare("SELECT name,sql FROM sqlite_master ORDER BY name").all();
 for(const t of before)assert.deepEqual(after.find(x=>x.name===t.name),t,'existing schema unchanged: '+t.name);
});
