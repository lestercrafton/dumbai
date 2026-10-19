import {authorizedCollector} from '@/lib/admin';
import {savePlaybookDocument,readVersions,readChallengers,readScoreboards} from '@/lib/playbook-store';
const headers={'Cache-Control':'no-store'};
/** Public reads: ?view=versions | challengers | scoreboards. */
export async function GET(request:Request){
 const view=new URL(request.url).searchParams.get('view')||'versions';
 try{
  if(view==='versions')return Response.json(await readVersions(),{headers});
  if(view==='challengers')return Response.json(await readChallengers(),{headers});
  if(view==='scoreboards')return Response.json({...await readVersions(),scoreboards:await readScoreboards()},{headers});
  return Response.json({error:'Choose view=versions, challengers or scoreboards.'},{status:400});
 }catch(e){console.error('Playbook read failed',e);return Response.json({error:'The playbook record is temporarily unavailable.'},{status:503});}
}
/** Runner writes, authorized exactly like the collector. Append-only. */
export async function POST(request:Request){
 if(!await authorizedCollector(request))return Response.json({error:'Collector authorization required.'},{status:401});
 try{
  const text=await request.text();if(text.length>400000)return Response.json({error:'Document is too large.'},{status:400});
  return Response.json(await savePlaybookDocument(JSON.parse(text)));
 }catch(e){return Response.json({error:e instanceof Error?e.message:'The document could not be saved.'},{status:400});}
}
