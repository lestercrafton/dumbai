import {db} from '@/lib/db';
import {authorizedCollector} from '@/lib/admin';
import entries from '@/lib/learning-seed.json';
export async function GET(){
 try{const rows=await db().prepare('SELECT payload FROM learning_entries ORDER BY published_at DESC LIMIT 250').all<{payload:string}>();
 const items=new Map((entries as any[]).map(e=>[e.id,e]));for(const r of rows.results){const e=JSON.parse(r.payload);items.set(e.id,e);}
 return Response.json({entries:[...items.values()].sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt))},{headers:{'Cache-Control':'no-store'}});
 }catch(e){console.error('Learning log read failed',e);return Response.json({error:'The learning log is temporarily unavailable.'},{status:503});}
}
export async function POST(request:Request){
 if(!await authorizedCollector(request))return Response.json({error:'Collector authorization required.'},{status:401});
 try{const e:any=await request.json();
 if(!/^[a-z0-9_-]{5,120}$/.test(e.id)||typeof e.sport!=='string'||typeof e.weekKey!=='string'||!['review','experiment','retained','promoted','correction'].includes(e.kind)||['title','learned','decision','nextTest','modelVersion'].some(k=>typeof e[k]!=='string'||!e[k].trim()||e[k].length>15000)||JSON.stringify(e).length>60000)return Response.json({error:'A complete, bounded learning entry is required.'},{status:400});
 const publishedAt=new Date().toISOString();const entry={...e,publishedAt};
 const r=await db().prepare('INSERT INTO learning_entries (id,published_at,sport,week_key,payload) VALUES (?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(e.id,publishedAt,e.sport,e.weekKey,JSON.stringify(entry)).run();
 return Response.json({inserted:r.meta.changes>0,id:e.id});
 }catch(e){console.error('Learning entry failed',e);return Response.json({error:'The entry could not be saved.'},{status:503});}
}
