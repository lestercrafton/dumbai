// Cloudflare Worker entry. Serves precomputed public reads from the D1 read
// cache and hands everything else to the vinext app unchanged. Copied next to
// the built app (dist/server) by scripts/cloudflare-build.mjs.
import {Buffer} from 'node:buffer';
import app from './index.js';
import {apiCacheKey,pageCacheKey,rscCacheKey,routerRequest,readCached,storeStatements,storableHeaders,cachedResponse,fresh,MAX_BODY_CHARS,edgeDirective,withEdge,EDGE_NO_STORE} from './read-cache.mjs';

async function fill(env,key,response,source){
 try{
  const body=await response.text();
  if(body.length>MAX_BODY_CHARS)return;
  await env.DB.batch(storeStatements(env.DB,{key,status:response.status,headers:storableHeaders(response.headers),renderedAt:new Date().toISOString(),source,body}));
 }catch(error){console.error('Read cache fill failed',key,error);}
}
const decodeBase64=text=>{const b=Buffer.from(text,'base64');return new Uint8Array(b.buffer,b.byteOffset,b.length);};
async function register(env,key){
 try{await env.DB.prepare("INSERT INTO read_cache (key,status,headers,rendered_at,source,parts,body,registered_at) VALUES (?,0,'[]','1970-01-01T00:00:00.000Z','miss',1,'',?) ON CONFLICT(key) DO NOTHING").bind(key,new Date().toISOString()).run();}
 catch(error){console.error('Read cache registration failed',key,error);}
}
async function cachedOrLive(request,env,ctx,key,{maxAge,source}){
 let hit=null;
 const meter=env.BV_D1_METER?meta=>console.log(JSON.stringify({d1read:meta?.rows_read??0,d1write:meta?.rows_written??0})):undefined;
 try{hit=await readCached(env.DB,key,meter);}catch(error){console.error('Read cache lookup failed',key,error);}
 const kind=source==='miss'?'api':'page';
 if(hit&&(maxAge===null||fresh({rendered_at:hit.renderedAt},Date.now(),maxAge)))return withEdge(cachedResponse(hit,'hit',{acceptsGzip:/\bgzip\b/i.test(request.headers.get('accept-encoding')||''),decodeBase64}),hit.status===200?edgeDirective(kind):EDGE_NO_STORE);
 // Register the key first, so the renderer picks it up even if this request fails.
 if(!hit&&source==='miss')ctx.waitUntil(register(env,key));
 const response=await app.fetch(request,env,ctx);
 const type=response.headers.get('content-type')||'';
 const storable=response.status===200&&(type.startsWith('application/json')||type.startsWith('text/html')||type.startsWith('text/x-component'))&&!response.headers.has('set-cookie');
 if(storable)ctx.waitUntil(fill(env,key,response.clone(),source));
 return withEdge(response,storable?edgeDirective(kind):EDGE_NO_STORE);
}
// Everything outside the read cache keeps running on every request.
async function route(request,env,ctx){
  if(request.method==='GET'&&env.DB&&routerRequest(request)){
   const rscKey=rscCacheKey(request,env.CF_VERSION?.id);
   if(rscKey)return cachedOrLive(request,env,ctx,rscKey,{maxAge:null,source:'page'});
  }
  if(request.method==='GET'&&env.DB&&!routerRequest(request)){
   const url=new URL(request.url);
   const apiKey=apiCacheKey(url);
   if(apiKey)return cachedOrLive(request,env,ctx,apiKey,{maxAge:undefined,source:'miss'});
   const pageKey=pageCacheKey(url,env.CF_VERSION?.id);
   if(pageKey)return cachedOrLive(request,env,ctx,pageKey,{maxAge:null,source:'page'});
  }
  return withEdge(await app.fetch(request,env,ctx),EDGE_NO_STORE);
}
export default {fetch:route};
