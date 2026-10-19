// Data access for the read-cache renderer (scripts/render-read-cache.mjs).
// The renderer keeps a copy of the database on GitHub Actions, computes the
// public pages there, and sends back the finished bodies plus the same writes a
// visitor's request would have made. Only the renderer workflow may call this.

/** Tables the renderer copies. `changed` names the column every update sets. */
export const RENDER_TABLES=Object.freeze({
 forecasts:{changed:'graded_at'},
 completed_games:{changed:'observed_at'},
 feed_cache:{changed:'fetched_at'},
 collection_runs:{recentBySport:true},
 pick_revision_states:{full:true},
 first_market_observations:{},
 learning_entries:{},
 plays:{full:true},
 challenger_picks:{},
 challenger_results:{full:true},
 playbook_manifests:{},
 promotions:{},
 scoreboards:{},
});
// Tables a renderer write may touch: the ones public GET requests write.
const WRITABLE=new Set(['feed_cache','forecasts','pick_revision_states','completed_games','first_market_observations','collection_runs','plays','challenger_results']);
const MAX_STATEMENTS=400;
export class RenderError extends Error{constructor(message,status=400){super(message);this.status=status;}}
const whole=(v,label,max=Number.MAX_SAFE_INTEGER)=>{const s=String(v??'');if(!/^\d{1,16}$/.test(s))throw new RenderError(label+' must be a whole number.');const n=Number(s);if(n>max)throw new RenderError(label+' is too large.');return n;};
const table=name=>{if(!Object.hasOwn(RENDER_TABLES,name))throw new RenderError('Unknown table.',404);return name;};
const iso=v=>{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(v))throw new RenderError('since must be an ISO timestamp.');return v;};

/** Highest rowid in every copied table (one statement, one row read each). */
export async function maxRowids(db){
 const names=Object.keys(RENDER_TABLES);
 const row=await db.prepare('SELECT '+names.map(n=>`(SELECT max(rowid) FROM ${n}) AS ${n}`).join(',')).first();
 return Object.fromEntries(names.map(n=>[n,Number(row?.[n]??0)]));
}
/** Rows after a rowid, in rowid order. */
export async function rowsAfter(db,name,after,limit){
 const {results}=await db.prepare(`SELECT rowid AS __rowid,* FROM ${table(name)} WHERE rowid>? ORDER BY rowid LIMIT ?`).bind(whole(after,'after'),whole(limit,'limit',2000)).all();
 return results;
}
/** Rows whose change column is after (since, afterRowid), through the column's index. */
export async function rowsChanged(db,name,since,afterRowid,limit){
 const column=RENDER_TABLES[table(name)].changed;if(!column)throw new RenderError('This table has no change column.');
 const {results}=await db.prepare(`SELECT rowid AS __rowid,* FROM ${name} WHERE ${column}>=? AND (${column}>? OR rowid>?) ORDER BY ${column},rowid LIMIT ?`).bind(iso(since),since,whole(afterRowid??'0','afterRowid'),whole(limit,'limit',2000)).all();
 return results;
}
/** The newest collection runs for one sport (the pages read at most 90). */
export async function recentRuns(db,sport,limit){
 if(typeof sport!=='string'||!/^[a-z]{2,8}$/.test(sport))throw new RenderError('Choose a sport.');
 const {results}=await db.prepare('SELECT rowid AS __rowid,* FROM collection_runs WHERE sport=? ORDER BY completed_at DESC LIMIT ?').bind(sport,whole(limit,'limit',200)).all();
 return results;
}
export async function cacheKeys(db){
 const {results}=await db.prepare('SELECT key,status,rendered_at,source,parts,registered_at FROM read_cache ORDER BY key').all();
 return results;
}
/** The writes a public GET made while rendering. Each must insert into or update a table that public GETs write. */
export function checkStatements(list){
 if(!Array.isArray(list)||!list.length||list.length>MAX_STATEMENTS)throw new RenderError(`Send 1 to ${MAX_STATEMENTS} statements.`);
 return list.map(s=>{
  if(!s||typeof s.sql!=='string'||!Array.isArray(s.params))throw new RenderError('Each statement needs sql and params.');
  const sql=s.sql.trim(),m=/^(?:INSERT INTO|UPDATE)\s+([a-z_]+)[\s(]/i.exec(sql);
  if(!m||!WRITABLE.has(m[1])||sql.includes(';')||/\b(DELETE|DROP|ALTER|ATTACH|DETACH|PRAGMA|VACUUM|REPLACE INTO)\b/i.test(sql))throw new RenderError('Statement not allowed.',403);
  if(!s.params.every(v=>v===null||typeof v==='string'||typeof v==='number'))throw new RenderError('Parameters must be text, numbers or null.');
  return {sql,params:s.params};
 });
}
export async function applyStatements(db,list){
 const checked=checkStatements(list);
 const results=await db.batch(checked.map(s=>db.prepare(s.sql).bind(...s.params)));
 return results.map(r=>Number(r?.meta?.changes??0));
}
export async function dropKeys(db,keys){
 if(!Array.isArray(keys)||!keys.length||keys.length>200||!keys.every(k=>typeof k==='string'&&k.length<2000))throw new RenderError('Send 1 to 200 keys.');
 await db.batch(keys.flatMap(k=>[db.prepare('DELETE FROM read_cache_parts WHERE key=?').bind(k),db.prepare('DELETE FROM read_cache WHERE key=?').bind(k)]));
 return keys.length;
}
/** Remove parts left over from earlier renders of a key. */
export async function pruneParts(db){
 const r=await db.prepare('DELETE FROM read_cache_parts WHERE NOT EXISTS (SELECT 1 FROM read_cache c WHERE c.key=read_cache_parts.key AND c.rendered_at=read_cache_parts.rendered_at)').run();
 return Number(r?.meta?.changes??0);
}
