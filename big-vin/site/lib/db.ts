import {env} from 'cloudflare:workers';
export function db():D1Database{return (env as unknown as {DB:D1Database}).DB;}
export async function cached<T>(key:string,seconds:number,loader:()=>Promise<T>):Promise<T>{
 const row=await db().prepare('SELECT payload,fetched_at FROM feed_cache WHERE key=?').bind(key).first<{payload:string,fetched_at:string}>();
 if(row&&Date.now()-Date.parse(row.fetched_at)<seconds*1000)return JSON.parse(row.payload) as T;
 const value=await loader();
 await db().prepare('INSERT INTO feed_cache (key,payload,fetched_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,fetched_at=excluded.fetched_at').bind(key,JSON.stringify(value),new Date().toISOString()).run();
 return value;
}
export function sameOrigin(request:Request){const origin=request.headers.get('origin');return !origin||origin===new URL(request.url).origin;}
