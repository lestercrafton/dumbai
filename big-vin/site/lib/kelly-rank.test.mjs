import test from 'node:test';import assert from 'node:assert/strict';
import {compareKelly,kellyConfidence} from './kelly-rank.mjs';
import {todayPlays} from './today-plays.mjs';
const g=(id,p,odds,extra={})=>({id,sport:'cfb',status:'scheduled',startTime:'2026-10-24T21:00:00Z',side:'away',home:{name:'H'+id},away:{name:'A'+id},
 market:{homeSpread:-3,homeSpreadPrice:-110,awaySpreadPrice:odds},rankSignal:{basis:'win',value:p,winChance:p,breakEven:0.52},...extra});
test('board rank order equals Today\'s plays order',()=>{
 const games=[g('a',0.55,-110),g('b',0.59,-102),g('c',0.577,-115),g('d',0.5,-110),g('e',0.52,+105),g('f',0.51,-110),g('limited',0.6,-108,{lowEvidence:true})];
 const board=[...games].sort(compareKelly).map(x=>x.id);
 const plays=todayPlays(games,{cfb:4_670_403},'2026-10-24').rows.map(r=>r.id.split(':')[1]);
 assert.deepEqual(plays,board);
 assert.deepEqual(board.slice(0,2),['b','limited']);
 // Kelly-zero games sit after every bet, in win-chance order.
 const zero=board.filter(id=>kellyConfidence(games.find(x=>x.id===id))===0);
 assert.deepEqual(board.slice(-zero.length),zero);
 assert.deepEqual(zero,['f','d']);
});
test('a higher win chance at a worse price can rank lower',()=>{
 assert.ok(compareKelly(g('x',0.56,-102),g('y',0.57,-150))<0);
});

test('Kelly ties go to the bigger points edge',()=>{
 const t=(id,edge)=>({id,edge,startTime:'2026-11-01T00:00:00Z',side:'home',market:{homeSpreadPrice:-110},rankSignal:{winChance:0.58,value:0.58,breakEven:0.52}});
 assert.deepEqual([t('a',3),t('b',9),t('c',6)].sort(compareKelly).map(x=>x.id),['b','c','a']);
});
test('raw edge sort: biggest edge first, ties to Kelly then kickoff',async()=>{
 const {compareEdge,rankByEdge}=await import('./kelly-rank.mjs');
 const t=(id,edge,p,st='2026-11-01T00:00:00Z')=>({id,edge,rank:1,startTime:st,side:'home',market:{homeSpreadPrice:-110},rankSignal:{winChance:p,value:p,breakEven:0.52}});
 const rows=[t('a',3,0.6),t('b',9,0.55),t('c',3,0.58),t('d',3,0.58,'2026-10-31T00:00:00Z'),t('e',-12,0.5)];
 assert.deepEqual([...rows].sort(compareEdge).map(x=>x.id),['e','b','a','d','c']);
 assert.deepEqual(rankByEdge(rows).map(x=>[x.id,x.rank]),[['a',3],['b',2],['c',5],['d',4],['e',1]]);
});
test('raw edge ranks restart per sport and scale to a full board',async()=>{
 const {rankByEdge}=await import('./kelly-rank.mjs');
 const rows=[{id:'n1',sport:'nhl',rank:1,edge:0.4},{id:'c1',sport:'cfb',rank:1,edge:3},{id:'n2',sport:'nhl',rank:2,edge:0.9},{id:'c2',sport:'cfb',rank:2,edge:12}];
 assert.deepEqual(rankByEdge(rows).map(x=>x.id+x.rank),['n12','c12','n21','c21']);
 const big=Array.from({length:5000},(_,i)=>({id:i,sport:'cfb',rank:i+1,edge:(i*7919)%97,startTime:'2026-11-01T00:00:00Z'}));
 const t=Date.now();rankByEdge(big);assert.ok(Date.now()-t<500);
});
test('record summary readers are stable (no refetch loop for sports without totals)',async()=>{
 const {readFileSync}=await import('node:fs');
 const src=readFileSync(new URL('../components/record-summary.tsx',import.meta.url),'utf8');
 const call=src.slice(src.indexOf('useRefreshingResource<TotalsView>('));const args=call.slice(0,call.indexOf(';'));
 assert.ok(!/async\s*\(/.test(args),'inline async reader would change every render and re-run the load effect');
});
test('board lists cards in ascending rank in both sort modes, whatever the kickoff order',async()=>{
 const {rankByEdge}=await import('./kelly-rank.mjs');const {sortBoard}=await import('./board-sort.mjs');
 const mk=(id,edge,p,st,status='scheduled')=>({id,sport:'cfb',status,edge,startTime:st,side:'home',market:{homeSpreadPrice:-110},rankSignal:{winChance:p,value:p,breakEven:0.52}});
 const games=[mk('a',0.7,0.56,'2026-10-31T19:15:00Z'),mk('b',1.7,0.56,'2026-10-31T19:30:00Z'),mk('c',0.4,0.57,'2026-10-31T19:30:00Z'),mk('d',4.1,0.5,'2026-10-31T16:00:00Z','live'),mk('e',3.5,0.5,'2026-10-31T23:00:00Z')];
 const kelly=[...games].sort(compareKelly).map((g,i)=>({...g,rank:i+1}));
 const byTime=[...kelly].sort((x,y)=>x.startTime.localeCompare(y.startTime));
 const shownK=sortBoard(byTime,'rank');assert.deepEqual(shownK.map(g=>g.rank),[1,2,3,4,5]);
 assert.deepEqual(shownK.map(g=>g.id),['c','b','a','d','e']);
 const shownE=sortBoard(rankByEdge(byTime),'rank');assert.deepEqual(shownE.map(g=>g.rank),[1,2,3,4,5]);
 assert.deepEqual(shownE.map(g=>g.id),['d','e','b','a','c']);
});
test('time presets never switch the board out of rank order',async()=>{
 const {readFileSync}=await import('node:fs');const src=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
 assert.ok(!/setSortMode\(\s*'time'\s*\)/.test(src)&&!/\?'time':'rank'/.test(src));
});
