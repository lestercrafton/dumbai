import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeTotalGames,totalsHasPicks,totalsRecordDays,TOTALS_RECORD_SPORTS} from './totals-record.mjs';

test('totals sports list is the over/under experiment set',()=>{
 assert.deepEqual([...TOTALS_RECORD_SPORTS],['nfl','cfb','nba','wnba','cbb']);
});

test('summarizeTotalGames grades over/under at flat $1 and ignores no-side rows',()=>{
 const games=[
  {side:'under',price:-110,result:'win',startTime:'2026-10-22T23:00:00.000Z'},
  {side:'over',price:-110,result:'loss',startTime:'2026-10-22T23:30:00.000Z'},
  {side:'under',price:100,result:'push',startTime:'2026-10-23T00:00:00.000Z'},
  {side:null,result:null,startTime:'2026-10-23T01:00:00.000Z'},
  {side:'over',price:-115,result:null,startTime:'2026-10-24T16:00:00.000Z'},
 ];
 const s=summarizeTotalGames(games);
 assert.equal(s.recorded,4);
 assert.equal(s.graded,3);
 assert.equal(s.wins,1);
 assert.equal(s.losses,1);
 assert.equal(s.pushes,1);
 assert.equal(s.pending,1);
 assert.equal(s.winRate,0.5);
 assert.equal(s.risked,3);
 assert.ok(Math.abs(s.units-(100/110-1))<1e-9);
 assert.equal(s.decided,2);
 assert.equal(s.truthLogs.length,6);
});

test('totalsRecordDays buckets by sports day of kickoff',()=>{
 const dayOf=iso=>new Date(iso).toLocaleDateString('en-CA',{timeZone:'America/New_York'});
 const games=[
  {side:'under',price:-110,result:'win',startTime:'2026-10-22T23:00:00.000Z'},
  {side:'over',price:-110,result:'loss',startTime:'2026-10-23T16:00:00.000Z'},
 ];
 const days=totalsRecordDays(games,dayOf);
 assert.equal(days.length,2);
 assert.equal(days[0].wins+days[0].losses+days[0].pushes+days[1].wins+days[1].losses,2);
});

test('totalsHasPicks requires an over or under side',()=>{
 assert.equal(totalsHasPicks({games:{a:{side:null},b:{side:'under'}}}),true);
 assert.equal(totalsHasPicks({games:{a:{side:null}}}),false);
 assert.equal(totalsHasPicks(null),false);
});
