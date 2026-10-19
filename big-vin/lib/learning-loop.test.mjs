import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {headlineSaysOut,parseInjuries,scoreboardLeaders,playerStatus} from './injuries.mjs';
import {snapshotRun,spreadObservations,spreadAt} from './odds-log.mjs';
import {capturePick,closeEvent,gradeEvents,mergeEvents,versionRecords,summarize,currentPicks} from './shadow-ledger.mjs';
import {loadManifest,variantsFor,predict} from './playbook.mjs';
import {compare} from './promotion.mjs';
import {manifestDocument,pickDocument,resultDocument,pendingDocuments,queue,readQueue} from './playbook-outbox.mjs';
import {conditions,pickPlace,venueOf} from './weather.mjs';
import * as site from '../site/lib/playbook.mjs';

const KICK='2026-10-17T16:00:00Z';
test('out headlines name the player and are not hedged',()=>{
 assert.equal(headlineSaysOut('Mississippi State QB Kamario Taylor, RB Fluff Bothwell out vs. LSU','Kamario Taylor'),true);
 assert.equal(headlineSaysOut('Eagles place Jalen Hurts on injured reserve','Jalen Hurts'),true);
 assert.equal(headlineSaysOut('Jalen Hurts placed on injured reserve','Jalen Hurts'),true);
 assert.equal(headlineSaysOut('Kamario Taylor questionable, could be out vs. LSU','Kamario Taylor'),false);
 assert.equal(headlineSaysOut('Fluff Bothwell out vs. LSU','Kamario Taylor'),false);
});
test('news must be published before kickoff and before the capture',()=>{
 const p={athleteId:'5177084',name:'Kamario Taylor'};
 const news=[{headline:'Mississippi State QB Kamario Taylor, RB Fluff Bothwell out vs. LSU',published:'2026-10-17T15:28:00Z',url:'u',observedAt:'x'}];
 assert.equal(playerStatus(p,{injuries:new Map(),news,kickoff:KICK,now:'2026-10-17T15:40:00Z'}).out,true);
 assert.equal(playerStatus(p,{injuries:new Map(),news,kickoff:KICK,now:'2026-10-17T15:00:00Z'}).out,false,'not yet published at capture');
});
test('injury report status and athlete ids are parsed with their source',()=>{
 const payload={injuries:[{id:'21',injuries:[{status:'Injured Reserve',date:'2026-10-17T20:02Z',athlete:{displayName:'Jalen Hurts',position:{abbreviation:'QB'},links:[{href:'https://www.espn.com/nfl/player/_/id/4040715/jalen-hurts'}]}}]}]};
 const m=parseInjuries(payload,{url:'inj',observedAt:'2026-10-18T12:00:00Z'});
 const s=playerStatus({athleteId:'4040715',name:'Jalen Hurts'},{injuries:m,news:[],kickoff:'2026-10-18T17:00:00Z',now:'2026-10-18T12:00:00Z'});
 assert.equal(s.out,true);assert.equal(s.evidence[0].source,'espn-injuries');assert.equal(s.evidence[0].reported,'2026-10-17T20:02Z');
});
test('season passing leaders come from scoreboard competitors',()=>{
 const ev={competitions:[{competitors:[{team:{id:'344'},leaders:[{name:'passingLeader',leaders:[{displayValue:'1500 YDS',athlete:{id:5177084,displayName:'Kamario Taylor',position:{abbreviation:'QB'}}}]}]}]}]};
 const l=scoreboardLeaders(ev,'cfb',{url:'sb',observedAt:'t'});
 assert.deepEqual(l['344'].map(x=>[x.athleteId,x.name,x.source]),[['5177084','Kamario Taylor','espn-scoreboard-leaders']]);
});

const game=(over={})=>({id:'401',sport:'nfl',season:2026,week:7,startTime:'2026-10-25T17:00:00Z',status:'scheduled',home:{id:'1',name:'Home',abbreviation:'HOM'},away:{id:'2',name:'Away',abbreviation:'AWY'},
 moneylineMarket:{provider:'Draft Kings',observedAt:'2026-10-20T12:00:00Z',homeSpread:-3,homeSpreadPrice:-110,awaySpreadPrice:-110,total:44.5,overPrice:-110,underPrice:-110,homeMoneyline:-150,awayMoneyline:130,openHomeSpread:-2.5},...over});
test('odds log keeps first-seen, changes, unchanged refreshes and one close',()=>{
 let lines=snapshotRun('nfl',[game()],[],{at:'2026-10-20T12:00:00Z',source:'s'});
 assert.deepEqual(lines.map(l=>[l.type,l.phase]),[['odds','first-seen']]);
 const r=snapshotRun('nfl',[game()],lines,{at:'2026-10-20T13:00:00Z'});lines=[...lines,...r];
 assert.deepEqual(r.map(l=>l.type),['refresh']);
 const moved=game({moneylineMarket:{...game().moneylineMarket,homeSpread:-4,observedAt:'2026-10-24T12:00:00Z'}});
 const c=snapshotRun('nfl',[moved],lines,{at:'2026-10-24T12:00:00Z'});lines=[...lines,...c];
 assert.deepEqual(c.map(l=>[l.type,l.phase,l.market.homeSpread]),[['odds','early-24-72h',-4]]);
 const close=snapshotRun('nfl',[moved],lines,{at:'2026-10-25T18:00:00Z'});lines=[...lines,...close];
 assert.deepEqual(close.map(l=>[l.type,l.market.homeSpread]),[['close',-4]]);
 assert.equal(snapshotRun('nfl',[moved],lines,{at:'2026-10-25T19:00:00Z'}).length,0,'close written once');
 assert.equal(spreadAt(lines,'401','2026-10-22T00:00:00Z').market.homeSpread,-3);
});

test('shadow picks are append-only revisions with close, CLV and grading',()=>{
 const g=game();const market={...g.moneylineMarket};
 const p1=capturePick([],{version:'X',sport:'nfl',game:g,predictedMargin:5,market,reasoning:{},at:'2026-10-20T12:00:00Z'});
 assert.equal(p1.side,'home');assert.equal(p1.id,'X:nfl:401:r1');assert.equal(p1.odds,-110);
 assert.equal(capturePick([p1],{version:'X',sport:'nfl',game:g,predictedMargin:6,market,reasoning:{},at:'2026-10-21T12:00:00Z'}),null,'same side adds nothing');
 const p2=capturePick([p1],{version:'X',sport:'nfl',game:g,predictedMargin:1,market,reasoning:{},at:'2026-10-21T12:00:00Z'});
 assert.equal(p2.side,'away');assert.equal(p2.supersedes,p1.id);
 let events=mergeEvents([p1],[p2],[p1]);assert.equal(events.length,2);
 const obs=[{gameId:'401',at:'2026-10-25T16:00:00Z',observedAt:'2026-10-25T16:00:00Z',homeSpread:-1.5,homeSpreadPrice:-110,awaySpreadPrice:-110}];
 const close=closeEvent(obs,{sport:'nfl',gameId:'401',startTime:g.startTime,at:'2026-10-25T18:00:00Z'});events=[...events,close];
 const final=new Map([['401',{id:'401',startTime:g.startTime,status:'completed',completed:true,homeScore:20,awayScore:21,sourceUrl:'sb'}]]);
 const grades=gradeEvents(events,final,{at:'2026-10-25T21:00:00Z'});
 assert.equal(grades.length,1);assert.equal(grades[0].pickId,p2.id);assert.equal(grades[0].outcome,'win');
 assert.equal(grades[0].clvPoints,1.5,'took away +3, closed away +1.5: beat the close');
 events=[...events,...grades];assert.equal(gradeEvents(events,final,{at:'2026-10-25T22:00:00Z'}).length,0);
 const s=summarize(versionRecords(events,'X'));assert.equal(s.wins,1);assert.equal(s.clvCoverage,1);
});

test('challengers only use information features and record their inputs',()=>{
 const m=loadManifest();
 assert.deepEqual(variantsFor(m,'nfl','2026-10-18T12:00:00Z'),[]);
 const v=variantsFor(m,'nfl','2026-10-19T12:00:00Z');
 assert.equal(v[0].version,'bv-nfl-pb1');assert.deepEqual(v.slice(1).map(x=>x.feature).sort(),['line-move','qb-out-unpriced','weather-severe']);
 for(const c of m.challengers)assert.ok(['qb-out-unpriced','scorer-out-unpriced','line-move','weather-severe'].includes(c.feature));
 const base={version:'live',predictedMargin:4,source:'slate'};
 const qb=v.find(x=>x.feature==='qb-out-unpriced');
 const players={home:{players:[{name:'Q',athleteId:'9',out:true,evidence:[{effectiveOut:true,source:'espn-team-news',published:'2026-10-21T00:00:00Z'}]}]},away:{players:[]}};
 // The line moved 2 points against home after the news: only the rest of the 5 points applies.
 const r=predict(qb,{base,players,market:{homeSpread:-1,openHomeSpread:-3},lineAt:()=>({homeSpread:-3,at:'2026-10-20T12:00:00Z'})});
 assert.equal(r.predictedMargin,1);assert.equal(r.reasoning.adjustments[0].lineMoveTowardNews,2);
 const lm=predict(v.find(x=>x.feature==='line-move'),{base,market:{homeSpread:-5,openHomeSpread:-3}});
 assert.equal(lm.predictedMargin,6);
 const wx=predict(v.find(x=>x.feature==='weather-severe'),{base,weather:{status:'ok',severe:true,flags:['wind'],windMph:20}});
 assert.equal(wx.predictedMargin,3.2);
 assert.equal(predict(v[0],{base}).predictedMargin,4);
});
test('weather flags and venue lookup',()=>{
 assert.deepEqual(conditions({wind_speed_10m:[18],wind_gusts_10m:[20],precipitation:[0],temperature_2m:[60]}).flags,['wind']);
 assert.equal(conditions({wind_speed_10m:[5],wind_gusts_10m:[10],precipitation:[0],temperature_2m:[60]}).severe,false);
 const venue=venueOf({competitions:[{venue:{fullName:'MetLife',address:{city:'East Rutherford',state:'NJ'},indoor:false}}]});
 assert.equal(pickPlace([{admin1:'Pennsylvania'},{admin1:'New Jersey',latitude:1}],venue).latitude,1);
});

test('promotion needs the registered sample and beats on ROI and CLV',()=>{
 const m=loadManifest();
 const [row]=compare([],m,'nfl').filter(r=>r.feature==='line-move');
 assert.equal(row.decision,'collecting');assert.equal(row.checks.gradedPicks.need,m.promotion.minimums.nfl.gradedPicks);
});

test('runner documents satisfy the site learning-loop contract',()=>{
 const m=loadManifest();
 site.validateManifest(manifestDocument(m,{generatedAt:'2026-10-19T06:00:00Z'}));
 const g=game();const p=capturePick([],{version:'bv-nfl-ch-line-move-2026-10-19',sport:'nfl',game:g,predictedMargin:5,market:g.moneylineMarket,reasoning:{feature:'line-move',adjustments:[]},at:'2026-10-20T12:00:00Z'});
 site.validateChallengerPick(pickDocument(p),Date.parse('2026-10-20T12:00:01Z'));
 const grade={type:'grade',id:'grade:'+p.id,at:'2026-10-25T21:00:00Z',pickId:p.id,gameId:'401',status:'completed',homeScore:20,awayScore:17,clvPoints:0.5,sourceUrl:'sb'};
 site.validateChallengerResult(resultDocument(grade,[p,grade]));
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'outbox-'));
 const docs=pendingDocuments([p,grade]);assert.equal(queue(dir,{picks:docs.picks,results:docs.results}),2);
 assert.equal(pendingDocuments([p,grade],readQueue(dir)).picks.length,0);
});

test('Tuesday scoreboard follows the site contract',async()=>{
 const {buildScoreboard,tuesdayOf}=await import('./scoreboard.mjs');
 assert.equal(tuesdayOf('2026-10-20T14:00:00Z'),'2026-10-20');assert.equal(tuesdayOf('2026-10-21T14:00:00Z'),'2026-10-27');
 const built=buildScoreboard({nfl:[],cfb:[]},loadManifest(),{at:'2026-10-20T14:00:00Z'});
 site.validateScoreboard(built.scoreboard);
 assert.ok(built.scoreboard.entries.some(e=>e.versionId==='bv-nfl-pb1'&&e.role==='live'));
 assert.match(built.markdown,/Lessons/);
});
