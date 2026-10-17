import {db} from '@/lib/db';
import {authorizedCollector} from '@/lib/admin';
import {baseballDataStatus} from '@/lib/baseball-data-status.mjs';
const key='mlb:research-collection-status:v1';
export async function GET(){
 try{const row=await db().prepare('SELECT payload FROM feed_cache WHERE key=?').bind(key).first<{payload:string}>();return Response.json({collection:row?JSON.parse(row.payload):null},{headers:{'Cache-Control':'no-store'}});}
 catch{return Response.json({error:'Baseball collection status is temporarily unavailable.'},{status:503});}
}
export async function POST(request:Request){
 if(!await authorizedCollector(request))return Response.json({error:'Collector authorization required.'},{status:401});
 try{
  if(Number(request.headers.get('content-length')||0)>30000)return Response.json({error:'Summary is too large.'},{status:400});
  const text=await request.text();if(text.length>30000)return Response.json({error:'Summary is too large.'},{status:400});
  const value=baseballDataStatus(JSON.parse(text));
  await db().prepare('INSERT INTO feed_cache (key,payload,fetched_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,fetched_at=excluded.fetched_at WHERE excluded.fetched_at >= feed_cache.fetched_at').bind(key,JSON.stringify(value),value.collectedAt).run();
  return Response.json({saved:true,collectedAt:value.collectedAt});
 }catch(e){return Response.json({error:e instanceof Error?e.message:'Collection summary could not be saved.'},{status:400});}
}
