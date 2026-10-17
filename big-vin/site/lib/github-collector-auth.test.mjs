import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {authorizedGitHubCollector,COLLECTOR_AUDIENCE} from './github-collector-auth.mjs';
const now=Date.now(),seconds=Math.floor(now/1000);
const pair=await webcrypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const jwk={...await webcrypto.subtle.exportKey('jwk',pair.publicKey),kid:'test-key',use:'sig',alg:'RS256'};
const payload={iss:'https://token.actions.githubusercontent.com',aud:COLLECTOR_AUDIENCE,repository:'lestercrafton/dumbai',repository_id:'926222029',repository_owner_id:'197527837',ref:'refs/heads/main',workflow_ref:'lestercrafton/dumbai/.github/workflows/big-vin-daily.yml@refs/heads/main',sub:'repo:lestercrafton/dumbai:ref:refs/heads/main',event_name:'schedule',iat:seconds,nbf:seconds,exp:seconds+600};
const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
async function sign(changes={},headerChanges={}){const body=enc({alg:'RS256',kid:'test-key',...headerChanges})+'.'+enc({...payload,...changes});return body+'.'+Buffer.from(await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,Buffer.from(body))).toString('base64url');}
const options={now,cryptoImpl:webcrypto,fetchImpl:async url=>{assert.equal(url,'https://token.actions.githubusercontent.com/.well-known/jwks');return {ok:true,json:async()=>({keys:[jwk]})};}};
test('accepts GitHub-signed identity only for the exact personal main workflow',async()=>assert.equal(await authorizedGitHubCollector(await sign(),options),true));
test('rejects other repositories, owners, workflows, branches, audiences, and PR events',async()=>{
 for(const changes of [{repository:'company/dumbai'},{repository_id:'1'},{repository_owner_id:'1'},{ref:'refs/heads/other'},{workflow_ref:'lestercrafton/dumbai/.github/workflows/other.yml@refs/heads/main'},{sub:'repo:lestercrafton/dumbai:pull_request'},{event_name:'pull_request'},{aud:'other'},{iss:'https://attacker.example'}])assert.equal(await authorizedGitHubCollector(await sign(changes),options),false);
});
test('rejects expired/future/overlong tokens, unsupported algorithms, malformed and forged signatures',async()=>{
 for(const changes of [{exp:seconds-1},{iat:seconds+60},{nbf:seconds+60},{exp:seconds+7200},{iat:seconds-7200}])assert.equal(await authorizedGitHubCollector(await sign(changes),options),false);
 assert.equal(await authorizedGitHubCollector(await sign({}, {alg:'none'}),options),false);
 const signed=await sign();assert.equal(await authorizedGitHubCollector(signed.slice(0,-20)+'A'.repeat(20),options),false);
 assert.equal(await authorizedGitHubCollector('malformed',options),false);
});
test('unknown signing keys cannot repeatedly bypass the JWKS cache',async()=>{
 let requests=0;
 const token=await sign({}, {kid:'unrecognized'});
 for(let i=0;i<3;i++)assert.equal(await authorizedGitHubCollector(token,{...options,fetchImpl:async()=>{requests++;throw new Error('Unexpected request');}}),false);
 assert.equal(requests,0);
});
