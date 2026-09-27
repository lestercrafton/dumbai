import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {adaptEventSummary,discoverCollegeEvents,knownCollegeEvents,recoverCollegeEvents} from './collector-summary.mjs';
import {normalizeScoreboard} from './feeds/adapter.mjs';

const date='2026-09-26',start='2026-09-26T19:00:00Z';
const list=(ids)=>({count:ids.length,pageCount:1,pageIndex:1,items:ids.map(id=>({$ref:`http://sports.core.api.espn.com/v2/sports/football/leagues/college-football/events/${id}?lang=en&region=us`}))});
const competition=(home,away,status='post')=>({date:start,status:{type:{state:status,completed:status==='post'}},competitors:[{homeAway:'home',team:{id:String(home),displayName:`Home ${home}`},score:'24'},{homeAway:'away',team:{id:String(away),displayName:`Away ${away}`},score:'21'}]});
const core=(id,home,away)=>({id:String(id),date:start,competitions:[{competitors:[{id:String(home),homeAway:'home'},{id:String(away),homeAway:'away'}]}]});
const summary=(id,home,away)=>({header:{id:String(id),date:start,season:{year:2026,type:2},week:4,status:{type:{state:'post',completed:true}},competitions:[competition(home,away)]},pickcenter:[{provider:{id:'1'},pointSpread:{home:{close:{line:'-7',odds:'-110'}}}}]});

test('core index discovers the full card and verified exact summaries recover scores without hindsight odds',async()=>{
 const board={sourceUrl:`https://site.api.espn.com/scoreboard?groups=80&dates=20260926`,payload:{events:[{id:'1'}]}};
 const archived={event:{id:'3',date:start,competitions:[{competitors:[{homeAway:'home',team:{id:'103'}},{homeAway:'away',team:{id:'203'}}]}]},date,sourceGroup:'80',scheduleSourceUrl:board.sourceUrl,scheduleObservedAt:'2026-09-25T12:00:00Z'};
 const calls=[];
 const read=async url=>{
  calls.push(url);const parsed=new URL(url),id=parsed.searchParams.get('event');
  if(parsed.pathname.endsWith('/events'))return list(parsed.searchParams.get('groups')==='80'?['1','2','3']:['2','4']);
  if(parsed.hostname==='sports.core.api.espn.com')return core(parsed.pathname.split('/').at(-1),100+Number(parsed.pathname.split('/').at(-1)),200+Number(parsed.pathname.split('/').at(-1)));
  return summary(id,100+Number(id),200+Number(id));
 };
 const discovered=await discoverCollegeEvents([board],[archived],date,date,read);
 assert.deepEqual(discovered.failures,[]);assert.equal(discovered.enumerated,5);assert.equal(discovered.discovered,4);assert.equal(discovered.coreVerified,2);
 assert.equal(discovered.events.find(e=>e.event.id==='2').sourceGroup,'80');
 const saved=[];const recovered=await recoverCollegeEvents([board],discovered.events,read,b=>saved.push(b));
 assert.equal(recovered.requested,3);assert.equal(recovered.boards.length,3);assert.deepEqual(recovered.failures,[]);
 assert.deepEqual(recovered.boards.map(b=>b.payload.events[0].id).sort(),['2','3','4']);
 for(const board of recovered.boards){
  const game=normalizeScoreboard(board.payload,'cfb',{sourceUrl:board.sourceUrl,retrievedAt:board.observedAt}).games[0];
  assert.equal(game.homeScore,24);assert.equal(game.awayScore,21);assert.equal(game.market,null);
  assert.equal(board.payload.events[0].competitions[0].odds.length,0);
  assert.match(board.scheduleSourceUrl,/sports\.core\.api\.espn\.com/);
  assert.equal(new URL(board.scheduleSourceUrl).searchParams.get('groups'),board.sourceGroup);
 }
 assert.equal(saved.length,3);assert.equal(calls.filter(url=>url.includes('/summary?')).length,3);
 assert.equal(calls.filter(url=>url.includes('/events/')).length,2);
});

test('a summary with swapped teams is rejected despite matching event ID',()=>{
 const known={event:{id:'2',competitions:[{competitors:[{homeAway:'home',team:{id:'102'}},{homeAway:'away',team:{id:'202'}}]}]}};
 assert.throws(()=>adaptEventSummary(summary('2','202','102'),known),/identity/);
});

test('incomplete core enumeration is audited and does not create an unverified game',async()=>{
 const read=async url=>{
  const parsed=new URL(url);
  if(parsed.pathname.endsWith('/events'))return parsed.searchParams.get('groups')==='80'?{count:2,pageCount:1,pageIndex:1,items:list(['2']).items}:list([]);
  return core('2','102','202');
 };
 const discovered=await discoverCollegeEvents([],[],date,date,read);
 assert.equal(discovered.failures.length,1);assert.match(discovered.failures[0].error,/returned 1 of 2/);
 assert.equal(discovered.discovered,1);
 const invalid=await discoverCollegeEvents([],[],date,date,async url=>{
  const parsed=new URL(url);
  if(parsed.pathname.endsWith('/events'))return parsed.searchParams.get('groups')==='80'?list(['2']):list([]);
  return core('9','102','202');
 });
 assert.equal(invalid.events.length,0);assert.match(invalid.failures[0].error,/identity/);
});

test('later hourly refreshes reuse verified archive teams and still request current scores',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'vin-core-archive-'));
 try{
  const directory=path.join(root,'2026-09-26');fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory,'cfb-2026-09-26-2026-09-26-2.json'),JSON.stringify({date,sourceUrl:'https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=2',sourceGroup:'80',scheduleSourceUrl:'https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/events?dates=20260926&limit=1000&groups=80',scheduleObservedAt:'2026-09-26T17:00:00Z',observedAt:'2026-09-26T18:00:00Z',payload:adaptEventSummary(summary('2','102','202'),{event:{id:'2',competitions:[{competitors:competition('102','202').competitors}]}})}));
  const known=knownCollegeEvents(root,date,date);assert.equal(known.length,1);assert.equal(known[0].sourceGroup,'80');
  const requests=[];const read=async url=>{
   requests.push(url);const parsed=new URL(url);
   if(parsed.pathname.endsWith('/events'))return list(parsed.searchParams.get('groups')==='80'?['2']:[]);
   if(parsed.pathname.endsWith('/summary'))return summary('2','102','202');
   throw new Error('Core event detail should be cached by the verified archive.');
  };
  const found=await discoverCollegeEvents([],known,date,date,read);
  assert.equal(found.coreVerified,0);assert.deepEqual(found.failures,[]);
  const recovered=await recoverCollegeEvents([],found.events,read);
  assert.equal(recovered.boards.length,1);assert.equal(recovered.boards[0].payload.events[0].competitions[0].odds.length,0);
  assert.equal(requests.filter(url=>url.includes('/events/')).length,0);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
