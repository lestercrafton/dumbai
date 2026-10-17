import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {makeCfbReconstructedRecords} from './cfb-reconstructed-records.mjs';
import {withCfbPaperWager} from './cfb-paper-wagers.mjs';

const read=name=>JSON.parse(fs.readFileSync(new URL(name,import.meta.url),'utf8'));
const cohort=read('./college-experiment-cohort-2026-09-26.json');
const opening=read('./cfb-opening-odds-2026-09-26.json');
const records=makeCfbReconstructedRecords(cohort,'2026-09-27T01:35:00Z');

test('every missed game gets a paper position from its frozen model line',()=>{
 const result=records.map(record=>withCfbPaperWager(record,opening));
 assert.equal(result.length,80);
 assert.equal(result.filter(record=>record.paperWager.kind==='archived-opening-spread').length,77);
 assert.equal(result.filter(record=>record.paperWager.kind==='synthetic-winner-even').length,3);
 for(const record of result){
  const wager=record.paperWager;
  assert.ok(['home','away'].includes(wager.side));
  assert.ok(Number.isInteger(wager.odds)&&Math.abs(wager.odds)>=100);
  assert.ok(wager.sourceUrl.includes(record.gameId));
  assert.equal(record.marketHomeSpread,null);
  assert.equal(record.odds,null);
  if(wager.kind==='archived-opening-spread'){
   assert.equal(wager.side,record.predictedMargin+wager.homeSpread>0?'home':'away');
   assert.equal(wager.provider,'DraftKings');
  }else{
   assert.equal(wager.side,record.predictedMargin>0?'home':'away');
   assert.equal(wager.homeSpread,0);
   assert.equal(wager.odds,100);
  }
 }
});

test('verified final scores cannot change the selected paper side or price',()=>{
 const original=records[0];
 const changed={...original,result:{status:'completed',actualMargin:-100,homeScore:0,awayScore:100}};
 assert.deepEqual(withCfbPaperWager(original,opening).paperWager,withCfbPaperWager(changed,opening).paperWager);
 assert.equal(original.paperWager,undefined);
});
