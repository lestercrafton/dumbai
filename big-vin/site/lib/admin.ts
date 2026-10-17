import {env} from 'cloudflare:workers';
import {authorizedGitHubCollector} from './github-collector-auth.mjs';
export async function authorizedCollector(request:Request){
 const secret=(env as unknown as {BIG_VIN_ADMIN_TOKEN?:string}).BIG_VIN_ADMIN_TOKEN;
 const authorization=request.headers.get('authorization')||'';
 if(secret&&secret.length>=32&&authorization===`Bearer ${secret}`)return true;
 return authorization.startsWith('Bearer ')&&await authorizedGitHubCollector(authorization.slice(7));
}
