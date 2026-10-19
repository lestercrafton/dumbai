import {db} from '@/lib/db';
import {authorizedGitHubExporter} from '@/lib/github-export-auth.mjs';
import {handleExport} from '@/lib/site-export.mjs';
const denied=()=>Response.json({error:'Export authorization required.'},{status:401,headers:{'Cache-Control':'no-store'}});
/** Read-only migration export. Only the manual site-export workflow's GitHub OIDC token is accepted. */
export async function GET(request:Request){
 const authorization=request.headers.get('authorization')||'';
 if(!authorization.startsWith('Bearer ')||!await authorizedGitHubExporter(authorization.slice(7)))return denied();
 return handleExport(request.url,{db:db()});
}
