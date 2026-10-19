import {env} from 'cloudflare:workers';
import {authorizedGitHubCollector} from './github-collector-auth.mjs';
export async function authorizedCollector(request:Request){
 const vars=env as unknown as {BIG_VIN_ADMIN_TOKEN?:string,COLLECTOR_AUDIENCE?:string};const secret=vars.BIG_VIN_ADMIN_TOKEN;
 // Each host names the OIDC audience the runner must request for it; ChatGPT Sites keeps the original.
 const audience=vars.COLLECTOR_AUDIENCE||undefined;
 const authorization=request.headers.get('authorization')||'';
 if(secret&&secret.length>=32&&authorization===`Bearer ${secret}`)return true;
 return authorization.startsWith('Bearer ')&&await authorizedGitHubCollector(authorization.slice(7),{audience});
}
