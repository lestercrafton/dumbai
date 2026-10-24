// Read cache for the Cloudflare free plan. Public GET responses are computed
// ahead of time (scripts/render-read-cache.mjs on GitHub Actions) and stored in
// D1, so a visitor request costs one indexed row read instead of a full
// recompute. Pure helpers here; edge.mjs wires them to the Worker.

// The same Vary header vinext adds to every response.
export const VINEXT_VARY='RSC, Next-Router-State-Tree, Next-Router-Prefetch, Next-Router-Segment-Prefetch, Next-Url, X-Vinext-Interception-Context, X-Vinext-Mounted-Slots, X-Vinext-Rsc-Render-Mode';
// A cached API body older than this is recomputed on the request (as before
// the cache existed) so a stalled renderer never leaves the site frozen.
export const MAX_AGE_MS=45*60*1000;
// D1 rows top out at 2 MB; longer bodies are split into parts.
export const PART_CHARS=900_000;
export const MAX_BODY_CHARS=20_000_000;
const PLAYBOOK_VIEWS=new Set(['challengers','versions','scoreboards']);
const ROUTER_HEADERS=['rsc','next-router-state-tree','next-router-prefetch','next-router-segment-prefetch','next-url','x-vinext-interception-context','x-vinext-mounted-slots','x-vinext-rsc-render-mode'];

/** Sorted query string, so the same request from any page maps to one key. */
export function canonicalQuery(searchParams){
 const pairs=[...searchParams.entries()].sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:a[1]<b[1]?-1:a[1]>b[1]?1:0);
 return pairs.length?'?'+new URLSearchParams(pairs).toString():'';
}
/** Cache key for a public GET API request, or null when the route must run live. */
export function apiCacheKey(url){
 const u=typeof url==='string'?new URL(url):url;
 const path=u.pathname;
 if(path==='/api/playbook'){if(!PLAYBOOK_VIEWS.has(u.searchParams.get('view')||''))return null;}
 else if(!['/api/slate','/api/results','/api/learning','/api/college-experiment','/api/bankroll'].includes(path))return null;
 return 'api:'+path+canonicalQuery(u.searchParams);
}
export function routerRequest(request){return ROUTER_HEADERS.some(h=>request.headers.has(h));}
/** Eastern sports date, matching lib/time.ts sportsDay(). */
export function easternDay(ms=Date.now()){
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(ms));
 const get=k=>parts.find(p=>p.type===k)?.value;
 return `${get('year')}-${get('month')}-${get('day')}`;
}
/** The home page renders today's Eastern date, so its HTML is cached per deployment and day. */
export function pageCacheKey(url,version,ms=Date.now()){
 const u=typeof url==='string'?new URL(url):url;
 if(u.pathname!=='/')return null;
 return `page:${version||'unversioned'}:${easternDay(ms)}:/${canonicalQuery(u.searchParams)}`;
}
/** Client-side navigation payloads (RSC) for a page, per deployment, day and router state. */
export function rscCacheKey(request,version,ms=Date.now()){
 const u=new URL(request.url);
 if(u.pathname.startsWith('/api/'))return null;
 const state=ROUTER_HEADERS.map(h=>request.headers.get(h)??'').join('\u0001');
 const key=`rsc:${version||'unversioned'}:${easternDay(ms)}:${u.pathname}${canonicalQuery(u.searchParams)}:${state}`;
 return key.length<=4000?key:null;
}
export function splitBody(body,size=PART_CHARS){
 const parts=[];for(let i=0;i<body.length;i+=size)parts.push(body.slice(i,i+size));
 return parts.length?parts:[''];
}
const KEPT_HEADERS=new Set(['content-type','cache-control','vary','content-language']);
export function storableHeaders(headers){
 const out=[];for(const [k,v] of headers)if(KEPT_HEADERS.has(k.toLowerCase()))out.push([k.toLowerCase(),v]);
 return out.sort((a,b)=>a[0]<b[0]?-1:1);
}
export function fresh(row,now=Date.now(),maxAge=MAX_AGE_MS){
 const t=Date.parse(row?.rendered_at);return Number.isFinite(t)&&now-t<maxAge&&now-t>-300000;
}

// Bodies the renderer stores are gzipped and base64-encoded behind this prefix:
// a tenth of the size to move out of D1, and the bytes go out as they are.
export const GZIP_PREFIX='gzip64:';
/** Read a cached body: one row, plus one per extra part for long bodies. */
export async function readCached(db,key,meter){
 const first=await db.prepare('SELECT status,headers,rendered_at,parts,body FROM read_cache WHERE key=?').bind(key).all();
 meter?.(first.meta);
 const row=first.results[0];
 if(!row)return null;
 let body=row.body;
 if(row.parts>1){
  const rest=await db.prepare('SELECT part,body FROM read_cache_parts WHERE key=? AND rendered_at=? ORDER BY part').bind(key,row.rendered_at).all();
  meter?.(rest.meta);
  if(rest.results.length!==row.parts-1)return null;
  body+=rest.results.map(r=>r.body).join('');
 }
 return {status:row.status,headers:JSON.parse(row.headers),renderedAt:row.rendered_at,body};
}
/** Statements that store a body. Extra parts go in first; the main row flips last, and never back to an older render. */
export function storeStatements(db,{key,status,headers,renderedAt,source,body}){
 const parts=splitBody(body);
 const statements=parts.slice(1).map((part,i)=>db.prepare('INSERT INTO read_cache_parts (key,rendered_at,part,body) VALUES (?,?,?,?) ON CONFLICT(key,rendered_at,part) DO UPDATE SET body=excluded.body').bind(key,renderedAt,i+1,part));
 statements.push(db.prepare('INSERT INTO read_cache (key,status,headers,rendered_at,source,parts,body,registered_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET status=excluded.status,headers=excluded.headers,rendered_at=excluded.rendered_at,source=excluded.source,parts=excluded.parts,body=excluded.body WHERE excluded.rendered_at>=read_cache.rendered_at')
  .bind(key,status,JSON.stringify(headers),renderedAt,source,parts.length,parts[0],renderedAt));
 return statements;
}
export function cachedResponse(hit,state,{acceptsGzip=true,decodeBase64}={}){
 const headers=new Headers(hit.headers);
 headers.set('x-big-vin-cache',state);headers.set('x-big-vin-rendered-at',hit.renderedAt);
 if(!hit.body.startsWith(GZIP_PREFIX))return new Response(hit.body,{status:hit.status,headers});
 const bytes=decodeBase64(hit.body.slice(GZIP_PREFIX.length));
 if(acceptsGzip){headers.set('content-encoding','gzip');return new Response(bytes,{status:hit.status,headers,encodeBody:'manual'});}
 return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),{status:hit.status,headers});
}

// Workers Cache (cache.enabled in wrangler.cloudflare.jsonc) answers repeat
// requests at the edge without starting the Worker. Only Cloudflare reads this
// header; the browser keeps the app's own Cache-Control, as before.
export const EDGE_HEADER='cloudflare-cdn-cache-control';
export const EDGE_API_SECONDS=60;
export const EDGE_PAGE_SECONDS=300;
export const EDGE_STALE_SECONDS=300;
export const EDGE_NO_STORE='no-store';
export const EDGE_NOT_FOUND='public, max-age=300';
/** Seconds until the next Eastern midnight, when the per-day page keys roll over. */
export function secondsToEasternMidnight(ms=Date.now()){
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(ms));
 const get=k=>Number(parts.find(p=>p.type===k)?.value);
 return Math.max(0,86400-(get('hour')*3600+get('minute')*60+get('second')));
}
/** Edge directive for a cacheable 200 response. Per-day pages never outlive their day. */
export function edgeDirective(kind,ms=Date.now()){
 if(kind==='api')return `public, max-age=${EDGE_API_SECONDS}, stale-while-revalidate=${EDGE_STALE_SECONDS}`;
 const left=secondsToEasternMidnight(ms);
 if(left<=5)return EDGE_NO_STORE;
 return `public, max-age=${Math.min(EDGE_PAGE_SECONDS,left)}, stale-while-revalidate=${Math.min(EDGE_STALE_SECONDS,left)}`;
}
/** Set the edge directive, copying the response when its headers are immutable. */
export function withEdge(response,directive){
 try{response.headers.set(EDGE_HEADER,directive);return response;}
 catch{const copy=new Response(response.body,response);copy.headers.set(EDGE_HEADER,directive);return copy;}
}
