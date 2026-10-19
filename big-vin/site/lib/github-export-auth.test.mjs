import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {authorizedGitHubExporter,EXPORT_AUDIENCE} from './github-export-auth.mjs';
import {COLLECTOR_AUDIENCE} from './github-collector-auth.mjs';
const now=Date.now(),seconds=Math.floor(now/1000);
const pair=await webcrypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const jwk={...await webcrypto.subtle.exportKey('jwk',pair.publicKey),kid:'test-key',use:'sig',alg:'RS256'};
const payload={iss:'https://token.actions.githubusercontent.com',aud:EXPORT_AUDIENCE,repository:'lestercrafton/dumbai',repository_id:'926222029',repository_owner_id:'197527837',ref:'refs/heads/main',workflow_ref:'lestercrafton/dumbai/.github/workflows/site-export.yml@refs/heads/main',sub:'repo:lestercrafton/dumbai:ref:refs/heads/main',event_name:'workflow_dispatch',iat:seconds,nbf:seconds,exp:seconds+300};
const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
async function sign(changes={},headerChanges={}){const body=enc({alg:'RS256',kid:'test-key',...headerChanges})+'.'+enc({...payload,...changes});return body+'.'+Buffer.from(await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,Buffer.from(body))).toString('base64url');}
const options={now,cryptoImpl:webcrypto,fetchImpl:async url=>{assert.equal(url,'https://token.actions.githubusercontent.com/.well-known/jwks');return {ok:true,json:async()=>({keys:[jwk]})};}};
test('accepts only a manual run of the main-branch site-export workflow',async()=>assert.equal(await authorizedGitHubExporter(await sign(),options),true));
test('export audience is separate from the collector audience',()=>assert.notEqual(EXPORT_AUDIENCE,COLLECTOR_AUDIENCE));
test('rejects the collector workflow, scheduled or push runs, and other identities',async()=>{
 for(const changes of [{workflow_ref:'lestercrafton/dumbai/.github/workflows/big-vin-daily.yml@refs/heads/main'},{aud:COLLECTOR_AUDIENCE},{event_name:'schedule'},{event_name:'push'},{event_name:'pull_request'},{repository:'company/dumbai'},{repository_id:'1'},{repository_owner_id:'1'},{ref:'refs/heads/other'},{workflow_ref:'lestercrafton/dumbai/.github/workflows/site-export.yml@refs/heads/other'},{sub:'repo:lestercrafton/dumbai:pull_request'},{iss:'https://attacker.example'}])assert.equal(await authorizedGitHubExporter(await sign(changes),options),false,JSON.stringify(changes));
});
test('rejects expired, future, overlong, unsigned and forged tokens',async()=>{
 for(const changes of [{exp:seconds-1},{iat:seconds+60},{nbf:seconds+60},{exp:seconds+7200},{iat:seconds-7200}])assert.equal(await authorizedGitHubExporter(await sign(changes),options),false);
 assert.equal(await authorizedGitHubExporter(await sign({}, {alg:'none'}),options),false);
 assert.equal(await authorizedGitHubExporter(await sign({}, {jku:'https://attacker.example/keys'}),options),false);
 const signed=await sign();assert.equal(await authorizedGitHubExporter(signed.slice(0,-20)+'A'.repeat(20),options),false);
 assert.equal(await authorizedGitHubExporter('malformed',options),false);
});
