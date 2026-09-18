import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {normalizeRestoredState,relocatePaths,recoverTodayJournal,verifyBaseball,ensureBaseballHistory,compactCollegeRegistry,packCheckpoint,prepareCloudState} from './cloud-state.mjs';

const json=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value));};
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
function temporary(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'big-vin-cloud-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
const floors={games:3,seasons:{2024:1,2025:1,2026:1}};
function history(dataDir,{count=3,dateMax='2026-09-17'}={}){
 fs.mkdirSync(dataDir,{recursive:true});const rows=Array.from({length:count},(_,i)=>({gamePk:i+1,season:2024+i,date:i===2?dateMax:`${2024+i}-06-01`,homeId:1,awayId:2,home_pitcher_appearances_complete:true,away_pitcher_appearances_complete:true,...Object.fromEntries(['home','away'].flatMap(side=>['batting','pitching','fielding'].map(group=>[`${side}_${group}_present`,true])))}));
 const body=rows.map(JSON.stringify).join('\n')+'\n';fs.writeFileSync(path.join(dataDir,'games.jsonl'),body);
 fs.writeFileSync(path.join(dataDir,'pitcher-appearances.jsonl'),rows.flatMap(row=>[1,2].map(teamId=>JSON.stringify({gamePk:row.gamePk,teamId,playerId:teamId}))).join('\n')+'\n');
 const seasons=Object.fromEntries(rows.map(row=>[row.season,1]));
 json(path.join(dataDir,'latest-manifest.json'),{validation:{status:'pass',games:count},summary:{cumulativeGames:count,pitcherGames:count,dateMin:rows[0].date,dateMax:rows.at(-1).date,seasons},pitcherAudit:{pitcherAppearances:count*2},outputs:{'games.jsonl':{sha256:createHash('sha256').update(body).digest('hex')}}});
}
const publicStatus={games:3,pitcherGames:6,seasons:[2024,2025,2026],completedThrough:'2026-09-17'};
const response=body=>async()=>({ok:true,json:async()=>body});
function board(id,{group='80',observedAt='2026-09-17T12:00:00Z',summary=false,verified=true}={}){
 const scheduleSourceUrl=`https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=${group}&dates=20260919`;
 return {sourceUrl:summary?`https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=${id}`:scheduleSourceUrl,observedAt,...(summary?{sourceGroup:group,...(verified?{scheduleSourceUrl,scheduleObservedAt:observedAt}:{})}:{}),payload:{events:[{id:String(id),date:'2026-09-19T18:00:00Z',competitions:[{competitors:[{homeAway:'home',team:{id:'1'}},{homeAway:'away',team:{id:'2'}}],odds:[{spread:-4}]}]}]}};
}

test('relocation fixes runner artifacts but preserves exact frozen journal body',t=>{
 const root=temporary(t),old='/Users/old/.local/share/big-vin/collections/run';
 const state={collections:{mlb:{artifact:old}},snapshots:{mlb:{collectionArtifact:old}},entry:{evidence:[old]},url:'https://example.test/.local/share/big-vin/collections/run'};
 json(path.join(root,'daily-experiment/2026-09-18/state.json'),state);
 json(path.join(root,'daily-experiment/run-owner.json'),{pid:1});fs.writeFileSync(path.join(root,'daily-experiment/run.lock'),'');
 normalizeRestoredState({stateRoot:root});const result=read(path.join(root,'daily-experiment/2026-09-18/state.json'));
 assert.equal(result.collections.mlb.artifact,path.join(root,'collections/run'));assert.equal(result.snapshots.mlb.collectionArtifact,path.join(root,'collections/run'));
 assert.deepEqual(result.entry,state.entry);assert.equal(result.url,state.url);assert.equal(fs.existsSync(path.join(root,'daily-experiment/run-owner.json')),false);assert.equal(fs.existsSync(path.join(root,'daily-experiment/run.lock')),false);
 assert.throws(()=>relocatePaths('/old/.local/share/big-vin/../secret',root),/traversal/);
});

test('public journal recovery retains canonical fields while requiring recollection',async t=>{
 const root=temporary(t),original={id:'daily-all-sports-v1-2026-09-18',sport:'all',weekKey:'2026-09-14',kind:'review',modelVersion:'v1',title:'daily',learned:'original',decision:'unchanged',priors:[],evidence:['frozen'],nextTest:'observe',publishedAt:'later',extra:'omit'};
 await recoverTodayJournal({stateRoot:root,now:new Date('2026-09-18T20:00:00Z'),fetchImpl:response({entries:[original]})});
 const state=read(path.join(root,'daily-experiment/2026-09-18/state.json'));assert.equal(state.status,'partial');assert.deepEqual(state.collections,{});assert.equal(Object.keys(state.entry).length,11);assert.equal(state.entry.learned,'original');assert.equal(state.entry.publishedAt,undefined);
 const second=await recoverTodayJournal({stateRoot:root,now:new Date('2026-09-18T20:00:00Z'),fetchImpl:()=>assert.fail('must not refetch')});assert.equal(second.reason,'checkpoint-exists');
});

test('verified complete history passes and stricter published coverage blocks regression',async t=>{
 const root=temporary(t);history(root);
 const result=await verifyBaseball({dataDir:root,floors,publishedStatus:publicStatus});assert.equal(result.games,3);assert.equal(result.pitcherAppearances,6);
 await assert.rejects(verifyBaseball({dataDir:root,floors,publishedStatus:{...publicStatus,games:4}}),/at least 4/);
 await assert.rejects(verifyBaseball({dataDir:root,floors,publishedStatus:{...publicStatus,completedThrough:'2026-09-18'}}),/regress/);
 await assert.rejects(verifyBaseball({dataDir:root,floors,publishedStatus:{...publicStatus,pitcherGames:7}}),/Pitcher appearance history/);
});

test('manifest hashes and pitcher files must support claimed counts',async t=>{
 const root=temporary(t);history(root);fs.appendFileSync(path.join(root,'games.jsonl'),'\n');
 await assert.rejects(verifyBaseball({dataDir:root,floors,publishedStatus:publicStatus}),/manifest/);
 history(root);fs.writeFileSync(path.join(root,'pitcher-appearances.jsonl'),JSON.stringify({gamePk:1,teamId:1,playerId:1})+'\n');
 await assert.rejects(verifyBaseball({dataDir:root,floors,publishedStatus:publicStatus}),/missing a normalized game/);
});

test('cold history bootstraps from public sources without any publication',async t=>{
 const root=temporary(t);let args,calls=0;
 const result=await ensureBaseballHistory({dataDir:root,floors,now:new Date('2026-09-18T20:00:00Z'),fetchImpl:async(url,options)=>{calls++;assert.equal(options.method,undefined);assert.match(url,/\/api\/baseball-data$/);return {ok:true,json:async()=>({collection:publicStatus})};},runHistory:async value=>{args=value;history(root);}});
 assert.equal(result.bootstrapped,true);assert.equal(calls,1);assert.deepEqual(args.slice(1,9),['--mode','history','--seasons','2024,2025,2026','--as-of','2026-09-18','--pitchers','--skip-current']);
 const warm=await ensureBaseballHistory({dataDir:root,floors,fetchImpl:response({collection:publicStatus}),runHistory:()=>assert.fail('must not rebuild valid history')});assert.equal(warm.bootstrapped,false);
});

test('failed bootstrap and unavailable remote floor cannot permit publication',async t=>{
 const root=temporary(t);
 await assert.rejects(ensureBaseballHistory({dataDir:root,floors,fetchImpl:response({collection:publicStatus}),runHistory:async()=>history(root,{count:2})}),/at least 3/);
 await assert.rejects(ensureBaseballHistory({dataDir:root,floors,fetchImpl:async()=>({ok:false,status:503}),runHistory:()=>assert.fail('network failure is not missing history')}),/publishing remains blocked/);
});
test('a cold rebuild includes new seasons after the migration year',async t=>{
 const root=temporary(t);let args;
 await ensureBaseballHistory({dataDir:root,floors,now:new Date('2027-06-01T18:00:00Z'),fetchImpl:response({collection:publicStatus}),runHistory:async value=>{args=value;history(root);}});
 assert.equal(args[args.indexOf('--seasons')+1],'2024,2025,2026,2027');
});

test('compact registry retains all archives and only verified group membership',t=>{
 const root=temporary(t);
 for(let i=0;i<50;i++)json(path.join(root,String(i).padStart(3,'0'),'cfb-board.json'),board(100+i));
 json(path.join(root,'050','cfb-fcs.json'),board(100,{group:'81',observedAt:'2026-09-18T12:00:00Z'}));
 json(path.join(root,'051','cfb-summary.json'),board(200,{summary:true}));json(path.join(root,'052','cfb-unverified.json'),board(201,{summary:true,verified:false}));
 const entries=compactCollegeRegistry(root);assert.equal(entries.length,51);assert.equal(entries.find(b=>b.payload.events[0].id==='100').sourceGroup,'80');assert.equal(entries.some(b=>b.payload.events[0].id==='201'),false);assert.equal(entries[0].payload.events[0].competitions[0].odds,undefined);assert.equal(entries[0].observedAt,'2026-09-17T12:00:00Z');
});

test('checkpoint pack excludes secrets, logs, locks, baseball data, and raw scoreboards',t=>{
 const root=temporary(t),stateRoot=path.join(root,'state'),output=path.join(root,'packed');
 json(path.join(stateRoot,'daily-experiment/2026-09-18/state.json'),{entry:{id:'frozen'}});json(path.join(stateRoot,'daily-experiment/2026-09-18/report.json'),{report:true});json(path.join(stateRoot,'daily-experiment/run-owner.json'),{pid:1});
 json(path.join(stateRoot,'collections/run/report.json'),{finished:true});json(path.join(stateRoot,'collections/run/cfb-raw.json'),board(99));json(path.join(stateRoot,'baseball-stats/private.json'),{});fs.writeFileSync(path.join(stateRoot,'daily-experiment/2026-09-18/collector.log'),'not packed');
 const result=packCheckpoint({stateRoot,output});assert.equal(result.files,4);assert.equal(result.collegeEvents,1);assert.equal(fs.existsSync(path.join(output,'baseball-stats')),false);assert.equal(fs.existsSync(path.join(output,'collections/run/cfb-raw.json')),false);assert.equal(fs.existsSync(path.join(output,'daily-experiment/run-owner.json')),false);assert.equal(fs.existsSync(path.join(output,'daily-experiment/2026-09-18/collector.log')),false);
 assert.equal(compactCollegeRegistry(path.join(output,'collections')).length,1);assert.throws(()=>packCheckpoint({stateRoot,output}),/must be empty/);
});

test('bootstrap seeds only missing checkpoints and archive identities',async t=>{
 const root=temporary(t),stateRoot=path.join(root,'state'),bootstrapDir=path.join(root,'bootstrap');
 json(path.join(bootstrapDir,'daily-experiment/2026-01-01/state.json'),{value:'bootstrap'});json(path.join(stateRoot,'daily-experiment/2026-01-01/state.json'),{value:'restored'});json(path.join(bootstrapDir,'cfb-archive/cfb-99.json'),board(99));
 await prepareCloudState({stateRoot,bootstrapDir,skipHistory:true,fetchImpl:response({entries:[]})});assert.equal(read(path.join(stateRoot,'daily-experiment/2026-01-01/state.json')).value,'restored');assert.equal(compactCollegeRegistry(path.join(stateRoot,'collections')).length,1);
});
test('checkpoint retention drops old completed snapshots while preserving unresolved work and CFB membership',t=>{
 const root=temporary(t),stateRoot=path.join(root,'state'),output=path.join(root,'packed');
 json(path.join(stateRoot,'daily-experiment/2026-06-01/state.json'),{status:'completed'});
 json(path.join(stateRoot,'daily-experiment/2026-06-02/state.json'),{status:'partial',collections:{cfb:{artifact:path.join(stateRoot,'collections/2026-06-02-run')}}});
 json(path.join(stateRoot,'collections/2026-06-01-run/report.json'),{finished:true});
 json(path.join(stateRoot,'collections/2026-06-01-run/cfb-old.json'),board(123));
 json(path.join(stateRoot,'collections/2026-06-02-run/report.json'),{finished:false});
 packCheckpoint({stateRoot,output,now:new Date('2026-09-18T18:00:00Z')});
 assert.equal(fs.existsSync(path.join(output,'daily-experiment/2026-06-01')),false);
 assert.equal(fs.existsSync(path.join(output,'collections/2026-06-01-run/report.json')),false);
 assert.equal(fs.existsSync(path.join(output,'daily-experiment/2026-06-02/state.json')),true);
 assert.equal(fs.existsSync(path.join(output,'collections/2026-06-02-run/report.json')),true);
 assert.equal(compactCollegeRegistry(path.join(output,'collections')).length,1);
});
