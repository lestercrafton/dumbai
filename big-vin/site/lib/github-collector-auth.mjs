// Only this personal repository's main-branch workflow may collect for Big Vin.
export const COLLECTOR_AUDIENCE='https://big-vin-grind-to-win.sunlightisfree.chatgpt.site';
const issuer='https://token.actions.githubusercontent.com';
const jwksUrl=issuer+'/.well-known/jwks';
const repository='lestercrafton/dumbai';
const workflow=repository+'/.github/workflows/big-vin-daily.yml@refs/heads/main';
let cachedKeys=null;
const decode=value=>Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
const json=value=>JSON.parse(new TextDecoder().decode(decode(value)));

export async function authorizedGitHubCollector(token,{now=Date.now(),fetchImpl=fetch,cryptoImpl=crypto}={}){
 try{
  if(typeof token!=='string'||token.length>20000)return false;
  const parts=token.split('.');if(parts.length!==3)return false;
  const header=json(parts[0]),claims=json(parts[1]),seconds=now/1000;
  if(header.alg!=='RS256'||typeof header.kid!=='string'||header.crit)return false;
  if(claims.iss!==issuer||claims.aud!==COLLECTOR_AUDIENCE||
     claims.repository!==repository||claims.repository_id!=='926222029'||
     claims.repository_owner_id!=='197527837'||claims.ref!=='refs/heads/main'||
     claims.workflow_ref!==workflow||claims.sub!==`repo:${repository}:ref:refs/heads/main`||
     !['schedule','workflow_dispatch','push'].includes(claims.event_name))return false;
  if(!Number.isFinite(claims.exp)||!Number.isFinite(claims.iat)||!Number.isFinite(claims.nbf)||
     claims.exp<=seconds||claims.iat>seconds+30||claims.nbf>seconds+30||
     claims.iat<seconds-3600||claims.exp-claims.iat>3600)return false;
  if(!cachedKeys||cachedKeys.expires<=now){
   const response=await fetchImpl(jwksUrl,{signal:AbortSignal.timeout(10000)});
   if(!response.ok)return false;
   const value=await response.json();if(!Array.isArray(value.keys))return false;
   cachedKeys={keys:value.keys,expires:now+300000};
  }
  const jwk=cachedKeys.keys.find(k=>k.kid===header.kid&&k.kty==='RSA'&&k.use==='sig'&&k.alg==='RS256');
  if(!jwk)return false;
  const key=await cryptoImpl.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  return await cryptoImpl.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1]));
 }catch{return false;}
}
