#!/usr/bin/env node
// Turns a site export (schema.json + tables/<name>.jsonl from site-export-client.mjs) into
// SQL files for a fresh Cloudflare D1 database that already has the drizzle migrations applied.
// Usage: node scripts/d1-import-from-export.mjs <export-dir> <out-dir>
// Then:  for f in <out-dir>/data-*.sql; do npx wrangler d1 execute big-vin --remote --config wrangler.cloudflare.jsonc --file "$f"; done
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

// Migration bookkeeping is recreated by `wrangler d1 migrations apply`, so it is not copied.
export const SKIP_TABLES=new Set(['d1_migrations','__drizzle_migrations']);
const STATEMENT_LIMIT=90_000,FILE_LIMIT=4_000_000,TEXT_CHUNK=20_000,BLOB_CHUNK=40_000;
const ident=name=>'"'+String(name).replaceAll('"','""')+'"';
const text=value=>"'"+value.replaceAll("'","''")+"'";

function literal(cell){
 if(cell===null)return 'NULL';
 if('integer' in cell){if(!/^-?\d+$/.test(cell.integer))throw Error('bad integer');return cell.integer;}
 if('real' in cell){if(!Number.isFinite(cell.real))throw Error('bad real');const s=String(cell.real);return /[.eE]/.test(s)?s:s+'.0';}
 if('text' in cell)return text(cell.text);
 if('blob' in cell)return "X'"+Buffer.from(cell.blob,'base64').toString('hex')+"'";
 throw Error('unknown cell');
}
function pieces(cell){
 if(cell&&'text' in cell){const out=[];const chars=[...cell.text];for(let i=0;i<chars.length;i+=TEXT_CHUNK)out.push(text(chars.slice(i,i+TEXT_CHUNK).join('')));return {empty:"''",out};}
 if(cell&&'blob' in cell){const b=Buffer.from(cell.blob,'base64'),out=[];for(let i=0;i<b.length;i+=BLOB_CHUNK)out.push("X'"+b.subarray(i,i+BLOB_CHUNK).toString('hex')+"'");return {empty:"X''",out};}
 return null;
}
/** True when the table's rowid is an INTEGER PRIMARY KEY column, so inserting that column keeps the rowid. */
export function rowidAlias(table){
 const pk=table.columns.filter(c=>c.pk>0);
 return pk.length===1&&String(pk[0].type).trim().toUpperCase()==='INTEGER'&&!/without\s+rowid/i.test(table.sql||'')?pk[0].name:null;
}
/** SQL statements that recreate one exported row; long cells are appended in chunks under the D1 statement limit. */
export function rowStatements(table,row){
 const alias=rowidAlias(table),names=table.columns.map(c=>c.name);
 if(row.cells.length!==names.length)throw Error(`${table.name}#${row.rowid}: cell count differs from schema`);
 const cols=alias?names:['rowid',...names],values=row.cells.map(literal);if(!alias)values.unshift(row.rowid);
 const head=`INSERT INTO ${ident(table.name)} (${cols.map(ident).join(', ')}) VALUES (`;
 const whole=head+values.join(', ')+');';
 if(whole.length<=STATEMENT_LIMIT)return [whole];
 const later=[];
 row.cells.forEach((cell,i)=>{const p=pieces(cell);const at=alias?i:i+1;if(p&&values[at].length>2000){values[at]=p.empty;later.push([names[i],p.out]);}});
 const first=head+values.join(', ')+');';
 if(first.length>STATEMENT_LIMIT)throw Error(`${table.name}#${row.rowid}: row is too wide for D1 even after splitting`);
 const out=[first],where=alias?`${ident(alias)} = ${row.rowid}`:`rowid = ${row.rowid}`;
 for(const [column,chunks] of later)for(const chunk of chunks)out.push(`UPDATE ${ident(table.name)} SET ${ident(column)} = ${ident(column)} || ${chunk} WHERE ${where};`);
 return out;
}
/** Order tables so foreign-key parents load first. */
export function loadOrder(tables){
 const byName=new Map(tables.map(t=>[t.name,t])),seen=new Set(),out=[];
 const parents=t=>[...(t.sql||'').matchAll(/REFERENCES\s+[`"]?([A-Za-z0-9_]+)[`"]?/gi)].map(m=>m[1]).filter(n=>n!==t.name&&byName.has(n));
 const visit=(t,stack=new Set())=>{if(seen.has(t.name)||stack.has(t.name))return;stack.add(t.name);for(const p of parents(t))visit(byName.get(p),stack);seen.add(t.name);out.push(t);};
 for(const t of [...tables].sort((a,b)=>a.name.localeCompare(b.name)))visit(t);
 return out;
}
export async function buildImport(exportDir,outDir){
 const schema=JSON.parse(await readFile(join(exportDir,'schema.json'),'utf8'));
 await mkdir(outDir,{recursive:true});
 const plan={tables:{},skipped:[],files:[]};let file=[],size=0,n=0;
 const flush=async()=>{if(!file.length)return;const name=`data-${String(++n).padStart(3,'0')}.sql`;await writeFile(join(outDir,name),'PRAGMA defer_foreign_keys = true;\n'+file.join('\n')+'\n');plan.files.push(name);file=[];size=0;};
 for(const table of loadOrder(schema.tables)){
  if(SKIP_TABLES.has(table.name)){plan.skipped.push(table.name);continue;}
  const lines=(await readFile(join(exportDir,'tables',table.name+'.jsonl'),'utf8')).split('\n').filter(Boolean);
  for(const line of lines)for(const s of rowStatements(table,JSON.parse(line))){if(size+s.length>FILE_LIMIT)await flush();file.push(s);size+=s.length+1;}
  plan.tables[table.name]=lines.length;
 }
 await flush();
 const verify=Object.keys(plan.tables).map(t=>`SELECT ${text(t)} AS table_name, count(*) AS rows FROM ${ident(t)}`).join(';\n');
 // One SELECT per statement: D1 caps the number of terms in a compound SELECT.
 await writeFile(join(outDir,'verify-counts.sql'),verify+';\n');
 await writeFile(join(outDir,'expected-counts.json'),JSON.stringify(plan,null,1));
 return plan;
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
 const [exportDir,outDir]=process.argv.slice(2);
 if(!exportDir||!outDir){console.error('Usage: node scripts/d1-import-from-export.mjs <export-dir> <out-dir>');process.exit(2);}
 const plan=await buildImport(exportDir,outDir);
 console.log(JSON.stringify({files:plan.files.length,tables:plan.tables,skipped:plan.skipped}));
}
