import test from 'node:test';
import assert from 'node:assert/strict';
import {readForecastPages} from './forecast-pages.mjs';

test('pagination reads beyond the former 12,000-record ceiling without duplicates or gaps',async()=>{
 const rows=Array.from({length:12005},(_,i)=>({id:String(i).padStart(6,'0'),payload:'saved-'+i}));
 const calls=[];
 const result=await readForecastPages(async(cursor,limit)=>{calls.push({cursor,limit});return rows.filter(row=>cursor===null||row.id>cursor).slice(0,limit);});
 assert.deepEqual(result,rows);assert.equal(calls.length,13);assert.equal(calls.at(-1).cursor,'011999');
});
test('an exact page multiple loads the empty terminal page and empty ledgers remain empty',async()=>{
 const rows=[{id:'a'},{id:'b'}];let calls=0;
 const result=await readForecastPages(async(cursor,limit)=>{calls++;return rows.filter(row=>cursor===null||row.id>cursor).slice(0,limit);},2);
 assert.deepEqual(result,rows);assert.equal(calls,2);assert.deepEqual(await readForecastPages(async()=>[]),[]);
});
test('pagination rejects a nonadvancing cursor instead of silently truncating or looping',async()=>{
 await assert.rejects(readForecastPages(async()=>[{id:'a'}],1),/did not advance/);
 await assert.rejects(readForecastPages(async()=>[{id:'b'},{id:'a'}],2),/did not advance/);
});
