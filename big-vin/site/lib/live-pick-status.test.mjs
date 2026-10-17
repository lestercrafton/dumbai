import test from 'node:test';
import assert from 'node:assert/strict';
import {livePickStatus} from './live-pick-status.mjs';

const now = Date.parse('2026-10-17T19:00:00Z');
const game = (extra = {}) => ({status:'live',retrievedAt:'2026-10-17T18:59:00Z',
  home:{name:'Home',abbreviation:'H'},away:{name:'Away',abbreviation:'A'},
  side:'home',marketHomeSpread:-3.5,predictedMargin:7,edge:3.5,
  liveHomeScore:24,liveAwayScore:20,...extra});
const status = (extra = {}, options = {}) => livePickStatus(game(extra),{now,...options});

test('home and away favorites/dogs are evaluated against the displayed ATS line', () => {
  const cases = [
    {side:'home',marketHomeSpread:-3.5,liveHomeScore:24,liveAwayScore:20,line:-3.5,state:'covering',margin:0.5},
    {side:'home',marketHomeSpread:-3.5,liveHomeScore:21,liveAwayScore:20,line:-3.5,state:'not-covering',margin:-2.5},
    {side:'home',marketHomeSpread:3.5,liveHomeScore:17,liveAwayScore:20,line:3.5,state:'covering',margin:0.5},
    {side:'home',marketHomeSpread:3.5,liveHomeScore:14,liveAwayScore:20,line:3.5,state:'not-covering',margin:-2.5},
    {side:'away',marketHomeSpread:3.5,liveHomeScore:20,liveAwayScore:24,line:-3.5,state:'covering',margin:0.5},
    {side:'away',marketHomeSpread:3.5,liveHomeScore:20,liveAwayScore:21,line:-3.5,state:'not-covering',margin:-2.5},
    {side:'away',marketHomeSpread:-3.5,liveHomeScore:20,liveAwayScore:17,line:3.5,state:'covering',margin:0.5},
    {side:'away',marketHomeSpread:-3.5,liveHomeScore:20,liveAwayScore:14,line:3.5,state:'not-covering',margin:-2.5},
  ];
  for(const {line,state,margin,...row} of cases) {
    const result = status(row);
    assert.equal(result.state,state,JSON.stringify(row));
    assert.equal(result.line,line);
    assert.equal(result.coverMargin,margin);
    assert.equal(result.provisional,true);
    assert.equal(result.isWinning,state === 'covering');
    assert.equal(result.tone,state === 'covering' ? 'winning' : 'neutral');
  }
});

test('ties and pushes depend on spread; all non-winning states have a neutral tone', () => {
  const push = status({marketHomeSpread:-3,liveHomeScore:23,liveAwayScore:20});
  assert.equal(push.state,'push');
  assert.equal(push.coverMargin,0);
  assert.equal(push.label,'Currently a push');
  assert.equal(push.isWinning,false);
  assert.equal(push.tone,'neutral');
  assert.equal(status({marketHomeSpread:0,liveHomeScore:0,liveAwayScore:0}).state,'push');
  assert.equal(status({marketHomeSpread:3,liveHomeScore:0,liveAwayScore:0}).state,'covering');
  assert.equal(status({marketHomeSpread:-3,liveHomeScore:0,liveAwayScore:0}).state,'not-covering');
  const floatingPush = status({marketHomeSpread:0.1,liveHomeScore:0.2,liveAwayScore:0.3});
  assert.equal(floatingPush.state,'push');
  assert.equal(floatingPush.coverMargin,0);
});

test('saved and archived original lines take precedence over a changed current market', () => {
  const saved = status({marketHomeSpread:-7,market:{homeSpread:-1},liveHomeScore:24,liveAwayScore:20});
  assert.equal(saved.line,-7);
  assert.equal(saved.state,'not-covering');
  const archived = status({forecastOrigin:'cfb-reconstructed-2026-09-26',
    paperWager:{kind:'archived-opening-spread',side:'home',homeSpread:7},
    marketHomeSpread:-7,market:{homeSpread:-10},liveHomeScore:17,liveAwayScore:20});
  assert.equal(archived.line,7);
  assert.equal(archived.pick,'H +7.0');
  assert.equal(archived.coverMargin,4);
  assert.equal(archived.state,'covering');
  // A normal archived quote's old market timestamp is not score staleness.
  assert.equal(status({archived:true,market:{observedAt:'2026-09-17T00:00:00Z',homeSpread:-10}}).state,'covering');
});

test('missing scores/line, explicit null side, and synthetic paper winners never create a live ATS pick', () => {
  const cases = [
    [{liveHomeScore:null},'incomplete-score'],
    [{liveAwayScore:undefined,awayScore:20},'incomplete-score'],
    [{liveHomeScore:NaN},'incomplete-score'],
    [{marketHomeSpread:null},'no-ats-pick'],
    [{marketHomeSpread:Infinity},'no-ats-pick'],
    [{side:null},'no-ats-pick'],
    [{side:'unsupported'},'no-ats-pick'],
    [{paperWager:{kind:'synthetic-winner-even',side:'home',homeSpread:0,odds:100}},'no-ats-pick'],
  ];
  for(const [row,reason] of cases) {
    const result = status(row);
    assert.equal(result.state,'unavailable');
    assert.equal(result.reason,reason);
    assert.equal(result.isWinning,false);
    assert.equal(result.tone,'neutral');
    assert.equal(result.provisional,false);
    assert.equal(result.coverMargin,null);
  }
});

test('stale, offline, failed, missing and future score observations stay neutral', () => {
  const cases = [
    [{retrievedAt:'2026-10-17T18:56:59Z'},{}],
    [{retrievedAt:null},{}],
    [{retrievedAt:'invalid'},{}],
    [{retrievedAt:'2026-10-17T19:00:01Z'},{}],
    [{},{offline:true}],
    [{},{refreshFailed:true}],
    [{},{now:'invalid'}],
    [{stale:true},{}],
  ];
  for(const [row,options] of cases) {
    const result = status(row,options);
    assert.equal(result.state,'unavailable');
    assert.equal(result.isWinning,false);
    assert.equal(result.tone,'neutral');
    assert.equal(result.provisional,false);
    assert.equal(result.coverMargin,null);
  }
  assert.equal(status({retrievedAt:'2026-10-17T18:57:00Z'}).state,'covering');
});

test('finals, API result finals and voids stay separate from provisional status', () => {
  for(const row of [
    {status:'completed',completed:true,homeScore:24,awayScore:20},
    {completed:true},
    {result:{status:'completed',homeScore:24,awayScore:20,outcome:'win'}},
    {result:{status:'completed',actualMargin:4}},
    {result:{status:'void'}},
  ]) {
    const result = status(row);
    assert.equal(result.state,'settled');
    assert.equal(result.label,'Final result');
    assert.equal(result.isWinning,false);
    assert.equal(result.tone,'neutral');
    assert.equal(result.provisional,false);
    assert.equal(result.coverMargin,null);
  }
});

test('pre-game, postponed and interrupted games never use placeholder scores as live status', () => {
  for(const gameStatus of ['scheduled','postponed','suspended','cancelled','awaiting-update']) {
    const result = status({status:gameStatus});
    assert.equal(result.state,'unavailable');
    assert.equal(result.reason,'not-live');
    assert.equal(result.isWinning,false);
    assert.equal(result.tone,'neutral');
  }
  assert.equal(livePickStatus(null,{now}).state,'unavailable');
});

test('the displayed ATS recommendation wins over model projected outright winner and illustrative moneyline', () => {
  // Model projects home by two, but away +4 is the displayed recommendation.
  const row = game({side:'away',predictedMargin:2,marketHomeSpread:-4,
    liveHomeScore:20,liveAwayScore:17,moneylinePair:{home:-120,away:110}});
  const before = structuredClone(row);
  const result = livePickStatus(row,{now});
  assert.equal(result.side,'away');
  assert.equal(result.pick,'A +4.0');
  assert.equal(result.line,4);
  assert.equal(result.state,'covering');
  assert.equal(result.isWinning,true);
  assert.deepEqual(row,before);
  // Undefined side may use the same recommendation that displayLines renders.
  assert.equal(status({side:undefined,predictedMargin:2,marketHomeSpread:-4,liveHomeScore:20,liveAwayScore:17}).side,'away');
});
