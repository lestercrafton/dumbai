import test from 'node:test';
import assert from 'node:assert/strict';
import {createRefreshResource} from './refresh-resource.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const setup=()=>{const updates=[];return {updates,resource:createRefreshResource(state=>updates.push(state)),latest:()=>updates.at(-1)};};

test('a background score check retains the board, then publishes new finals in place',async()=>{
 const {resource,latest}=setup();const original={games:[{id:'game',status:'live'}]};
 await resource.read('cfb:week',async()=>original);
 const next=deferred(),checking=resource.read('cfb:week',()=>next.promise);
 assert.equal(latest().busy,true);assert.equal(latest().data,original);
 const final={games:[{id:'game',status:'completed',homeScore:28,awayScore:21}]};
 next.resolve(final);await checking;
 assert.equal(latest().data,final);assert.equal(latest().busy,false);
});
test('a failed refresh preserves the last scores and reports the failed check',async()=>{
 const {resource,latest}=setup();const saved={wins:4,learns:1};
 await resource.read('cfb:week',async()=>saved);
 await resource.read('cfb:week',async()=>{throw new Error('Feed unavailable');});
 assert.equal(latest().data,saved);assert.equal(latest().error,'Feed unavailable');assert.equal(latest().busy,false);
});
test('switching sports clears the old scope and rejects a slow older response',async()=>{
 const {resource,latest}=setup();const old=deferred();
 const oldRead=resource.read('cfb:week',()=>old.promise);
 const next=deferred(),newRead=resource.read('nfl:week',()=>next.promise);
 assert.equal(latest().key,'nfl:week');assert.equal(latest().data,null);
 next.resolve({sport:'nfl'});await newRead;
 old.resolve({sport:'cfb'});await oldRead;
 assert.equal(latest().key,'nfl:week');assert.equal(latest().data.sport,'nfl');assert.equal(latest().busy,false);
});
test('simultaneous checks are coalesced and cancelled requests publish nothing',async()=>{
 const {resource,updates}=setup();const next=deferred();let reads=0;
 const first=resource.read('cfb:week',()=>{reads++;return next.promise;});
 const second=resource.read('cfb:week',async()=>{reads++;return 'duplicate';});
 assert.equal(second,first);let settled=false;second.then(()=>{settled=true;});
 await Promise.resolve();assert.equal(settled,false);
 assert.equal(reads,1);resource.cancel();const count=updates.length;
 next.resolve('cancelled');await second;assert.equal(settled,true);assert.equal(updates.length,count);
});
