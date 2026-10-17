import test from 'node:test';
import assert from 'node:assert/strict';
import {collectSourceRange,boardDates,boardBatches,mergeSavedBoard} from './collector-sources.mjs';
import {adaptEventSummary,recoverCollegeEvents} from './collector-summary.mjs';
import {normalizeScoreboard} from './feeds/adapter.mjs';

test('range outage retains successful dates and identifies holes without inventing coverage',async()=>{
 const result=await collectSourceRange('mlb',{date:'2026-09-15',endDate:'2026-09-17'},async url=>{
  const dates=new URL(url).searchParams.get('dates');
  if(dates.includes('-')||dates==='20260916')throw new Error('HTTP 400');
  return {events:[{id:dates}]};
 });
 assert.deepEqual(boardDates(result.boards),['2026-09-15','2026-09-17']);
 assert.deepEqual(result.missing,[{date:'2026-09-16',group:null}]);
 assert.equal(result.failures.length,2);
});

test('college compact-date fallback keeps both groups and a visible completeness warning',async()=>{
 const calls=[];
 const result=await collectSourceRange('cfb',{date:'2026-09-19'},async url=>{
  calls.push(url);if(new URL(url).searchParams.get('dates').includes('-'))throw new Error('HTTP 400');
  return {events:[{id:new URL(url).searchParams.get('groups')}]};
 });
 assert.equal(calls.length,4);assert.equal(result.boards.length,2);assert.equal(result.missing.length,0);
 assert.ok(result.boards.every(b=>b.warnings.some(w=>w.includes('incomplete'))));
});

test('batches honor protected endpoint limit without dropping any observations',()=>{
 const boards=Array.from({length:127},(_,id)=>({id}));const batches=boardBatches(boards);
 assert.deepEqual(batches.map(b=>b.length),[30,30,30,30,7]);assert.deepEqual(batches.flat(),boards);
});

test('partial schedule preserves omitted game and exact old quote timestamp',()=>{
 const old={id:'omitted',retrievedAt:'2026-09-15T00:00:00Z',market:{observedAt:'2026-09-15T00:00:00Z',homeSpread:3}};
 const current={games:[{id:'new'}],warnings:[],retrievedAt:'2026-09-17T12:00:00Z'};
 const merged=mergeSavedBoard({games:[old]},current);
 assert.equal(merged.games[0],old);assert.match(merged.warnings[0],/dated observations/);
 assert.equal(mergeSavedBoard(merged,{...current,games:[{id:'omitted',status:'completed'}]}).games.filter(g=>g.id==='omitted').length,1);
});
const competition={date:'2026-09-19T20:00:00Z',status:{type:{state:'pre'}},competitors:[{homeAway:'home',team:{id:'84',displayName:'Indiana'}},{homeAway:'away',team:{id:'98',displayName:'Western Kentucky'}}]};
const known={event:{id:'401858449',competitions:[competition]},sourceGroup:'80',scheduleSourceUrl:'https://site.api.espn.com/scoreboard?groups=80',scheduleObservedAt:'2026-09-15T12:00:00Z'};
const summary={header:{id:'401858449',season:{year:2026,type:2},week:3,competitions:[competition]},pickcenter:[{provider:{id:'1'},pointSpread:{home:{close:{line:'-44.5',odds:'-112'}},away:{close:{line:'+44.5',odds:'-108'}}}}]};

test('summary preserves actual side prices and rejects mismatched identity',()=>{
 const game=normalizeScoreboard(adaptEventSummary(summary,known),'cfb').games[0];
 assert.equal(game.week,3);assert.equal(game.market.homeSpread,-44.5);assert.equal(game.market.awaySpreadPrice,-108);assert.equal(game.homeScore,null);
 assert.throws(()=>adaptEventSummary({...summary,header:{...summary.header,id:'wrong'}},known),/identity/);
 const changed={...summary,header:{...summary.header,competitions:[{...competition,competitors:competition.competitors.slice(0,1)}]}};
 assert.throws(()=>adaptEventSummary(changed,known),/identity/);
 assert.equal(normalizeScoreboard(adaptEventSummary({...summary,pickcenter:[]},known),'cfb').games[0].market,null);
});

test('known omitted event uses current summary with original schedule membership and records failures',async()=>{
 const archived=[];
 const success=await recoverCollegeEvents([], [known], async()=>summary,b=>archived.push(b));
 assert.equal(success.boards.length,1);assert.equal(success.boards[0].sourceGroup,'80');assert.equal(success.boards[0].scheduleObservedAt,known.scheduleObservedAt);
 assert.match(success.boards[0].sourceUrl,/summary\?event=401858449$/);assert.equal(archived.length,1);
 const failed=await recoverCollegeEvents([], [known], async()=>{throw new Error('outage');});
 assert.equal(failed.boards.length,0);assert.equal(failed.failures[0].gameId,'401858449');
});

test('recent summary archives retain original schedule membership after original directory ages out',async()=>{
 const fs=await import('node:fs');const os=await import('node:os');const path=await import('node:path');
 const {knownCollegeEvents}=await import('./collector-summary.mjs');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'vin-archive-test-'));
 try {
  fs.mkdirSync(path.join(root,'2026-09-17'));
  fs.writeFileSync(path.join(root,'2026-09-17','cfb-summary.json'),JSON.stringify({sourceUrl:'https://site.api.espn.com/summary?event=401858449',sourceGroup:'80',scheduleSourceUrl:known.scheduleSourceUrl,scheduleObservedAt:known.scheduleObservedAt,observedAt:'2026-09-17T12:00:00Z',payload:adaptEventSummary(summary,known)}));
  const events=knownCollegeEvents(root,'2026-09-17','2026-09-23');
  assert.equal(events.length,1);assert.equal(events[0].sourceGroup,'80');assert.equal(events[0].scheduleObservedAt,known.scheduleObservedAt);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
