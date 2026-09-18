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
