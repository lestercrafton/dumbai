import test from 'node:test';
import assert from 'node:assert/strict';
import {aggregateRecordDays,calendarRecordWeek} from './record-periods.mjs';

test('Monday–Sunday record windows use saved date keys across year and DST boundaries',()=>{
 assert.deepEqual(calendarRecordWeek('2027-01-03'),{start:'2026-12-28',end:'2027-01-03'});
 assert.deepEqual(calendarRecordWeek('2026-11-01'),{start:'2026-10-26',end:'2026-11-01'});
 assert.deepEqual(calendarRecordWeek('2026-11-02'),{start:'2026-11-02',end:'2026-11-08'});
 for(const invalid of ['2026-02-30','not-a-date','2026-1-01',''])assert.equal(calendarRecordWeek(invalid),null);
});

test('weekly percentages divide pooled wins by decided samples, never average daily rates',()=>{
 const days=[{date:'2026-10-12',recorded:1,graded:1,wins:1,losses:0,pushes:0,pending:0,winRate:1},
  {date:'2026-10-18',recorded:9,graded:9,wins:0,losses:9,pushes:0,pending:0,winRate:0},
  {date:'2026-10-19',recorded:50,graded:50,wins:50,losses:0,pushes:0,pending:0,winRate:1}];
 const before=JSON.stringify(days),result=aggregateRecordDays(days,calendarRecordWeek('2026-10-17'));
 assert.equal(result.recorded,10);assert.equal(result.wins,1);assert.equal(result.losses,9);assert.equal(result.winRate,0.1);
 assert.equal(JSON.stringify(days),before);
});

test('pushes, pending, voids and finals without lines stay outside the decided denominator',()=>{
 const result=aggregateRecordDays([{date:'2026-10-17',recorded:10,graded:6,wins:2,losses:1,pushes:2,pending:3,voids:1,unlined:1,offered:9,pricedGames:4}],calendarRecordWeek('2026-10-17'));
 assert.equal(result.winRate,2/3);assert.equal(result.graded,6);assert.equal(result.pushes,2);assert.equal(result.pending,3);assert.equal(result.voids,1);assert.equal(result.unlined,1);assert.equal(result.offered,9);assert.equal(result.pricedGames,4);
});

test('empty periods do not invent a win percentage or priced return',()=>{
 const result=aggregateRecordDays([],calendarRecordWeek('2026-10-17'));
 assert.equal(result.recorded,0);assert.equal(result.winRate,null);assert.equal(result.profit,null);assert.equal(result.profitUnits,null);
 assert.equal(aggregateRecordDays([{date:'2026-10-17',wins:1}],null).wins,0);
});

test('saved period profit contributions retain zero and do not replay stakes',()=>{
 const period=calendarRecordWeek('2026-10-17');
 const result=aggregateRecordDays([{date:'2026-10-12',profit:12.25,profitUnits:1.225},{date:'2026-10-17',profit:-12.25,profitUnits:-1.225},{date:'2026-10-18',profit:null,profitUnits:null}],period);
 assert.equal(result.profit,0);assert.equal(result.profitUnits,0);
});
