import test from 'node:test';import assert from 'node:assert/strict';
import {todayPlays,ctDate} from './today-plays.mjs';
const g=(id,p,extra={})=>({id,sport:'cfb',status:'scheduled',startTime:'2026-10-24T21:00:00Z',side:'away',home:{name:'H'},away:{name:'A'},market:{homeSpread:-3,homeSpreadPrice:-110,awaySpreadPrice:-110},rankSignal:{winChance:p},...extra});
test('sorts by wager, zero Kelly is a no bet, other days and finals excluded',()=>{
 const out=todayPlays([g('1',0.55),g('2',0.6),g('3',0.5),g('4',0.7,{startTime:'2026-10-26T21:00:00Z'}),g('5',0.7,{status:'final'})],{cfb:1_000_000},ctDate('2026-10-24T21:00:00Z'));
 assert.deepEqual(out.rows.map(r=>r.id),['cfb:2','cfb:1','cfb:3']);
 assert.equal(out.rows[2].wager,0);assert.equal(out.rows[0].line,3);
 assert.ok(Math.abs(out.rows[0].toWin-out.rows[0].wager/1.1)<1e-6);
 assert.ok(Math.abs(out.total-out.bySport.cfb)<1e-9);
});
test('uses locked pick revision price',()=>{
 const out=todayPlays([g('1',0.6,{status:'live',pickRevision:{side:'home',marketHomeSpread:-2.5,odds:+105}})],{cfb:100},'2026-10-24');
 assert.equal(out.rows[0].pick,'H');assert.equal(out.rows[0].odds,105);assert.equal(out.rows[0].line,-2.5);
});
