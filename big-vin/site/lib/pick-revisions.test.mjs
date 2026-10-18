import test from 'node:test';
import assert from 'node:assert/strict';
import {advancePickState,withPickState,actionablePick,spreadSelection,currentBoardPick,expireBoardPick} from './pick-revisions.mjs';
import {displayLines} from './board-presentation.mjs';
import {gradeForecast,summarizeForecasts} from './results.mjs';
import {summarizeSpreadPicks} from './spread-record.mjs';
import {rankCardHistory} from './ranked-card-summary.mjs';
import {featuredGame} from './presentation.mjs';
const t='2026-10-23T16:00:00.000Z',start='2026-10-23T17:00:00.000Z';
const f=(sport='cfb',more={})=>({id:'ridge-v1:'+sport+':123',gameId:'123',sport,season:2026,weekKey:'2026-10-19',cohort:'live',origin:'collector',modelVersion:'ridge-v1',
 homeId:'H',awayId:'A',home:'Baylor',away:'TCU',predictedMargin:5.4,marketHomeSpread:-5.5,side:'away',odds:-110,marketObservedAt:'2026-10-22T15:00:00.000Z',capturedAt:'2026-10-22T15:01:00.000Z',startTime:start,...more});
const g=(sport='cfb',spread=-4.5,more={})=>({id:'123',sport,homeId:'H',awayId:'A',home:{id:'H',abbreviation:'BAY'},away:{id:'A',abbreviation:'TCU'},startTime:start,status:'scheduled',completed:false,
 sourceUrl:'https://example.test/scoreboard',market:{homeSpread:spread,awaySpread:-spread,homeSpreadPrice:-105,awaySpreadPrice:-115,observedAt:t,timing:'current-displayed-snapshot',provider:'Book'},...more});
const row=(f,g)=>({...g,...f,id:g.id,market:{...g.market,homeSpread:f.marketHomeSpread},home:g.home,away:g.away,projection:{predictedHomeMargin:f.predictedMargin,fairHomeSpread:-f.predictedMargin},edge:spreadSelection(f.predictedMargin,f.marketHomeSpread).edge});

test('all seven sports flip the actionable team and keep market/fair signs consistent',()=>{
 for(const sport of ['nfl','cfb','nba','wnba','cbb','nhl','mlb'])for(const margin of [5.4,-5.4,0])for(const spread of [-5.5,-4.5,0,4.5,5.5]){
  const original=f(sport,{predictedMargin:margin}),game=g(sport,spread),before=structuredClone(original);
  const state=advancePickState(original,null,game,t),current=withPickState(original,state);
  assert.ok(actionablePick(current,game,Date.parse(t)));
  const lines=displayLines(row(current,game)),selected=spreadSelection(margin,spread);
  assert.equal(lines.side,selected.side);
  if(selected.side){assert.ok(Math.abs(lines.marketLine-lines.fairLine-selected.edge)<1e-9);assert.ok(selected.edge>0);}
  else assert.equal(lines.pick,null);
  assert.deepEqual(original,before);
 }
 const original=f(),game=g(),current=withPickState(original,advancePickState(original,null,game,t));
 assert.equal(current.side,'home');assert.ok(Math.abs(displayLines(row(current,game)).edge-0.9)<1e-9);
 assert.equal(displayLines(row(current,game)).pick,'BAY −4.5');
 assert.equal(current.originalPick.side,'away');assert.equal(current.originalPick.marketHomeSpread,-5.5);
});

test('zero edge is a saved pass, never falls back to an earlier profitable side',()=>{
 const original=f(),first=advancePickState(original,null,g(),t);
 const game=g('cfb',-5.4,{market:{...g().market,homeSpread:-5.4,awaySpread:5.4,observedAt:'2026-10-23T16:10:00.000Z'}});
 const next=advancePickState(original,first,game,'2026-10-23T16:10:00.000Z'),current=withPickState(original,next);
 assert.equal(next.revisions.length,2);assert.equal(current.side,null);assert.equal(displayLines(row(current,game)).pick,null);
 const result=gradeForecast(current,{status:'completed',completed:true,homeScore:24,awayScore:10,startTime:start},'2026-10-23T20:00:00.000Z');
 assert.equal(result.outcome,'no-line');assert.equal(result.pnl,null);
});

test('fresh unchanged quotes advance verification, old or contradictory quotes cannot regress a revision',()=>{
 const original=f(),state=advancePickState(original,null,g(),t);
 const next=advancePickState(original,state,g('cfb',-4.5,{market:{...g().market,observedAt:'2026-10-23T16:10:00.000Z'}}),'2026-10-23T16:10:00.000Z');
 assert.equal(next.revisions.length,1);assert.equal(next.verifiedAt,'2026-10-23T16:10:00.000Z');
 assert.deepEqual(advancePickState(original,next,g('cfb',-8),'2026-10-23T16:11:00.000Z'),next);
 assert.deepEqual(advancePickState(original,state,g('cfb',-8),t),state);
});

test('exact kickoff boundary and started sentinel never reopen with a delayed schedule',()=>{
 const original=f(),state=advancePickState(original,null,g(),t);
 for(const when of [start,'2026-10-23T17:00:00.001Z']){
  const locked=advancePickState(original,state,g('cfb',-8),when);
  assert.equal(locked.revisions.length,1);assert.ok(locked.closedAt);
  const later=advancePickState(original,locked,g('cfb',-8,{startTime:'2026-10-23T19:00:00.000Z'}),'2026-10-23T17:05:00.000Z');
  assert.equal(later.lockAt,start);assert.equal(later.revisions.length,1);assert.equal(withPickState(original,later).side,'home');
 }
 const early=advancePickState(original,state,g('cfb',-8,{status:'in-progress'}),'2026-10-23T16:30:00.000Z');
 assert.ok(early.closedAt);assert.equal(advancePickState(original,early,g('cfb',-8),'2026-10-23T16:40:00.000Z').revisions.length,1);
 assert.equal(advancePickState(original,null,g(),start),null);
 const corrected=advancePickState(original,state,g('cfb',-8,{status:'completed',startTime:'2026-10-23T15:59:00.000Z'}),'2026-10-23T20:00:00.000Z');
 assert.equal(corrected.lockAt,start);assert.equal(withPickState(original,corrected).side,'home');
});

test('earlier kickoff invalidates late revisions but retains their audit versions',()=>{
 const original=f(),state=advancePickState(original,null,g(),t);
 const next=advancePickState(original,state,g('cfb',-8,{startTime:'2026-10-23T15:59:00.000Z'}),'2026-10-23T16:01:00.000Z');
 assert.equal(next.revisions.length,1);assert.equal(next.lockAt,'2026-10-23T15:59:00.000Z');
 assert.equal(withPickState(original,next).side,'away');assert.equal(withPickState(original,next).pickRevision,null);
});

test('missing, stale, future, mismatched, historical and conflicting quotes are never actionable',()=>{
 const original=f(),state=advancePickState(original,null,g(),t);
 const bad=[{market:null},{homeId:'wrong'},{awayId:'wrong'},{sport:'nfl'},{id:'wrong'},
  {market:{...g().market,observedAt:'2026-10-23T15:29:59.000Z'}},{market:{...g().market,observedAt:'2026-10-23T16:00:00.001Z'}},
  {market:{...g().market,timing:'historical-display-time-unverified'}},{market:{...g().market,awaySpread:8}},
  {market:{...g().market,homeSpread:null}},{status:'postponed'}];
 for(const extra of bad){const game=g('cfb',-4.5,extra),next=advancePickState(original,state,game,t);assert.equal(next.revisions.length,1);assert.equal(actionablePick(withPickState(original,next),game,Date.parse(t)),false);}
 assert.equal(advancePickState({...original,origin:'reconstructed'},null,g(),t),null);
 assert.equal(advancePickState({...original,result:{status:'completed'}},null,g(),t),null);
});

test('locked revision grades and totals agree; original Top-N ranks do not change',()=>{
 const original=f(),game=g(),state=advancePickState(original,null,game,t),current=withPickState(original,state);
 const final={status:'completed',completed:true,homeScore:26,awayScore:20,startTime:start};
 const graded={...current,result:gradeForecast(current,final,'2026-10-23T20:00:00.000Z')};
 assert.equal(gradeForecast(original,final,'2026-10-23T20:00:00.000Z').outcome,'loss');
 assert.equal(graded.result.outcome,'win');assert.equal(graded.result.pickRevisionId,state.revisions[0].id);
 assert.equal(summarizeForecasts([graded]).wins,summarizeSpreadPicks([graded]).wins);
 const peer=f('cfb',{id:'peer',gameId:'peer',predictedMargin:5,marketHomeSpread:-4.5});
 assert.deepEqual(rankCardHistory([current,peer]).map(r=>[r.id,r.cardRank]),rankCardHistory([original,peer]).map(r=>[r.id,r.cardRank]));
 const board=row(current,game);board.rank=1;board.actionable=true;
 assert.equal(featuredGame([{sport:'cfb',games:[board]}],Date.parse(t))?.side,current.side);
 assert.equal(currentBoardPick(board,Date.parse(t)+1800001),false);
 assert.equal(expireBoardPick(board,Date.parse(t)+1800001).rank,null);
 assert.equal(featuredGame([{sport:'cfb',games:[board]}],Date.parse(t)+1800001),null);
});
