import {authorizedCollector} from '@/lib/admin';
import {savePlaybookDocument,readVersions,readChallengers,readScoreboards,readOdds} from '@/lib/playbook-store';
import {SPORTS} from '@/lib/playbook.mjs';
const headers={'Cache-Control':'no-store'};
/** Public reads: ?view=versions | challengers | scoreboards | odds (&sport=&gameId=). */
export async function GET(request:Request){
 const params=new URL(request.url).searchParams,view=params.get('view')||'versions';
 try{
  if(view==='versions')return Response.json(await readVersions(),{headers});
  if(view==='challengers')return Response.json(await readChallengers(),{headers});
  if(view==='scoreboards')return Response.json({...await readVersions(),scoreboards:await readScoreboards()},{headers});
  if(view==='odds'){const sport=params.get('sport')||'',gameId=params.get('gameId')||'';
   if(!SPORTS.includes(sport)||!/^[A-Za-z0-9_.:-]{1,160}$/.test(gameId))return Response.json({error:'Choose a sport and gameId.'},{status:400});
   return Response.json({sport,gameId,lines:await readOdds(sport,gameId)},{headers});}
  return Response.json({error:'Choose view=versions, challengers, scoreboards or odds.'},{status:400});
 }catch(e){console.error('Playbook read failed',e);return Response.json({error:'The playbook record is temporarily unavailable.'},{status:503});}
}
/** Runner writes, authorized exactly like the collector. Append-only. */
export async function POST(request:Request){
 if(!await authorizedCollector(request))return Response.json({error:'Collector authorization required.'},{status:401});
 try{
  const text=await request.text();if(text.length>1500000)return Response.json({error:'Document is too large.'},{status:400});
  return Response.json(await savePlaybookDocument(JSON.parse(text)));
 }catch(e){return Response.json({error:e instanceof Error?e.message:'The document could not be saved.'},{status:400});}
}
