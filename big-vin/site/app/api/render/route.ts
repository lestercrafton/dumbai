import {db} from '@/lib/db';
import {authorizedRenderer} from '@/lib/admin';
import {RenderError,maxRowids,rowsAfter,rowsChanged,recentRuns,cacheKeys,applyStatements,dropKeys,pruneParts} from '@/lib/render-source.mjs';
// @ts-ignore plain module shared with the Cloudflare entry
import {storeStatements,MAX_BODY_CHARS} from '@/cloudflare/read-cache.mjs';
const headers={'Cache-Control':'no-store'};
const send=(value:unknown,status=200)=>Response.json(value,{status,headers});
const denied=()=>send({error:'Renderer authorization required.'},401);
const failed=(error:unknown)=>error instanceof RenderError?send({error:error.message},error.status):(console.error('Render request failed',error),send({error:'Render request failed.'},500));
/** Read side of the read-cache renderer. Only its workflow may call this. */
export async function GET(request:Request){
 if(!await authorizedRenderer(request))return denied();
 const p=new URL(request.url).searchParams;
 try{
  switch(p.get('op')){
   case 'max':return send(await maxRowids(db()));
   case 'rows':return send(await rowsAfter(db(),p.get('table')||'',p.get('after')??'0',p.get('limit')??'200'));
   case 'changed':return send(await rowsChanged(db(),p.get('table')||'',p.get('since')||'',p.get('afterRowid')??'0',p.get('limit')??'200'));
   case 'runs':return send(await recentRuns(db(),p.get('sport')||'',p.get('limit')??'90'));
   case 'keys':return send(await cacheKeys(db()));
   default:return send({error:'Choose op=max, rows, changed, runs or keys.'},400);
  }
 }catch(error){return failed(error);}
}
/** Write side: finished bodies, the writes the render made, and cache upkeep. */
export async function POST(request:Request){
 if(!await authorizedRenderer(request))return denied();
 const p=new URL(request.url).searchParams;
 try{
  switch(p.get('op')){
   case 'put':{
    const key=p.get('key')||'',renderedAt=p.get('renderedAt')||'',status=Number(p.get('status')),saved=JSON.parse(request.headers.get('x-render-headers')||'[]');
    if(!key.startsWith('api:')||key.length>2000)throw new RenderError('Choose an api: key.');
    if(!/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(renderedAt))throw new RenderError('renderedAt must be an ISO timestamp.');
    if(!Number.isInteger(status)||status<200||status>599)throw new RenderError('Choose a status.');
    if(!Array.isArray(saved)||!saved.every((h:unknown)=>Array.isArray(h)&&h.length===2&&h.every(v=>typeof v==='string')))throw new RenderError('Headers must be name/value pairs.');
    const body=await request.text();if(body.length>MAX_BODY_CHARS)throw new RenderError('Body too large.',413);
    await db().batch(storeStatements(db(),{key,status,headers:saved,renderedAt,source:'render',body}));
    return send({stored:key,chars:body.length});
   }
   case 'apply':{const v=await request.json() as any;return send({changes:await applyStatements(db(),v?.statements)});}
   case 'drop':{const v=await request.json() as any;return send({dropped:await dropKeys(db(),v?.keys)});}
   case 'prune':return send({pruned:await pruneParts(db())});
   default:return send({error:'Choose op=put, apply, drop or prune.'},400);
  }
 }catch(error){return failed(error);}
}
