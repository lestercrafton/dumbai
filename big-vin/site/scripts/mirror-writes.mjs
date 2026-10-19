// Dual-write for the hosting move. Loaded with `node --import` on the runner's site-writing steps.
// Every POST the runner makes to the primary site's /api/ is sent, unchanged, to BIG_VIN_MIRROR_URL
// right after the primary answers. The runner only ever sees the primary's response, and a mirror
// failure is a warning, never an error. The mirror signs in with its own GitHub OIDC audience.
const original=globalThis.fetch;
const PRIMARY=process.env.BIG_VIN_SITE_URL||'https://big-vin-grind-to-win.sunlightisfree.chatgpt.site';
const MIRROR=process.env.BIG_VIN_MIRROR_URL||'';
const LOG=process.env.BIG_VIN_MIRROR_LOG||'';
const MAX_FAILURES=5;
let failuresInARow=0,disabled=false,identity=null;

export function mirrorTarget(input,init,{primary=PRIMARY,mirror=MIRROR}={}){
 if(!mirror||!init||String(init.method||'GET').toUpperCase()!=='POST'||typeof init.body!=='string')return null;
 if(typeof input!=='string'&&!(input instanceof URL))return null;
 let url;try{url=new URL(String(input));}catch{return null;}
 const from=new URL(primary),to=new URL(mirror);
 if(url.origin!==from.origin||!url.pathname.startsWith('/api/')||to.origin===from.origin)return null;
 return new URL(url.pathname+url.search,to.origin).href;
}
async function mirrorAuthorization(fetchImpl,env=process.env){
 if(env.BIG_VIN_MIRROR_TOKEN)return 'Bearer '+env.BIG_VIN_MIRROR_TOKEN;
 if(identity&&identity.expires>Date.now()+60000)return identity.header;
 if(!env.ACTIONS_ID_TOKEN_REQUEST_URL||!env.ACTIONS_ID_TOKEN_REQUEST_TOKEN)throw Error('no workflow identity');
 const url=new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);url.searchParams.set('audience',new URL(MIRROR).origin);
 const r=await fetchImpl(url,{headers:{Authorization:'Bearer '+env.ACTIONS_ID_TOKEN_REQUEST_TOKEN},signal:AbortSignal.timeout(30000)});
 if(!r.ok)throw Error('identity HTTP '+r.status);
 const token=(await r.json())?.value;if(typeof token!=='string'||token.split('.').length!==3)throw Error('identity missing');
 const exp=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString()).exp*1000;
 identity={header:'Bearer '+token,expires:exp};return identity.header;
}
async function record(entry){if(!LOG)return;try{const {appendFile}=await import('node:fs/promises');await appendFile(LOG,JSON.stringify(entry)+'\n');}catch{}}
export async function sendMirror(target,init,{fetchImpl=original,log=console.error}={}){
 const started=Date.now(),path=new URL(target).pathname;
 try{
  const r=await fetchImpl(target,{method:'POST',headers:{'Content-Type':'application/json',Authorization:await mirrorAuthorization(fetchImpl)},body:init.body,signal:AbortSignal.timeout(90000)});
  const text=await r.text().catch(()=>'');
  await record({at:new Date().toISOString(),path,status:r.status,ms:Date.now()-started,ok:r.ok,error:r.ok?undefined:text.slice(0,200)});
  if(!r.ok)throw Error('HTTP '+r.status);
  failuresInARow=0;return true;
 }catch(e){
  failuresInARow++;
  log(`::warning title=Cloudflare mirror::POST ${path} was not copied (${e instanceof Error?e.message:'error'}). The primary site is unaffected.`);
  if(failuresInARow>=MAX_FAILURES&&!disabled){disabled=true;log(`::warning title=Cloudflare mirror::${MAX_FAILURES} failures in a row; this step stops copying.`);}
  if(!(e instanceof Error&&e.message.startsWith('HTTP')))await record({at:new Date().toISOString(),path,status:null,ms:Date.now()-started,ok:false,error:e instanceof Error?e.message.slice(0,200):'error'});
  return false;
 }
}
if(MIRROR&&typeof original==='function'){
 globalThis.fetch=async function(input,init){
  const response=await original(input,init);
  const target=disabled?null:mirrorTarget(input,init);
  if(target){try{await sendMirror(target,init);}catch{}}
  return response;
 };
}
