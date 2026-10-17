import test from 'node:test';
import assert from 'node:assert/strict';
import {filterByStartTime, liveScorePresentation} from './board-discovery.mjs';

const scheduled = (id, startTime, extra = {}) => ({id, startTime, status:'scheduled', rank:100 - id, ...extra});
const ids = rows => rows.map(row => row.id);
const NOW = Date.parse('2026-10-17T19:00:00Z');
const live = (extra = {}) => ({status:'live', retrievedAt:'2026-10-17T18:59:00Z', liveAwayScore:0, liveHomeScore:7, ...extra});

test('CT clock presets include their exact lower and exclude upper bounds without reranking', () => {
  const rows = [scheduled(1,'2026-10-17T21:59:00Z'), scheduled(2,'2026-10-17T17:00:00Z'), scheduled(3,'2026-10-17T16:59:00Z'), scheduled(4,'2026-10-17T22:00:00Z')];
  const before = structuredClone(rows);
  assert.deepEqual(ids(filterByStartTime(rows,{preset:'morning'})),[3]);
  const afternoon = filterByStartTime(rows,{preset:'afternoon'});
  assert.deepEqual(ids(afternoon),[1,2]);
  assert.equal(afternoon[0],rows[0]);
  assert.deepEqual(afternoon.map(row=>row.rank),[99,98]);
  assert.deepEqual(ids(filterByStartTime(rows,{preset:'evening'})),[4]);
  assert.deepEqual(rows,before);
});

test('custom times are inclusive from, exclusive to, and intersect presets', () => {
  const rows = [scheduled(1,'2026-10-17T17:00:00Z'),scheduled(2,'2026-10-17T17:30:00Z'),scheduled(3,'2026-10-17T18:00:00Z')];
  assert.deepEqual(ids(filterByStartTime(rows,{from:'12:30',to:'13:00'})),[2]);
  assert.deepEqual(ids(filterByStartTime(rows,{from:'13:00'})),[3]);
  assert.deepEqual(ids(filterByStartTime(rows,{to:'12:30'})),[1]);
  assert.deepEqual(ids(filterByStartTime(rows,{preset:'morning',from:'12:00'})),[]);
  assert.deepEqual(ids(filterByStartTime(rows,{from:'12:00',to:'12:00'})),[]);
});

test('overnight custom ranges wrap the CT midnight and keep board order', () => {
  const rows = [scheduled(1,'2026-10-18T04:00:00Z'),scheduled(2,'2026-10-18T05:00:00Z'),scheduled(3,'2026-10-18T06:59:00Z'),scheduled(4,'2026-10-18T07:00:00Z'),scheduled(5,'2026-10-17T22:00:00Z')];
  assert.deepEqual(ids(filterByStartTime(rows,{from:'23:00',to:'02:00'})),[1,2,3]);
});

test('DST spring jump and repeated fall clock use America/Chicago wall-clock time', () => {
  const spring = [scheduled(1,'2026-03-08T07:59:00Z'),scheduled(2,'2026-03-08T08:00:00Z')];
  assert.deepEqual(ids(filterByStartTime(spring,{from:'01:00',to:'03:00'})),[1]);
  assert.deepEqual(ids(filterByStartTime(spring,{from:'02:00',to:'03:00'})),[]);
  const fall = [scheduled(1,'2026-11-01T06:30:00Z'),scheduled(2,'2026-11-01T07:30:00Z'),scheduled(3,'2026-11-01T08:00:00Z')];
  assert.deepEqual(ids(filterByStartTime(fall,{from:'01:00',to:'02:00'})),[1,2]);
  const season = [scheduled(1,'2026-01-17T18:00:00Z'),scheduled(2,'2026-07-17T17:00:00Z')];
  assert.deepEqual(ids(filterByStartTime(season,{from:'12:00',to:'12:01'})),[1,2]);
});

test('TBA and invalid starts remain in all/live and leave only active clock/next filters', () => {
  const rows = [null,'TBA','',false,undefined,'2026-10-17'].map((value,index)=>scheduled(index,value));
  rows.push(scheduled(6,'not a date',{status:'live'}));
  assert.deepEqual(filterByStartTime(rows),rows);
  assert.deepEqual(filterByStartTime(rows,{preset:'evening'}),[]);
  assert.deepEqual(filterByStartTime(rows,{from:'10:00'}),[]);
  assert.deepEqual(ids(filterByStartTime(rows,{preset:'live'})),[6]);
  assert.deepEqual(filterByStartTime(rows,{preset:'next',now:NOW}),[]);
  assert.deepEqual(filterByStartTime(rows,{from:'25:00',to:'garbage'}),rows);
  assert.deepEqual(filterByStartTime(null),[]);
});

test('next includes scheduled future only and retains rank order', () => {
  const rows = [scheduled(1,'2026-10-17T22:00:00Z'),scheduled(2,'2026-10-17T20:00:00Z'),scheduled(3,'2026-10-17T19:00:00Z'),scheduled(4,'2026-10-17T18:00:00Z'),scheduled(5,'2026-10-17T23:00:00Z',{status:'live'}),scheduled(6,'2026-10-17T23:00:00Z',{status:'postponed'}),scheduled(7,'2026-10-17T23:00:00Z',{completed:true}),scheduled(8,'2026-10-17T23:00:00Z',{result:{status:'completed'}})];
  assert.deepEqual(ids(filterByStartTime(rows,{preset:'next',now:NOW})),[1,2]);
  assert.deepEqual(filterByStartTime(rows,{preset:'next',now:'bad'}),[]);
});

test('live status excludes already completed observations even if status is stale', () => {
  const rows = [scheduled(1,null,{status:'live'}),scheduled(2,null,{status:'live',completed:true}),scheduled(3,null,{status:'live',result:{status:'completed'}}),scheduled(4,null)];
  assert.deepEqual(ids(filterByStartTime(rows,{preset:'live'})),[1]);
});

test('live scores preserve zero and actual supplied game details', () => {
  const game = live({statusDescription:'In progress',period:0,clock:'0:00'});
  const before = structuredClone(game);
  assert.deepEqual(liveScorePresentation(game,{now:NOW}),{kind:'live',awayScore:0,homeScore:7,hasScore:true,completeScore:true,freshness:'live',label:'Live score',updatedAt:'2026-10-17T18:59:00.000Z',statusDescription:'In progress',period:0,clock:'0:00'});
  assert.deepEqual(game,before);
  const withoutDetails = liveScorePresentation(live(),{now:NOW});
  for(const field of ['statusDescription','period','clock']) assert.equal(Object.hasOwn(withoutDetails,field),false);
});

test('score freshness distinguishes recent, exact threshold, old, missing and future observations', () => {
  assert.equal(liveScorePresentation(live({retrievedAt:'2026-10-17T18:57:00Z'}),{now:NOW}).freshness,'live');
  const old = liveScorePresentation(live({retrievedAt:'2026-10-17T18:56:59Z'}),{now:NOW});
  assert.equal(old.freshness,'stale');
  assert.equal(old.label,'Stale score');
  for(const retrievedAt of [null,undefined,'bad','', '2026-10-17T19:00:01Z']) {
    assert.equal(liveScorePresentation(live({retrievedAt}),{now:NOW}).freshness,'last-reported');
  }
  assert.equal(liveScorePresentation(live(),{now:'bad'}).freshness,'last-reported');
});

test('offline snapshots and refresh failures retain actual scores as last reported', () => {
  for(const options of [{offline:true},{refreshFailed:true},{offline:true,refreshFailed:true}]) {
    const result = liveScorePresentation(live(),{...options,now:NOW});
    assert.equal(result.freshness,'last-reported');
    assert.equal(result.label,'Last reported score');
    assert.equal(result.awayScore,0);
    assert.equal(result.homeScore,7);
  }
});

test('browser score observation age survives reposting a cached payload', () => {
  const cached = live({retrievedAt:'2026-10-17T19:00:00Z',scoreObservedAt:'2026-10-17T18:56:59Z'});
  const result = liveScorePresentation(cached,{now:NOW});
  assert.equal(result.freshness,'stale');
  assert.equal(result.updatedAt,'2026-10-17T18:56:59.000Z');
  for (const scoreObservedAt of [null,undefined,'invalid','2026-10-17T19:00:01Z']) assert.equal(liveScorePresentation({...cached,scoreObservedAt},{now:NOW}).freshness,'last-reported');
});

test('partial missing scores remain partial and never borrow unrelated final fields', () => {
  const result = liveScorePresentation(live({liveHomeScore:null,homeScore:21}),{now:NOW});
  assert.equal(result.awayScore,0);
  assert.equal(result.homeScore,null);
  assert.equal(result.hasScore,true);
  assert.equal(result.completeScore,false);
  assert.equal(result.freshness,'live');
  const absent = liveScorePresentation(live({liveAwayScore:null,liveHomeScore:undefined,awayScore:0,homeScore:7}),{now:NOW});
  assert.equal(absent.hasScore,false);
  assert.equal(absent.freshness,'unavailable');
  for(const value of [NaN,Infinity,-1,'0',false]) assert.equal(liveScorePresentation(live({liveAwayScore:value}),{now:NOW}).awayScore,null);
});

test('completed board scores and saved API result finals never reuse live scores or infer outcomes', () => {
  const final = liveScorePresentation({status:'completed',completed:true,awayScore:0,homeScore:7,liveAwayScore:99,liveHomeScore:99,retrievedAt:'2026-10-16T18:00:00Z'},{offline:true,now:NOW});
  assert.equal(final.kind,'final');
  assert.equal(final.awayScore,0);
  assert.equal(final.homeScore,7);
  assert.equal(final.label,'Final');
  assert.equal(final.freshness,'final');
  const saved = liveScorePresentation({status:'live',liveAwayScore:3,liveHomeScore:4,result:{status:'completed',awayScore:10,homeScore:7,observedAt:'2026-10-17T18:55:00Z'}},{now:NOW});
  assert.equal(saved.kind,'final');
  assert.equal(saved.awayScore,10);
  assert.equal(saved.homeScore,7);
  assert.equal(saved.updatedAt,'2026-10-17T18:55:00.000Z');
  assert.equal(Object.hasOwn(saved,'outcome'),false);
  const partial = liveScorePresentation({completed:true,awayScore:21,homeScore:24,result:{status:'completed',awayScore:0,homeScore:null}},{now:NOW});
  assert.equal(partial.awayScore,0);
  assert.equal(partial.homeScore,null);
  assert.equal(partial.completeScore,false);
  const noScore = liveScorePresentation({result:{status:'completed',actualMargin:7}},{now:NOW});
  assert.equal(noScore.kind,'final');
  assert.equal(noScore.freshness,'unavailable');
  assert.equal(noScore.hasScore,false);
});

test('scheduled and suspended games do not display placeholder or cached live scores', () => {
  for(const status of ['scheduled','postponed','suspended','cancelled','awaiting-update']) {
    const result = liveScorePresentation({...live(),status,awayScore:0,homeScore:0},{now:NOW});
    assert.equal(result.kind,'none');
    assert.equal(result.hasScore,false);
    assert.equal(result.awayScore,null);
    assert.equal(result.homeScore,null);
    assert.equal(result.freshness,'unavailable');
  }
  assert.equal(liveScorePresentation(null).kind,'none');
});
