// A D1 binding over node:sqlite, for running the site's own request handlers
// on GitHub Actions against a copy of the database. Every write is recorded so
// it can be sent to the real D1 afterwards.
import {DatabaseSync} from 'node:sqlite';

const WRITE=/^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i;
function value(v){
 if(v===undefined)throw new TypeError("D1_TYPE_ERROR: Type 'undefined' not supported for value 'undefined'");
 if(typeof v==='boolean')return v?1:0;
 if(typeof v==='bigint')return Number(v);
 return v;
}
class Statement{
 constructor(d1,sql,params=[]){this.d1=d1;this.sql=sql;this.params=params;}
 bind(...params){return new Statement(this.d1,this.sql,params.map(value));}
 exec(){
  const st=this.d1.sqlite.prepare(this.sql);
  if(st.columns().length){const results=st.all(...this.params);if(WRITE.test(this.sql))this.d1.record(this.sql,this.params,results.length);return {results,meta:{changes:0,rows_read:results.length,rows_written:0}};}
  const r=st.run(...this.params);
  if(WRITE.test(this.sql))this.d1.record(this.sql,this.params,Number(r.changes));
  return {results:[],meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid),rows_read:0,rows_written:Number(r.changes)}};
 }
 async all(){const r=this.exec();return {success:true,results:r.results,meta:r.meta};}
 async run(){const r=this.exec();return {success:true,results:r.results,meta:r.meta};}
 async first(column){const r=this.exec();const row=r.results[0];return row===undefined?null:column===undefined?row:row[column];}
 async raw(options={}){const r=this.exec();const rows=r.results.map(x=>Object.values(x));return options.columnNames?[Object.keys(r.results[0]||{}),...rows]:rows;}
}
export class SqliteD1{
 constructor(path){this.sqlite=new DatabaseSync(path);this.writes=[];this.recording=true;}
 prepare(sql){return new Statement(this,sql);}
 record(sql,params,changes){if(this.recording)this.writes.push({sql,params,changes});}
 async batch(list){
  this.sqlite.exec('BEGIN');
  try{const out=list.map(s=>{const r=s.exec();return {success:true,results:r.results,meta:r.meta};});this.sqlite.exec('COMMIT');return out;}
  catch(e){this.sqlite.exec('ROLLBACK');throw e;}
 }
 async exec(sql){this.sqlite.exec(sql);return {count:1,duration:0};}
 takeWrites(){const w=this.writes;this.writes=[];return w;}
 close(){this.sqlite.close();}
}
