import test from 'node:test';
import assert from 'node:assert/strict';
test('cloud access uses only short-lived identity and renews on expiration',async()=>{
 const previous={...process.env},originalFetch=globalThis.fetch,originalNow=Date.now;
 let now=1900000000000,calls=0;
 try{
  process.env.GITHUB_ACTIONS='true';process.env.ACTIONS_ID_TOKEN_REQUEST_URL='https://token.actions.githubusercontent.com/request?example=1';process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN='request-credential';Date.now=()=>now;
  const {collectorConfig,collectorAuthorization,SITE_URL}=await import('./collector-access.mjs?test');
  const config=collectorConfig('/does-not-exist');assert.deepEqual(config,{url:SITE_URL,token:null});
  globalThis.fetch=async(url,options)=>{calls++;assert.equal(url.searchParams.get('audience'),SITE_URL);assert.equal(options.headers.Authorization,'Bearer request-credential');return {ok:true,json:async()=>({value:'header.'+Buffer.from(JSON.stringify({exp:now/1000+300})).toString('base64url')+'.signature'})};};
  const first=await collectorAuthorization(config);assert.ok(first.startsWith('Bearer '));
  assert.equal(await collectorAuthorization(config),first);assert.equal(calls,1);
  now+=250000;assert.notEqual(await collectorAuthorization(config),first);assert.equal(calls,2);
  assert.equal(await collectorAuthorization({token:'existing-local-token'}),'Bearer existing-local-token');
 }finally{globalThis.fetch=originalFetch;Date.now=originalNow;for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);}
});

let sequence=0;
async function cloudCase(run){
 const keys=['GITHUB_ACTIONS','ACTIONS_ID_TOKEN_REQUEST_URL','ACTIONS_ID_TOKEN_REQUEST_TOKEN'];
 const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 try{
  process.env.GITHUB_ACTIONS='true';process.env.ACTIONS_ID_TOKEN_REQUEST_URL='https://token.actions.githubusercontent.com/request';process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN='private-request-token';
  const {collectorAuthorization}=await import(`./collector-access.mjs?retry-test-${++sequence}`);
  const now=1900000000000,token='header.'+Buffer.from(JSON.stringify({exp:now/1000+300})).toString('base64url')+'.signature';
  const success=()=>({ok:true,json:async()=>({value:token})});
  await run({collectorAuthorization,now,token,success});
 }finally{for(const key of keys)if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}
}
test('OIDC retries 429, 5xx and network failures before caching a successful token',()=>cloudCase(async({collectorAuthorization,now,token,success})=>{
 let calls=0,cancelled=0;const waits=[];
 const failures=[{ok:false,status:429,headers:new Headers({'Retry-After':'2'})},{ok:false,status:503},new TypeError('private-request-token: fetch failed')];
 const fetchImpl=async()=>{calls++;const next=failures.shift();if(next instanceof Error)throw next;return next?{...next,body:{cancel:async()=>{cancelled++;}}}:success();};
 const options={fetchImpl,now:()=>now,sleep:async ms=>waits.push(ms)};
 assert.equal(await collectorAuthorization({},options),'Bearer '+token);assert.deepEqual(waits,[2000,2000,4000]);assert.equal(calls,4);assert.equal(cancelled,2);
 assert.equal(await collectorAuthorization({},options),'Bearer '+token);assert.equal(calls,4);
}));
test('OIDC Retry-After supports HTTP dates and caps excessive delays',()=>cloudCase(async({collectorAuthorization,now,success})=>{
 const waits=[];let calls=0;
 const responses=[{ok:false,status:429,headers:new Headers({'Retry-After':new Date(now+7000).toUTCString()})},{ok:false,status:503,headers:new Headers({'Retry-After':'3600'})},success()];
 await collectorAuthorization({},{fetchImpl:async()=>{calls++;return responses.shift();},now:()=>now,sleep:async ms=>waits.push(ms)});
 assert.equal(calls,3);assert.deepEqual(waits,[7000,30000]);
}));
test('OIDC exhausts bounded retries without exposing transport credentials or caching failure',()=>cloudCase(async({collectorAuthorization,now,success})=>{
 let calls=0;const waits=[];
 await assert.rejects(collectorAuthorization({},{fetchImpl:async()=>{calls++;throw new Error('private-request-token at https://private.invalid');},now:()=>now,sleep:async ms=>waits.push(ms)}),error=>{
  assert.match(error.message,/network or timeout/);assert.match(error.message,/5 attempts/);assert.doesNotMatch(error.message,/private-request-token|private.invalid/);return true;
 });
 assert.equal(calls,5);assert.deepEqual(waits,[1000,2000,4000,8000]);
 await collectorAuthorization({},{fetchImpl:async()=>{calls++;return success();},now:()=>now,sleep:async()=>assert.fail('no retry expected')});assert.equal(calls,6);
}));
test('OIDC permanent 401 fails immediately without delay',()=>cloudCase(async({collectorAuthorization,now})=>{
 let calls=0;
 await assert.rejects(collectorAuthorization({},{fetchImpl:async()=>{calls++;return{ok:false,status:401};},now:()=>now,sleep:async()=>assert.fail('permanent errors must not retry')}),/\(401\)/);assert.equal(calls,1);
}));
test('OIDC retries an interrupted response body',()=>cloudCase(async({collectorAuthorization,now,success})=>{
 let calls=0;const waits=[];
 await collectorAuthorization({},{fetchImpl:async()=>++calls===1?{ok:true,json:async()=>{throw new TypeError('terminated');}}:success(),now:()=>now,sleep:async ms=>waits.push(ms)});assert.equal(calls,2);assert.deepEqual(waits,[1000]);
}));
test('OIDC malformed JSON is a nonretryable response failure',()=>cloudCase(async({collectorAuthorization,now})=>{
 let calls=0;
 await assert.rejects(collectorAuthorization({},{fetchImpl:async()=>{calls++;return{ok:true,json:async()=>{throw new SyntaxError('private response');}};},now:()=>now,sleep:async()=>assert.fail('malformed responses must not retry')}),/invalid identity response/);assert.equal(calls,1);
}));
