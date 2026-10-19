// Read-only database and file export for moving this site to another host.
// Every statement here is a SELECT or PRAGMA read; nothing writes.
export const DEFAULTS=Object.freeze({inlineLimit:65536,pageBudget:2_000_000,maxPage:500,maxChunk:1_048_576,maxFileList:1000});
const ident=name=>'"'+String(name).replaceAll('"','""')+'"';
export class ExportError extends Error{constructor(message,status=400){super(message);this.status=status;}}

async function tableRows(db){
 const {results}=await db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' ORDER BY name").all();
 return results;
}
async function resolveTable(db,name){
 if(typeof name!=='string'||!name||name.length>200)throw new ExportError('Choose a table.');
 const table=(await tableRows(db)).find(t=>t.name===name);
 if(!table)throw new ExportError('Unknown table.',404);
 if(/without\s+rowid/i.test(table.sql||''))throw new ExportError('Tables without rowid are not supported by this export.',422);
 return table;
}
export async function tableColumns(db,name){
 const {results}=await db.prepare(`PRAGMA table_info(${ident(name)})`).all();
 return results.map(c=>({name:c.name,type:c.type,notnull:!!c.notnull,default:c.dflt_value??null,pk:Number(c.pk)||0}));
}
export async function listTables(db){
 const tables=[];
 for(const t of await tableRows(db)){
  const row=await db.prepare(`SELECT count(*) AS n FROM ${ident(t.name)}`).first();
  tables.push({name:t.name,rows:Number(row?.n??0),sql:t.sql,columns:await tableColumns(db,t.name)});
 }
 const {results:indexes}=await db.prepare("SELECT name,tbl_name AS tableName,sql FROM sqlite_master WHERE type IN ('index','trigger','view') AND sql IS NOT NULL AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND tbl_name NOT LIKE '\\_cf\\_%' ESCAPE '\\' ORDER BY name").all();
 return {tables,schemaObjects:indexes};
}
const whole=(value,label,{min=0,max=Number.MAX_SAFE_INTEGER}={})=>{
 const text=String(value??'');if(!/^\d{1,16}$/.test(text))throw new ExportError(label+' must be a whole number.');
 const n=Number(text);if(!Number.isSafeInteger(n)||n<min||n>max)throw new ExportError(label+' is out of range.');return n;
};
/** One page of rows ordered by rowid. Cells larger than inlineLimit come back as null values with their byte length; fetch them with readCell. */
export async function readRows(db,name,{after='0',limit='200'}={},options={}){
 const o={...DEFAULTS,...options};
 await resolveTable(db,name);
 const columns=await tableColumns(db,name);if(!columns.length)throw new ExportError('Table has no columns.',422);
 const start=whole(after,'after'),count=whole(limit,'limit',{min:1,max:o.maxPage}),inline=whole(o.inlineLimit,'inline');
 const parts=columns.map((c,i)=>{const q=ident(c.name);return `typeof(${q}) AS t${i}, length(CAST(${q} AS BLOB)) AS l${i}, CASE WHEN typeof(${q})='integer' THEN CAST(${q} AS TEXT) WHEN typeof(${q})='blob' THEN CASE WHEN length(${q})<=${inline} THEN hex(${q}) END WHEN typeof(${q})='text' THEN CASE WHEN length(CAST(${q} AS BLOB))<=${inline} THEN ${q} END ELSE ${q} END AS v${i}`;});
 const {results}=await db.prepare(`SELECT rowid AS __rowid, ${parts.join(', ')} FROM ${ident(name)} WHERE rowid>? ORDER BY rowid LIMIT ?`).bind(start,count).all();
 const rows=[];let used=0;
 for(const r of results){
  const t=columns.map((_,i)=>r['t'+i]),l=columns.map((_,i)=>r['l'+i]===null?null:Number(r['l'+i])),v=columns.map((_,i)=>r['v'+i]);
  const size=l.reduce((s,n,i)=>s+(v[i]===null?0:Math.min(n??0,inline))*(t[i]==='blob'?2:1),0)+64;
  if(rows.length&&used+size>o.pageBudget)break;
  used+=size;rows.push({rowid:String(r.__rowid),t,l,v});
 }
 const complete=rows.length===results.length&&results.length<count;
 return {table:name,columns:columns.map(c=>c.name),rows,next:complete?null:rows.length?rows.at(-1).rowid:String(start),inlineLimit:inline};
}
/** Raw bytes of one cell, as hex, starting at byte offset. */
export async function readCell(db,name,{column,rowid,offset='0',length=String(DEFAULTS.maxChunk)}={},options={}){
 const o={...DEFAULTS,...options};
 await resolveTable(db,name);
 const columns=await tableColumns(db,name);if(!columns.some(c=>c.name===column))throw new ExportError('Unknown column.',404);
 const id=whole(rowid,'rowid'),from=whole(offset,'offset'),size=Math.min(whole(length,'length',{min:1}),o.maxChunk),q=ident(column);
 const row=await db.prepare(`SELECT typeof(${q}) AS type, length(CAST(${q} AS BLOB)) AS total, hex(substr(CAST(${q} AS BLOB), ?, ?)) AS hex FROM ${ident(name)} WHERE rowid=?`).bind(from+1,size,id).first();
 if(!row)throw new ExportError('Row not found.',404);
 return {table:name,column,rowid:String(id),type:row.type,total:row.total===null?null:Number(row.total),offset:from,hex:row.hex??''};
}
const checksums=o=>{try{const c=o.checksums?.toJSON?.()??o.checksums??{};return Object.fromEntries(Object.entries(c).filter(([,v])=>typeof v==='string'));}catch{return {};}};
export async function listFiles(bucket,{cursor}={},options={}){
 const o={...DEFAULTS,...options};
 if(!bucket)return {configured:false,objects:[],cursor:null,truncated:false};
 if(cursor!==undefined&&cursor!==null&&(typeof cursor!=='string'||cursor.length>2048))throw new ExportError('Invalid cursor.');
 const page=await bucket.list({limit:o.maxFileList,...(cursor?{cursor}:{}),include:['httpMetadata','customMetadata']});
 return {configured:true,objects:page.objects.map(x=>({key:x.key,size:x.size,etag:x.etag,uploaded:x.uploaded instanceof Date?x.uploaded.toISOString():x.uploaded??null,checksums:checksums(x),httpMetadata:x.httpMetadata??{},customMetadata:x.customMetadata??{}})),cursor:page.truncated?page.cursor:null,truncated:!!page.truncated};
}
export async function readFile(bucket,key){
 if(!bucket)throw new ExportError('No file storage is configured.',404);
 if(typeof key!=='string'||!key||key.length>1024)throw new ExportError('Choose a file.');
 const object=await bucket.get(key);
 if(!object)throw new ExportError('File not found.',404);
 return new Response(object.body,{headers:{'content-type':'application/octet-stream','content-length':String(object.size),'x-export-size':String(object.size),'x-export-etag':object.etag??'','cache-control':'no-store','x-content-type-options':'nosniff'}});
}
const send=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});
/** GET handler body. The caller must authorize before calling this. */
export async function handleExport(url,{db,bucket=null,options={}}){
 const p=new URL(url).searchParams,op=p.get('op');
 try{
  if(op==='tables')return send(await listTables(db));
  if(op==='rows')return send(await readRows(db,p.get('table'),{after:p.get('after')??'0',limit:p.get('limit')??'200'},options));
  if(op==='cell')return send(await readCell(db,p.get('table'),{column:p.get('column'),rowid:p.get('rowid'),offset:p.get('offset')??'0',length:p.get('length')??String(DEFAULTS.maxChunk)},options));
  if(op==='files')return send(await listFiles(bucket,{cursor:p.get('cursor')},options));
  if(op==='file')return await readFile(bucket,p.get('key'));
  return send({error:'Choose op=tables, rows, cell, files or file.'},400);
 }catch(error){
  if(error instanceof ExportError)return send({error:error.message},error.status);
  console.error('Site export read failed',error);return send({error:'Export read failed.'},500);
 }
}
