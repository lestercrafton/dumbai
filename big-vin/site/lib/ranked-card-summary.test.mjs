import test from 'node:test';
import assert from 'node:assert/strict';
import {rankCardHistory,summarizeRankedCards} from './ranked-card-summary.mjs';
const game=(id,weekKey,date,edge,actualMargin=7,extra={})=>({id,sport:'cfb',weekKey,startTime:date+'T18:00:00Z',predictedMargin:edge+3,marketHomeSpread:-3,side:'home',result:{status:'completed',actualMargin,outcome:actualMargin>3?'win':actualMargin<3?'loss':'push',pnl:actualMargin>3?100/110:actualMargin<3?-1:0},...extra});
const week=(key,date)=>Array.from({length:12},(_,index)=>game(key+':'+index,key,date,12-index,index<2?7:0));

test('Top 3, Easy 8 and Top 10 aggregate each week and match its ranked table',()=>{
 const records=[...week('2026-09-28','2026-10-03'),...week('2026-10-05','2026-10-10')];
 const cards=summarizeRankedCards(records,'2026-10-05');
 for(const [card,count,wins,losses] of [['3',3,2,1],['8',8,2,6],['10',10,2,8]]){
  const result=cards[card];assert.equal(result.summary.recorded,count);
  assert.equal(result.spreadRecord.wins,wins);assert.equal(result.spreadRecord.losses,losses);
  assert.equal(result.spreadOverall.recorded,count*2);assert.equal(result.spreadOverall.winRate,wins/count);
  assert.equal(result.spreadDays.find(day=>day.date==='2026-10-10').recorded,count);
  assert.equal(result.spreadWeeks.find(week=>week.key==='2026-10-05').recorded,count);
 }
 assert.equal(records[0].cardRank,undefined);
});

test('daily records are the selected weekly picks on that day, not a new daily Top N',()=>{
 const records=[game('a','2026-10-05','2026-10-08',10),game('b','2026-10-05','2026-10-10',9),game('c','2026-10-05','2026-10-10',8,0),game('d','2026-10-05','2026-10-10',7)];
 const card=summarizeRankedCards(records,'2026-10-05')['3'];
 assert.equal(card.spreadDays.find(day=>day.date==='2026-10-08').recorded,1);
 assert.equal(card.spreadDays.find(day=>day.date==='2026-10-10').recorded,2);
 assert.equal(card.spreadRecord.winRate,2/3);
 const daily=summarizeRankedCards(records,'2026-10-05',null,{rankPeriod:'day'})['3'];
 assert.equal(daily.spreadOverall.recorded,4);
});

test('limited data and missing spreads stay outside ranked cards; pending, void and push do not count in the percentage',()=>{
 const records=[game('limited','week','2026-10-10',100,7,{projection:{sparseSample:true}}),game('no-line','week','2026-10-10',90,7,{marketHomeSpread:null}),
  game('win','week','2026-10-10',8),game('push','week','2026-10-10',7,3),game('pending','week','2026-10-10',6,7,{result:null}),game('void','week','2026-10-10',5,7,{result:{status:'void'}}),game('loss','week','2026-10-10',4,0)];
 const card=summarizeRankedCards(records,'week')['8'].spreadOverall;
 assert.equal(card.recorded,5);assert.equal(card.wins,1);assert.equal(card.losses,1);assert.equal(card.pushes,1);assert.equal(card.pending,1);assert.equal(card.voids,1);assert.equal(card.winRate,0.5);
});

test('a corrected final changes the grade without changing which weekly picks qualify',()=>{
 const records=week('week','2026-10-10');const before=summarizeRankedCards(records,'week')['3'];
 records[0]={...records[0],result:{status:'completed',actualMargin:0,outcome:'loss',pnl:-1}};
 records[11]={...records[11],result:{status:'completed',actualMargin:100,outcome:'win',pnl:100/110}};
 const after=summarizeRankedCards(records,'week')['3'];
 assert.equal(after.spreadOverall.recorded,before.spreadOverall.recorded);assert.equal(after.spreadOverall.wins,1);assert.equal(after.spreadOverall.losses,2);
});

test('a moved game settles on played day while retaining original daily-card membership and actual sheet stakes',()=>{
 const records=[game('moved','week','2026-10-08',10,7,{result:{status:'completed',actualMargin:7,outcome:'win',pnl:100/110,playedAt:'2026-10-10T18:00:00Z'}}),...Array.from({length:4},(_,i)=>game('new'+i,'week','2026-10-10',20-i))];
 const bankroll={plays:{moved:{profit:20,profitUnits:2},new0:{profit:0,profitUnits:0},new1:{profit:-10,profitUnits:-1}}};
 const before=JSON.stringify(bankroll);
 const card=summarizeRankedCards(records,'week',bankroll,{rankPeriod:'day'})['3'];
 assert.equal(card.spreadDays[0].recorded,4);assert.equal(card.overall.profit,10);assert.equal(card.overall.profitUnits,1);
 assert.equal(JSON.stringify(bankroll),before);
 assert.equal(summarizeRankedCards([],'week')['3'].spreadOverall.winRate,null);
});

test('rolling seven-day cards retain weekday boundaries across calendar weeks and match result-table IDs',()=>{
 const records=[game('a','2026-09-28','2026-10-04',10),game('b','2026-09-28','2026-10-04',9),game('c','2026-10-05','2026-10-05',8),game('d','2026-10-05','2026-10-05',7),game('prior','2026-09-21','2026-09-27',6)];
 const options={rankPeriod:'week',rankAnchor:'2026-10-03'};
 const ranked=rankCardHistory(records,options);
 assert.deepEqual(ranked.filter(row=>row.cardRank<=3).map(row=>row.id),['a','b','c','prior']);
 const cards=summarizeRankedCards(records,'2026-10-05',null,options)['3'];
 assert.equal(cards.spreadOverall.recorded,4);assert.equal(cards.spreadRecord.recorded,1);
 assert.equal(cards.spreadDays.find(day=>day.date==='2026-10-05').recorded,1);
});
