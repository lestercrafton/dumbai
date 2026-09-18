import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {runDailyExperiment,collectionSucceeded} from './daily-experiment.mjs';
import {EXPERIMENT_SPORTS,dayAt,previousDay,summarizeExperimentSport} from '../lib/daily-experiment.mjs';

const now=new Date('2026-09-18T12:00:00Z');
const source=sport=>({finished:true,failures:[],reports:[{sport,coverage:[],warnings:[]}]});
function setup(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'big-vin-daily-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const calls=[],entries=[];
 const dependencies={collectSport:async sport=>{calls.push(sport);return source(sport);},collectBaseball:async()=>({games:7243,completedThrough:'2026-09-17'}),readSport:async sport=>[{sport,cohort:'live',version:'ridge-v1',modelLabel:'Experimental',days:[],overall:{},bankroll:{balance:500,days:[]}}],readLearning:async()=>entries,publish:async entry=>{entries.push(structuredClone(entry));return {inserted:true};}};
 return {root,calls,entries,dependencies};
}
test('one complete daily run includes every sport and repeated wakes do no duplicate work',async t=>{
 const x=setup(t);const a=await runDailyExperiment({...x,now});assert.equal(a.status,'completed');assert.deepEqual(x.calls,EXPERIMENT_SPORTS);assert.equal(x.entries.length,1);assert.ok(x.entries[0].evidence.some(e=>e.includes('WNBA')));
 const b=await runDailyExperiment({...x,now});assert.equal(b.status,'already-completed');assert.equal(x.calls.length,7);assert.equal(x.entries.length,1);
});
test('one failed sport preserves all other successes and retries only that sport',async t=>{
 const x=setup(t);let first=true;const collect=x.dependencies.collectSport;
 x.dependencies.collectSport=async sport=>{if(sport==='cfb'&&first){first=false;x.calls.push(sport);throw new Error('Source outage');}return collect(sport);};
 assert.equal((await runDailyExperiment({...x,now})).status,'partial');assert.equal(x.entries.length,0);
 assert.equal((await runDailyExperiment({...x,now})).status,'completed');assert.equal(x.calls.length,8);assert.equal(x.calls.at(-1),'cfb');
});
test('an uncertain successful publication resumes the frozen body without a duplicate entry',async t=>{
 const x=setup(t);x.dependencies.publish=async entry=>{x.entries.push(structuredClone(entry));throw new Error('Response lost after write');};
 assert.equal((await runDailyExperiment({...x,now})).status,'partial');const saved=JSON.stringify(x.entries[0]);
 x.dependencies.readSport=async()=>{throw new Error('Should reuse frozen report');};
 assert.equal((await runDailyExperiment({...x,now})).status,'completed');assert.equal(x.entries.length,1);assert.equal(JSON.stringify(x.entries[0]),saved);assert.equal(x.calls.length,7);
});
test('a competing live collector holds the lock even after its wrapper has exited',async t=>{
 const x=setup(t);fs.writeFileSync(path.join(x.root,'run-owner.json'),JSON.stringify({id:'other-owner',pid:null,childPid:process.pid}));
 assert.equal((await runDailyExperiment({...x,now})).status,'running');assert.equal(x.calls.length,0);assert.ok(fs.existsSync(path.join(x.root,'run-owner.json')));
});
test('completed collector artifact survives a crash before the stage checkpoint',async t=>{
 const x=setup(t),dir=path.join(x.root,'2026-09-18'),artifact=path.join(x.root,'saved-collector');fs.mkdirSync(dir);fs.mkdirSync(artifact);fs.writeFileSync(path.join(artifact,'report.json'),JSON.stringify(source('nfl')));
 fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify({runDate:'2026-09-18',today:'2026-09-18',gameDate:'2026-09-17',startedAt:now.toISOString(),collections:{nfl:{artifact,complete:false}},attempts:1}));
 assert.equal((await runDailyExperiment({...x,now})).status,'completed');assert.equal(x.calls.includes('nfl'),false);assert.equal(x.calls.length,6);
});
test('partial artifacts and failures cannot pass as completed collections',()=>{
 assert.equal(collectionSucceeded(source('mlb'),'mlb'),true);
 assert.equal(collectionSucceeded({...source('mlb'),finished:false},'mlb'),false);
 assert.equal(collectionSucceeded({...source('mlb'),failures:[{error:'missing date'}]},'mlb'),false);
 assert.equal(collectionSucceeded(source('mlb'),'wnba'),false);
});
test('research failure publishes core results once and retries research independently',async t=>{
 const x=setup(t);let attempts=0;x.dependencies.collectBaseball=async()=>{if(!attempts++)throw new Error('Statcast unavailable');return {games:7243,completedThrough:'2026-09-17'};};
 const a=await runDailyExperiment({...x,now});assert.equal(a.status,'partial');assert.equal(x.entries.length,1);assert.ok(x.entries[0].evidence.some(e=>e.includes('research refresh is unavailable')));
 assert.equal((await runDailyExperiment({...x,now})).status,'completed');assert.equal(x.calls.length,7);assert.equal(x.entries.length,1);assert.equal(attempts,2);
});
test('a competing publication cannot silently claim another body as this report',async t=>{
 const x=setup(t);x.dependencies.publish=async entry=>{x.entries.push({...entry,decision:'Different content'});return {inserted:false};};
 const r=await runDailyExperiment({...x,now});assert.equal(r.status,'partial');assert.match(r.errors[0],/different content/);
});
test('two simultaneous wakes, including stale metadata, cannot both collect',async t=>{
 const x=setup(t);fs.writeFileSync(path.join(x.root,'run-owner.json'),JSON.stringify({id:'stale',pid:null,childPid:null}));
 let unblock;const gate=new Promise(r=>unblock=r);const collect=x.dependencies.collectSport;
 x.dependencies.collectSport=async sport=>{await gate;return collect(sport);};
 const one=runDailyExperiment({...x,now}),two=runDailyExperiment({...x,now});
 const first=await Promise.race([one,two]);assert.equal(first.status,'running');unblock();
 const both=await Promise.all([one,two]);assert.equal(both.filter(r=>r.status==='completed').length,1);assert.equal(x.calls.length,7);
});
test('report rejects pooled cohorts and uses Eastern dates and unresolved bankroll values',()=>{
 const data={sport:'wnba',cohort:'live',version:'ridge-v1',modelLabel:'WNBA',days:[],bankroll:{balance:480,days:[{date:'2026-09-18',stake:null,status:'waiting-prior'}]}};
 const collection={reports:[{coverage:[{id:'g',startTime:'2026-09-18T02:00:00Z',status:'completed'}]}]};
 const r=summarizeExperimentSport('wnba',[data],collection,'2026-09-17','2026-09-18');assert.equal(r.knownGames,1);assert.equal(r.versions[0].missingCaptures,1);assert.equal(r.versions[0].todayBankroll.stake,null);
 assert.throws(()=>summarizeExperimentSport('wnba',[{...data,cohort:'recovered'}],collection,'2026-09-17','2026-09-18'));
 assert.throws(()=>summarizeExperimentSport('mlb',[data],collection,'2026-09-17','2026-09-18'));
 assert.throws(()=>summarizeExperimentSport('wnba',[data,data],collection,'2026-09-17','2026-09-18'));
 const distinct={...data,days:[{date:'2026-09-17',recorded:2}],records:[{gameId:'b',startTime:'2026-09-18T02:00:00Z'},{gameId:'c',startTime:'2026-09-18T02:00:00Z'}]};
 const identities={reports:[{coverage:[{id:'a',startTime:'2026-09-18T02:00:00Z'},{id:'b',startTime:'2026-09-18T02:00:00Z'}]}]};
 assert.equal(summarizeExperimentSport('wnba',[distinct],identities,'2026-09-17','2026-09-18').versions[0].missingCaptures,1);
 assert.equal(dayAt('2026-09-18T02:00:00Z'),'2026-09-17');assert.equal(dayAt('2026-11-01T06:30:00Z','America/Chicago'),'2026-11-01');assert.equal(previousDay('2026-03-09'),'2026-03-08');
});
