import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
export const SITE_URL='https://big-vin-grind-to-win.sunlightisfree.chatgpt.site';
const IDENTITY_ATTEMPTS=5,MAX_RETRY_DELAY=30000;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let identity;
export function collectorConfig(file=path.join(os.homedir(),'.config/big-vin/collector.json')){
 if(process.env.GITHUB_ACTIONS==='true')return {url:SITE_URL,token:null};
 return JSON.parse(fs.readFileSync(file,'utf8'));
}
function retryDelay(response,attempt,now){
 const retryAfter=response?.headers?.get('retry-after');
 if(retryAfter){
  const seconds=Number(retryAfter),wait=Number.isFinite(seconds)?seconds*1000:Date.parse(retryAfter)-now();
  if(Number.isFinite(wait)&&wait>=0)return Math.min(wait,MAX_RETRY_DELAY);
 }
 return Math.min(1000*2**attempt,MAX_RETRY_DELAY);
}
async function requestIdentity(url,requestToken,{fetchImpl,sleep,now}){
 for(let attempt=0;attempt<IDENTITY_ATTEMPTS;attempt++){
  let response,value,transportFailed=false;
  try{response=await fetchImpl(url,{headers:{Authorization:'Bearer '+requestToken},signal:AbortSignal.timeout(30000)});}
  catch{transportFailed=true;}
  if(response?.ok){
   try{value=await response.json();}
   catch(error){
    if(error instanceof SyntaxError)throw new Error('GitHub returned an invalid identity response.');
    transportFailed=true;
   }
   if(!transportFailed)return value;
  }
  const retryable=transportFailed||response?.status===429||response?.status>=500&&response?.status<=599;
  // Do not log request tokens, URLs, response bodies or transport error text.
  const failure=transportFailed?'GitHub identity request failed (network or timeout).':`GitHub identity request failed (${response?.status}).`;
  if(!retryable)throw new Error(failure);
  if(attempt===IDENTITY_ATTEMPTS-1)throw new Error(`${failure} Retry limit reached (${IDENTITY_ATTEMPTS} attempts).`);
  // Release failed HTTP bodies before retrying; no failed token is cached.
  try{await response?.body?.cancel();}catch{}
  await sleep(retryDelay(response,attempt,now));
 }
}
export async function collectorAuthorization(config,{fetchImpl=globalThis.fetch,sleep=delay,now=Date.now}={}){
 if(config.token)return 'Bearer '+config.token;
 if(process.env.GITHUB_ACTIONS!=='true')throw new Error('Collector credentials are unavailable.');
 if(identity&&identity.expires>now()+60000)return 'Bearer '+identity.token;
 const requestUrl=process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
 const requestToken=process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
 if(!requestUrl||!requestToken)throw new Error('GitHub workflow requires id-token: write permission.');
 const url=new URL(requestUrl);if(url.protocol!=='https:')throw new Error('Secure GitHub identity endpoint required.');
 url.searchParams.set('audience',SITE_URL);
 const value=await requestIdentity(url,requestToken,{fetchImpl,sleep,now});
 const token=value?.value;
 if(typeof token!=='string'||token.split('.').length!==3)throw new Error('GitHub did not return a signed identity token.');
 let claims;try{claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());}catch{throw new Error('GitHub returned invalid identity claims.');}
 if(!Number.isFinite(claims?.exp)||claims.exp*1000<=now()+60000)throw new Error('GitHub identity token is expired.');
 // The server verifies signature and exact repository/workflow claims. This
 // client-side expiration read is only to refresh before the next request.
 identity={token,expires:claims.exp*1000};return 'Bearer '+token;
}
