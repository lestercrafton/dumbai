import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
export const SITE_URL='https://big-vin-grind-to-win.sunlightisfree.chatgpt.site';
let identity;
export function collectorConfig(file=path.join(os.homedir(),'.config/big-vin/collector.json')){
 if(process.env.GITHUB_ACTIONS==='true')return {url:SITE_URL,token:null};
 return JSON.parse(fs.readFileSync(file,'utf8'));
}
export async function collectorAuthorization(config){
 if(config.token)return 'Bearer '+config.token;
 if(process.env.GITHUB_ACTIONS!=='true')throw new Error('Collector credentials are unavailable.');
 if(identity&&identity.expires>Date.now()+60000)return 'Bearer '+identity.token;
 const requestUrl=process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
 const requestToken=process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
 if(!requestUrl||!requestToken)throw new Error('GitHub workflow requires id-token: write permission.');
 const url=new URL(requestUrl);if(url.protocol!=='https:')throw new Error('Secure GitHub identity endpoint required.');
 url.searchParams.set('audience',SITE_URL);
 const response=await fetch(url,{headers:{Authorization:'Bearer '+requestToken},signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw new Error(`GitHub identity request failed (${response.status}).`);
 const value=await response.json();
 const token=value.value;
 if(typeof token!=='string'||token.split('.').length!==3)throw new Error('GitHub did not return a signed identity token.');
 const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());
 if(!Number.isFinite(claims.exp)||claims.exp*1000<=Date.now()+60000)throw new Error('GitHub identity token is expired.');
 // The server verifies signature and exact repository/workflow claims. This
 // client-side expiration read is only to refresh before the next request.
 identity={token,expires:claims.exp*1000};return 'Bearer '+token;
}
