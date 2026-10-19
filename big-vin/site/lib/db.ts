import {env} from 'cloudflare:workers';
type MeteredEnv={DB:D1Database,BV_D1_METER?:string};
const metered=new WeakMap<D1Database,D1Database>();
const unwrap=new WeakMap<object,D1PreparedStatement>();
const note=(meta:any)=>{if(meta)console.log(JSON.stringify({d1read:meta.rows_read??0,d1write:meta.rows_written??0}));};
// Off unless BV_D1_METER is set: logs rows read and written per statement so
// `wrangler tail` can add them up per request.
function meter(base:D1Database):D1Database{
 const wrap=(s:D1PreparedStatement):D1PreparedStatement=>{const p=new Proxy(s,{get(target,key){
  if(key==='bind')return (...args:unknown[])=>wrap(target.bind(...args));
  if(key==='all'||key==='run')return async()=>{const r:any=await (target as any)[key]();note(r?.meta);return r;};
  if(key==='first')return async(column?:string)=>{const r:any=await target.all();note(r?.meta);const row=r.results[0];return row===undefined?null:column===undefined?row:row[column];};
  const v=(target as any)[key];return typeof v==='function'?v.bind(target):v;}});unwrap.set(p,s);return p;};
 return new Proxy(base,{get(target,key){
  if(key==='prepare')return (sql:string)=>wrap(target.prepare(sql));
  if(key==='batch')return async(list:D1PreparedStatement[])=>{const r:any[]=await target.batch(list.map(s=>unwrap.get(s)||s));r.forEach(x=>note(x?.meta));return r;};
  const v=(target as any)[key];return typeof v==='function'?v.bind(target):v;}});
}
export function db():D1Database{
 const e=env as unknown as MeteredEnv;
 if(!e.BV_D1_METER)return e.DB;
 let m=metered.get(e.DB);if(!m){m=meter(e.DB);metered.set(e.DB,m);}return m;
}
export async function cached<T>(key:string,seconds:number,loader:()=>Promise<T>):Promise<T>{
 const row=await db().prepare('SELECT payload,fetched_at FROM feed_cache WHERE key=?').bind(key).first<{payload:string,fetched_at:string}>();
 if(row&&Date.now()-Date.parse(row.fetched_at)<seconds*1000)return JSON.parse(row.payload) as T;
 const value=await loader();
 await db().prepare('INSERT INTO feed_cache (key,payload,fetched_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,fetched_at=excluded.fetched_at').bind(key,JSON.stringify(value),new Date().toISOString()).run();
 return value;
}
export function sameOrigin(request:Request){const origin=request.headers.get('origin');return !origin||origin===new URL(request.url).origin;}
