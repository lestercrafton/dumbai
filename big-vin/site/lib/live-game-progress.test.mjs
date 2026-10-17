import test from 'node:test';
import assert from 'node:assert/strict';
import {liveGameProgress} from './live-game-progress.mjs';

const now = Date.parse('2026-10-17T03:00:00Z');
const game = extra => ({sport:'nfl',status:'live',retrievedAt:'2026-10-17T02:59:00Z',liveAwayScore:14,liveHomeScore:10,period:4,clock:'3:21',...extra});
const label = extra => liveGameProgress(game(extra),{now}).label;

test('uses the supplied period clock, preserving zero without extrapolation', () => {
  assert.equal(label(), 'Q4 · 3:21 remaining');
  assert.equal(label({clock:'0:00'}), 'Q4 · 0:00 remaining');
  assert.equal(liveGameProgress(game(),{now:now+60000}).label,'Q4 · 3:21 remaining');
  assert.equal(label({sport:'nba',period:3,clock:'0.1'}),'Q3 · 0.1 remaining');
});

test('football, basketball and hockey preserve sport-specific regulation and overtime', () => {
  for (const sport of ['nfl','nba','wnba']) {
    assert.equal(label({sport,period:5}),'OT · 3:21 remaining');
    assert.equal(label({sport,period:6}),'2OT · 3:21 remaining');
  }
  assert.equal(label({sport:'cfb',period:5,clock:'0:00'}),'OT · Untimed overtime');
  assert.equal(label({sport:'cfb',period:6,clock:'0:00'}),'2OT · Untimed overtime');
  assert.equal(label({sport:'cbb',period:2}),'Half 2 · 3:21 remaining');
  assert.equal(label({sport:'cbb',period:3}),'OT · 3:21 remaining');
  assert.equal(label({sport:'nhl',period:3}),'Period 3 · 3:21 remaining');
  assert.equal(label({sport:'nhl',period:4}),'OT · 3:21 remaining');
  assert.equal(label({sport:'nhl',period:5,clock:'0:00',statusName:'STATUS_SHOOTOUT',statusDetail:'Shootout'}),'Shootout · Untimed');
  assert.equal(label({sport:'nhl',period:5,clock:'0:00',statusDetail:'SO'}),'Shootout · Untimed');
});

test('halftime and intermission do not suggest a running countdown', () => {
  assert.equal(label({statusName:'STATUS_HALFTIME',period:2,clock:'0:00'}),'Halftime');
  assert.equal(label({sport:'nhl',statusName:'STATUS_END_PERIOD',statusDetail:'End of 2nd',period:2,clock:'0:00'}),'End of 2nd');
  assert.equal(label({statusName:'STATUS_END_PERIOD',period:1}),'End of Q1');
});

test('baseball shows factual inning and outs and never a countdown', () => {
  assert.equal(label({sport:'mlb',period:10,isTopInning:true,outs:0}),'Top 10 · 0 outs');
  assert.equal(label({sport:'mlb',period:9,isTopInning:false,outs:1}),'Bottom 9 · 1 out');
  assert.equal(label({sport:'mlb',period:7,isTopInning:undefined,outs:2}),'Inning 7 · 2 outs');
  assert.equal(label({sport:'mlb',period:9,statusDetail:'Bottom 9th',outs:1}),'Bottom 9th · 1 out');
  assert.equal(label({sport:'mlb',period:null,statusDetail:'Middle 7th',statusName:'STATUS_MIDDLE_INNING'}),'Middle 7th');
  assert.equal(label({sport:'mlb',period:null,outs:99}),'Inning unavailable');
});

test('missing and invalid progress stays explicitly unavailable', () => {
  assert.equal(label({period:null,clock:null}),'Period unavailable · Game clock unavailable');
  assert.equal(label({period:-1,clock:''}),'Period unavailable · Game clock unavailable');
  assert.equal(label({period:undefined,statusName:'STATUS_OVERTIME'}),'OT · 3:21 remaining');
});

test('stale/offline/failed observations identify progress as last reported', () => {
  assert.equal(label({retrievedAt:'2026-10-17T02:56:00Z'}),'Last reported: Q4 · 3:21 remaining');
  for (const options of [{offline:true},{refreshFailed:true}]) {
    assert.equal(liveGameProgress(game(),{now,...options}).label,'Last reported: Q4 · 3:21 remaining');
  }
  assert.equal(label({retrievedAt:null}),'Last reported: Q4 · 3:21 remaining');
});

test('finals, future and suspended games never show a live clock or mutate data', () => {
  for (const extra of [{status:'completed'},{completed:true},{result:{status:'completed'}},{status:'scheduled'},{status:'suspended'}]) assert.equal(liveGameProgress(game(extra),{now}),null);
  const input=game(), before=structuredClone(input);
  liveGameProgress(input,{now});
  assert.deepEqual(input,before);
});
