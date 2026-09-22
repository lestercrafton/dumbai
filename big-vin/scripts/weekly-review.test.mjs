import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Exercise the actual CLI with a completely mocked transport and isolated HOME.
// The draft test intentionally has no OIDC request credentials at all.
for(const apply of [false,true])test(`weekly review ${apply?'publishes with authentication only on POST':'reads public endpoints without OIDC credentials'}`,()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'big-vin-weekly-test-'));
 try{
  const preload=path.join(root,'mock.mjs'),capture=path.join(root,'calls.json');
  fs.writeFileSync(preload,`
import fs from 'node:fs';
const calls=[];
const token='header.'+Buffer.from(JSON.stringify({exp:Date.now()/1000+300})).toString('base64url')+'.signature';
globalThis.fetch=async(url,options={})=>{
 const parsed=new URL(url),method=options.method||'GET';
 const authorization=options.headers?.Authorization??null;
 calls.push({path:parsed.pathname,method,authorization});fs.writeFileSync(process.env.WEEKLY_TEST_CAPTURE,JSON.stringify(calls));
 if(parsed.hostname==='token.actions.githubusercontent.com')return{ok:true,json:async()=>({value:token})};
 if(method==='GET'&&authorization)throw new Error('Public GET unexpectedly requested authentication');
 if(parsed.pathname==='/api/learning'){
  if(method==='POST'){
   if(authorization!=='Bearer '+token)throw new Error('Missing POST authentication');
   return{ok:true,json:async()=>({inserted:true})};
  }
  return{ok:true,json:async()=>({entries:[]})};
 }
 if(parsed.pathname==='/api/results'){
  if(parsed.searchParams.get('sport')!=='nfl')return{ok:true,json:async()=>({versions:[]})};
  if(parsed.searchParams.has('week'))return{ok:true,json:async()=>({summary:{graded:1,recorded:1,wins:1,losses:0,pushes:0,pnl:1,mae:3,pending:0,matchedGames:1,matchedModelMae:3,marketMae:4,bias:3,pricedGames:1},knownScheduledGames:1,missing:[],records:[{id:'game1',home:'Home',away:'Away',startTime:'2026-01-01T18:00:00Z',capturedAt:'2026-01-01T12:00:00Z',predictedMargin:7,result:{status:'completed',actualMargin:10,absoluteError:3}}]})};
  if(parsed.searchParams.has('version'))return{ok:true,json:async()=>({weeks:[{key:'2025-W18',graded:1}]})};
  return{ok:true,json:async()=>({versions:[{id:'ridge-v1',label:'Original ratings'}]})};
 }
 throw new Error('Unexpected request');
};
`);
  const env={...process.env,HOME:root,GITHUB_ACTIONS:'true',WEEKLY_TEST_CAPTURE:capture};
  delete env.ACTIONS_ID_TOKEN_REQUEST_URL;delete env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if(apply){env.ACTIONS_ID_TOKEN_REQUEST_URL='https://token.actions.githubusercontent.com/request';env.ACTIONS_ID_TOKEN_REQUEST_TOKEN='fake-request-token';}
  const child=spawnSync(process.execPath,['--import',preload,fileURLToPath(new URL('./weekly-review.mjs',import.meta.url)),...(apply?['--apply']:[])],{env,encoding:'utf8',timeout:10000});
  assert.equal(child.status,0,child.stderr);const report=JSON.parse(child.stdout);assert.equal(report.applied,apply);assert.equal(report.entries,1);
  const calls=JSON.parse(fs.readFileSync(capture,'utf8'));
  assert.ok(calls.some(c=>c.path==='/api/learning'&&c.method==='GET'));
  for(const c of calls.filter(c=>c.path.startsWith('/api/')&&c.method==='GET'))assert.equal(c.authorization,null);
  assert.equal(calls.filter(c=>c.path==='/request').length,apply?1:0);
  assert.equal(calls.filter(c=>c.path==='/api/learning'&&c.method==='POST').length,apply?1:0);
  assert.ok(report.artifact.startsWith(root));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
