import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {runnerPlan,collectionWindow,DAILY_SCHEDULE,WEEKLY_SCHEDULE,RESULTS_SCHEDULE} from './runner-plan.mjs';
import {SPORT_PATHS} from '../lib/feeds/adapter.mjs';

test('hourly and manual results always collect scores without a journal or baseball work',()=>{
 for(const input of [{eventName:'schedule',schedule:RESULTS_SCHEDULE},{eventName:'workflow_dispatch',task:'results'}]){
  assert.deepEqual(runnerPlan(input),{task:'results',collection:'recent',journal:false,weekly:false,baseball:false,refresh_baseball:false});
 }
});

test('morning and manual daily runs collect even when a daily journal may already exist',()=>{
 for(const input of [{eventName:'schedule',schedule:DAILY_SCHEDULE},{eventName:'workflow_dispatch',task:'daily'},{eventName:'workflow_dispatch'}]){
  const plan=runnerPlan(input);assert.equal(plan.collection,'full');assert.equal(plan.journal,true);assert.equal(plan.baseball,true);assert.equal(plan.weekly,false);
 }
});

test('weekly route stays separate and push/manual refresh retains explicit research refresh',()=>{
 for(const input of [{eventName:'schedule',schedule:WEEKLY_SCHEDULE},{eventName:'workflow_dispatch',task:'weekly'}]){
  assert.deepEqual(runnerPlan(input),{task:'weekly',collection:'none',journal:false,weekly:true,baseball:false,refresh_baseball:false});
 }
 for(const input of [{eventName:'push'},{eventName:'workflow_dispatch',task:'refresh'}]){
  const plan=runnerPlan(input);assert.equal(plan.collection,'full');assert.equal(plan.journal,true);assert.equal(plan.refresh_baseball,true);
 }
});

test('unknown triggers cannot accidentally create an early daily journal',()=>{
 for(const input of [{eventName:'schedule',schedule:'0 * * * *'},{eventName:'workflow_dispatch',task:'other'},{eventName:'pull_request'}])assert.throws(()=>runnerPlan(input),/Unsupported/);
});

test('recent mode uses exactly three prior Eastern dates and today for every sport',()=>{
 // UTC has crossed midnight, while Eastern is still September 19.
 const now='2026-09-20T02:00:00Z';
 for(const sport of Object.keys(SPORT_PATHS)){
  assert.deepEqual(collectionWindow(sport,true,{recent:true,now}),{start:'2026-09-16',end:'2026-09-18'});
  assert.deepEqual(collectionWindow(sport,false,{recent:true,now}),{start:'2026-09-19',end:'2026-09-19'});
 }
});

test('normal daily collection retains 21 past dates and seven upcoming dates, with CBB singles',()=>{
 const now='2026-09-20T15:00:00Z';
 for(const sport of Object.keys(SPORT_PATHS)){
  assert.deepEqual(collectionWindow(sport,true,{now}),{start:sport==='cbb'?'2026-09-13':'2026-08-30',end:'2026-09-19'});
  assert.deepEqual(collectionWindow(sport,false,{now}),{start:'2026-09-20',end:sport==='cbb'?'2026-09-20':'2026-09-26'});
 }
});

test('recent date arithmetic handles the midnight after both DST changes and year rollover',()=>{
 for(const [now,start,end,today] of [
  ['2026-03-09T04:37:00Z','2026-03-06','2026-03-08','2026-03-09'],
  ['2026-11-02T05:37:00Z','2026-10-30','2026-11-01','2026-11-02'],
  ['2027-01-01T05:37:00Z','2026-12-29','2026-12-31','2027-01-01'],
 ]){
  assert.deepEqual(collectionWindow('cfb',true,{recent:true,now}),{start,end});
  assert.deepEqual(collectionWindow('cfb',false,{recent:true,now}),{start:today,end:today});
 }
});

test('the deployed workflow cron values agree with the tested router',()=>{
 const workflow=fs.readFileSync(new URL('../../.github/workflows/big-vin-daily.yml',import.meta.url),'utf8');
 for(const schedule of [DAILY_SCHEDULE,WEEKLY_SCHEDULE,RESULTS_SCHEDULE])assert.ok(workflow.includes(`cron: '${schedule}'`),`Missing tested schedule ${schedule}`);
 assert.match(workflow,/if: steps\.plan\.outputs\.journal == 'true'/);
 assert.match(workflow,/run: node scripts\/collect-results\.mjs --results-only --recent/);
});
