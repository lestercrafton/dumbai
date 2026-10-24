import test from 'node:test';import assert from 'node:assert/strict';
import {todayPlays,ctDate,playCover,scoreClock,fitSequentialKelly} from './today-plays.mjs';
const g=(id,p,extra={})=>({id,sport:'cfb',status:'scheduled',startTime:'2026-10-24T21:00:00Z',side:'away',home:{name:'H'},away:{name:'A'},market:{homeSpread:-3,homeSpreadPrice:-110,awaySpreadPrice:-110},rankSignal:{winChance:p},...extra});
test('sorts by Kelly, zero Kelly is No pick, other days excluded, finals kept for status',()=>{
 const out=todayPlays([g('1',0.55),g('2',0.6),g('3',0.5),g('4',0.7,{startTime:'2026-10-26T21:00:00Z'}),g('5',0.7,{status:'final'})],{cfb:1_000_000},ctDate('2026-10-24T21:00:00Z'));
 assert.deepEqual(out.rows.filter(r=>!r.done).map(r=>r.id),['cfb:2','cfb:1','cfb:3']);
 assert.ok(out.rows.some(r=>r.id==='cfb:5'&&r.done));
 assert.equal(out.rows.find(r=>r.id==='cfb:3').wager,0);assert.equal(out.rows.find(r=>r.id==='cfb:2').line,3);
 assert.ok(Math.abs(out.total-out.bySport.cfb)<1e-9);
});
test('uses locked pick revision price',()=>{
 const out=todayPlays([g('1',0.6,{status:'live',pickRevision:{side:'home',marketHomeSpread:-2.5,odds:+105}})],{cfb:100},'2026-10-24');
 assert.equal(out.rows[0].pick,'H');assert.equal(out.rows[0].odds,105);assert.equal(out.rows[0].line,-2.5);
});
test('live cover status matches the card labels and colors',()=>{
 const now=Date.parse('2026-10-24T02:00:00Z');
 const game={sport:'cfb',status:'live',scoreObservedAt:'2026-10-24T01:59:00Z',retrievedAt:'2026-10-24T01:59:00Z',period:4,clock:'7:14',
  home:{name:'Pennsylvania Quakers',abbreviation:'PENN'},away:{name:'Yale Bulldogs',abbreviation:'YALE'},
  side:'home',marketHomeSpread:6.5,liveHomeScore:24,liveAwayScore:21};
 const c=playCover(game,now);assert.equal(c.state,'covering');assert.match(c.label,/^Covering by /);
 assert.deepEqual(scoreClock(game,now),{score:'YALE 21–24 PENN',clock:'Q4 · 7:14'});
 const need=playCover({...game,liveHomeScore:10},now);assert.equal(need.state,'not-covering');assert.match(need.label,/^Needs /);
 assert.equal(scoreClock({...game,finalPendingGrade:true},now).clock,'FINAL');
 assert.equal(playCover({...game,result:{status:'completed',outcome:'loss'}},now).label,'Loss');
 assert.equal(playCover({...game,finalPendingGrade:true},now).label,'Win');
 assert.equal(playCover({...game,finalPendingGrade:true,liveHomeScore:10},now).label,'Loss');
});

test('ranks by Kelly % across sports, not dollar wager',()=>{
 const cfb=(id,p)=>({id,sport:'cfb',status:'scheduled',startTime:'2026-10-24T21:00:00Z',side:'away',home:{name:'H'},away:{name:'A'},market:{homeSpread:-3,homeSpreadPrice:-110,awaySpreadPrice:-110},rankSignal:{winChance:p}});
 const mlb=(id,p)=>({id,sport:'mlb',status:'scheduled',startTime:'2026-10-24T21:00:00Z',side:'away',home:{name:'H'},away:{name:'A'},market:{homeSpreadPrice:-110,awaySpreadPrice:-110},rankSignal:{winChance:p}});
 const out=todayPlays([cfb('hi',0.62),mlb('lo',0.54)],{cfb:1_000,mlb:1_000_000},'2026-10-24');
 assert.equal(out.rows[0].id,'cfb:hi');
 assert.ok(out.rows[0].stake>out.rows[1].stake);
 assert.ok(out.rows[0].wager<out.rows[1].wager);
});

test('sequential Kelly stops when the next bet no longer fits the day bankroll',()=>{
 // High win chances → large Kelly fractions; second full-Kelly of opening bankroll won't fit after the first.
 const bankroll=1_000;
 const games=[g('a',0.90),g('b',0.85),g('c',0.80),g('d',0.50)];
 const out=todayPlays(games,{cfb:bankroll},'2026-10-24');
 const placed=out.recommended;
 assert.ok(placed.length>=1);
 assert.ok(placed.length<out.rows.filter(r=>r.stake>0).length,'must drop some positive-Kelly plays');
 assert.ok(out.total<=bankroll+1e-6,'wagered today never exceeds the sport bankroll');
 assert.ok(placed.every(r=>r.recommended&&r.wager>0));
 const passed=out.rows.filter(r=>r.stake>0&&!r.recommended);
 assert.ok(passed.length>=1);
 assert.ok(passed.every(r=>r.wager===0&&r.idealWager>0));
 // Fit helper itself: first takes 70%, second wants 40% of opening → stop.
 const rows=[
  {sport:'cfb',stake:0.7,odds:-110,wager:0,toWin:0},
  {sport:'cfb',stake:0.4,odds:-110,wager:0,toWin:0},
  {sport:'cfb',stake:0.2,odds:-110,wager:0,toWin:0},
 ];
 fitSequentialKelly(rows,{cfb:1000});
 assert.equal(rows[0].wager,700);
 assert.equal(rows[0].recommended,true);
 assert.equal(rows[1].wager,0);
 assert.equal(rows[1].recommended,false);
 assert.equal(rows[1].idealWager,400);
 assert.equal(rows[2].wager,0);
});
