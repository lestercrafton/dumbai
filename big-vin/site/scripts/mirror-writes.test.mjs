import test from 'node:test';
import assert from 'node:assert/strict';
import {mirrorTarget,sendMirror} from './mirror-writes.mjs';
const primary='https://old.example',mirror='https://new.example';
test('only POSTs to the primary site API are mirrored',()=>{
 const post={method:'POST',body:'{}'};
 assert.equal(mirrorTarget('https://old.example/api/collector?x=1',post,{primary,mirror}),'https://new.example/api/collector?x=1');
 assert.equal(mirrorTarget('https://old.example/api/collector',{method:'GET'},{primary,mirror}),null);
 assert.equal(mirrorTarget('https://old.example/learning-log',post,{primary,mirror}),null);
 assert.equal(mirrorTarget('https://site.api.espn.com/api/x',post,{primary,mirror}),null);
 assert.equal(mirrorTarget('https://old.example/api/x',post,{primary,mirror:''}),null);
 assert.equal(mirrorTarget('https://old.example/api/x',{method:'POST',body:new Uint8Array()},{primary,mirror}),null);
});
test('a mirror failure is reported, never thrown',async()=>{
 process.env.BIG_VIN_MIRROR_TOKEN='t';
 const logs=[];
 assert.equal(await sendMirror('https://new.example/api/collector',{body:'{}'},{fetchImpl:async()=>({ok:false,status:503,text:async()=>'no'}),log:m=>logs.push(m)}),false);
 assert.equal(await sendMirror('https://new.example/api/collector',{body:'{}'},{fetchImpl:async()=>{throw Error('down');},log:m=>logs.push(m)}),false);
 assert.equal(logs.length,2);assert.match(logs[0],/not copied \(HTTP 503\)/);
 let sent;assert.equal(await sendMirror('https://new.example/api/learning',{body:'{"a":1}'},{fetchImpl:async(url,init)=>{sent={url,init};return {ok:true,status:200,text:async()=>'{}'};},log:()=>{}}),true);
 assert.equal(sent.init.body,'{"a":1}');assert.equal(sent.init.headers.Authorization,'Bearer t');
 delete process.env.BIG_VIN_MIRROR_TOKEN;
});
