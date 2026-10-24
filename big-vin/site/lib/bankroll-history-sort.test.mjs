import test from 'node:test';
import assert from 'node:assert/strict';
import {compareBets,sortHistoryBets,nextHistorySort,HISTORY_SORT_COLUMNS} from './bankroll-history-sort.mjs';

const b=(t,extra={})=>({t,game:'A @ B',pick:'A +3',edge:1,winChance:0.5,stake:0.01,amount:1000,outcome:'win',pl:100,after:1e6,...extra});

test('default time order is ascending by t',()=>{
  const rows=sortHistoryBets([b('2026-09-18T00:00:00Z'),b('2026-09-17T00:00:00Z'),b('2026-09-19T00:00:00Z')],'t','asc');
  assert.deepEqual(rows.map(r=>r.t.slice(0,10)),['2026-09-17','2026-09-18','2026-09-19']);
});

test('sort by P/L desc puts wins first',()=>{
  const rows=sortHistoryBets([
    b('2026-09-17T00:00:00Z',{pl:-100,outcome:'loss'}),
    b('2026-09-18T00:00:00Z',{pl:500,outcome:'win'}),
    b('2026-09-19T00:00:00Z',{pl:0,outcome:'push'}),
  ],'pl','desc');
  assert.deepEqual(rows.map(r=>r.pl),[500,0,-100]);
});

test('null edge sorts last in both directions',()=>{
  const rows=sortHistoryBets([
    b('2026-09-17T00:00:00Z',{edge:null}),
    b('2026-09-18T00:00:00Z',{edge:2}),
    b('2026-09-19T00:00:00Z',{edge:5}),
  ],'edge','desc');
  assert.deepEqual(rows.map(r=>r.edge),[5,2,null]);
  const asc=sortHistoryBets(rows,'edge','asc');
  assert.deepEqual(asc.map(r=>r.edge),[2,5,null]);
});

test('result column ranks loss < push < win',()=>{
  const rows=sortHistoryBets([
    b('2026-09-17T00:00:00Z',{outcome:'win'}),
    b('2026-09-18T00:00:00Z',{outcome:'loss'}),
    b('2026-09-19T00:00:00Z',{outcome:'push'}),
  ],'outcome','asc');
  assert.deepEqual(rows.map(r=>r.outcome),['loss','push','win']);
});

test('nextHistorySort toggles same column and picks initial dir',()=>{
  assert.deepEqual(nextHistorySort({key:'t',dir:'asc'},'t'),{key:'t',dir:'desc'});
  assert.deepEqual(nextHistorySort({key:'t',dir:'asc'},'pl'),{key:'pl',dir:'desc'});
  assert.deepEqual(nextHistorySort({key:'pl',dir:'desc'},'game'),{key:'game',dir:'asc'});
});

test('all History columns are declared',()=>{
  assert.deepEqual(HISTORY_SORT_COLUMNS.map(c=>c.label),
    ['Date','Game','Pick','Edge','Win chance','Kelly','Bet','Result','P/L','Bankroll']);
});

test('compareBets is antisymmetric on time',()=>{
  const a=b('2026-09-17T00:00:00Z'), c=b('2026-09-18T00:00:00Z');
  assert.equal(Math.sign(compareBets(a,c,'t','asc')),-Math.sign(compareBets(c,a,'t','asc')));
});
