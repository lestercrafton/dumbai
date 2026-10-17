import test from 'node:test';
import assert from 'node:assert/strict';
import {pregameComparison} from './pregame-comparison.mjs';
import {displayLines} from './board-presentation.mjs';
import {spreadDecision} from './spread-display.mjs';
const now=Date.parse('2026-10-17T18:00:00Z');
const game=(extra={})=>({id:'123',status:'scheduled',startTime:'2026-10-17T19:30:00Z',archived:true,rank:7,
  home:{abbreviation:'H'},away:{abbreviation:'A'},side:'home',predictedMargin:7,edge:3.5,
  market:{homeSpread:-3.5},projection:{predictedHomeMargin:7,fairHomeSpread:-7},
  moneylineMarket:{homeSpread:-4.5,provider:'DraftKings',observedAt:'2026-10-17T17:59:00Z',timing:'current-displayed-snapshot'},...extra});

test('fresh upcoming quotes update comparison with correct same-team signs, without changing saved inputs',()=>{
  for(const side of ['home','away']){
    const row=game({side}),before=structuredClone(row),saved=spreadDecision(row),lines=displayLines(row);
    const current=pregameComparison(row,{now});
    assert.equal(current.marketLine,side==='home'?-4.5:4.5);
    assert.equal(current.edge,side==='home'?2.5:-2.5);
    assert.equal(current.savedLine,lines.marketLine);
    assert.equal(row.rank,7);assert.deepEqual(row,before);assert.deepEqual(spreadDecision(row),saved);
  }
});

test('pick-em, erased edge, and missing model values are not invented or made positive',()=>{
  assert.equal(pregameComparison(game({moneylineMarket:{...game().moneylineMarket,homeSpread:0}}),{now}).marketLine,0);
  assert.equal(pregameComparison(game({moneylineMarket:{...game().moneylineMarket,homeSpread:-8}}),{now}).edge,-1);
  assert.equal(pregameComparison(game({side:null}),{now}).edge,null);
});

test('started, live, settled, stale, unavailable and historical quotes keep the original comparison',()=>{
  for(const extra of [{status:'live'},{status:'awaiting-update'},{status:'completed'},{startTime:'2026-10-17T18:00:00Z'},
    {completed:true},{result:{status:'completed'}},{result:{status:'void'}},{paperWager:{kind:'synthetic-winner-even'}},
    {moneylineMarket:null},...['2026-10-17T17:29:59Z','2026-10-17T18:00:01Z','invalid'].map(observedAt=>({moneylineMarket:{...game().moneylineMarket,observedAt}})),
    {moneylineMarket:{...game().moneylineMarket,homeSpread:null}},{moneylineMarket:{...game().moneylineMarket,timing:'historical'}}]){
    assert.equal(pregameComparison(game(extra),{now}),null,JSON.stringify(extra));
  }
});
