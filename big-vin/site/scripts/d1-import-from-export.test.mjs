import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {buildImport,loadOrder} from './d1-import-from-export.mjs';

test('an export round-trips into a fresh database, long cells and all',async()=>{
 const source=new DatabaseSync(':memory:');
 const ddl=["CREATE TABLE parent (id integer PRIMARY KEY, name text NOT NULL)","CREATE TABLE child (key text PRIMARY KEY NOT NULL, parent_id integer REFERENCES parent(id), body text NOT NULL, data blob, score real)","CREATE TABLE d1_migrations (id integer PRIMARY KEY, name text)"];
 for(const s of ddl)source.exec(s);
 source.exec("INSERT INTO parent VALUES (7,'it''s')");
 const long='é'.repeat(70000)+"'x";
 source.prepare('INSERT INTO child VALUES (?,?,?,?,?)').run('a',7,long,Buffer.alloc(120000,3),1.5);
 source.prepare('INSERT INTO child VALUES (?,?,?,?,?)').run('b',null,'short',null,2);
 const dir=await mkdtemp(join(tmpdir(),'export-'));await mkdir(join(dir,'tables'));
 const tables=[];
 for(const {name,sql} of source.prepare("SELECT name,sql FROM sqlite_master WHERE type='table'").all()){
  const columns=source.prepare(`PRAGMA table_info("${name}")`).all().map(c=>({name:c.name,type:c.type,pk:c.pk}));
  tables.push({name,sql,columns});
  const rows=source.prepare(`SELECT rowid AS __r, * FROM "${name}" ORDER BY rowid`).all();
  const cell=v=>v===null?null:typeof v==='bigint'||Number.isInteger(v)&&columns?{integer:String(v)}:typeof v==='number'?{real:v}:typeof v==='string'?{text:v}:{blob:Buffer.from(v).toString('base64')};
  await writeFile(join(dir,'tables',name+'.jsonl'),rows.map(r=>JSON.stringify({rowid:String(r.__r),cells:columns.map(c=>c.name==='score'?{real:r.score}:cell(r[c.name]))})).join('\n')+'\n');
 }
 await writeFile(join(dir,'schema.json'),JSON.stringify({tables}));
 const out=join(dir,'sql'),plan=await buildImport(dir,out);
 assert.deepEqual(plan.skipped,['d1_migrations']);assert.deepEqual(plan.tables,{parent:1,child:2});
 const target=new DatabaseSync(':memory:');target.exec('PRAGMA foreign_keys=ON');for(const s of ddl.slice(0,2))target.exec(s);
 for(const f of plan.files){const sql=await readFile(join(out,f),'utf8');for(const line of sql.split('\n'))assert.ok(line.length<=90000);target.exec('BEGIN');target.exec(sql);target.exec('COMMIT');}
 const a=target.prepare("SELECT rowid,* FROM child WHERE key='a'").get();
 assert.equal(a.body,long);assert.deepEqual(Buffer.from(a.data),Buffer.alloc(120000,3));assert.equal(a.score,1.5);assert.equal(a.parent_id,7);
 assert.equal(target.prepare("SELECT name FROM parent WHERE id=7").get().name,"it's");
 assert.equal(target.prepare("SELECT score FROM child WHERE key='b'").get().score,2);
 assert.equal(target.prepare("SELECT typeof(score) t FROM child WHERE key='b'").get().t,'real');
 const counts=(await readFile(join(out,'verify-counts.sql'),'utf8')).split(';\n').filter(Boolean).map(q=>target.prepare(q).get());
 assert.deepEqual(counts.map(c=>[c.table_name,c.rows]),[['parent',1],['child',2]]);
});
test('foreign-key parents load first',()=>{
 const order=loadOrder([{name:'a_child',sql:'CREATE TABLE a_child (x integer REFERENCES `z_parent`(id))'},{name:'z_parent',sql:'CREATE TABLE z_parent (id integer)'}]);
 assert.deepEqual(order.map(t=>t.name),['z_parent','a_child']);
});
