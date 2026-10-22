import test from 'node:test';
import assert from 'node:assert/strict';
import {fitTotals,projectTotal,totalPick,gradeTotal,pointsEffects} from './totals.mjs';
import {effectivePicks,replay} from '../scripts/totals-experiment.mjs';
const games=[];for(let w=0;w<40;w++){const d=new Date(Date.UTC(2025,8,1)+w*7*86400000).toISOString().slice(0,10);
 games.push({date:d,homeId:'HI',awayId:'LO',homeScore:34,awayScore:20},{date:d,homeId:'LO',awayId:'MID',homeScore:13,awayScore:17},{date:d,homeId:'MID',awayId:'HI',homeScore:24,awayScore:31});}
test('high-scoring teams project higher totals; only games before asOf are used',()=>{
 const m=fitTotals(games,{sport:'nfl',asOf:'2026-10-01'});
 const hi=projectTotal({homeId:'HI',awayId:'MID'},m).total,lo=projectTotal({homeId:'LO',awayId:'MID'},m).total;
 assert.ok(hi>lo+10,`${hi} vs ${lo}`);
 assert.equal(fitTotals(games,{sport:'nfl',asOf:'2025-09-01'}).trainingGames,0);
});
test('offensive injuries lower own points, defensive injuries raise the opponent',()=>{
 const fx=pointsEffects([{group:'qb',points:4}],[{group:'cb',points:0.5}]);
 assert.equal(fx.home,0.6*(-4+0.5));assert.equal(fx.away,0);
 const m=fitTotals(games,{sport:'nfl',asOf:'2026-10-01'});
 assert.ok(projectTotal({homeId:'HI',awayId:'MID'},m,{injuries:{home:[{group:'qb',points:4}],away:[]}}).total<projectTotal({homeId:'HI',awayId:'MID'},m).total);
});
test('gap guard and grading',()=>{
 assert.deepEqual(totalPick({sport:'nfl',total:47,marketTotal:44.5}).side,'over');
 const r=totalPick({sport:'nfl',total:52,marketTotal:44});assert.equal(r.check.review,true);assert.equal(r.total,48);
 assert.equal(totalPick({sport:'nfl',total:38,marketTotal:44,injuryEffect:-3}).check.review,false);
 assert.equal(gradeTotal('over',44.5,45),'win');assert.equal(gradeTotal('under',44.5,45),'loss');assert.equal(gradeTotal('over',44,44),'push');
});
test('last pregame pick counts; bankroll is 2% of the day opening balance',()=>{
 const s='2026-10-26T17:00:00Z';
 const picks=effectivePicks([{type:'pick',gameId:'1',startTime:s,capturedAt:'2026-10-25T10:00:00Z',side:'over',price:-110},{type:'pick',gameId:'1',startTime:s,capturedAt:'2026-10-26T16:00:00Z',side:'under',price:100},{type:'pick',gameId:'1',startTime:s,capturedAt:'2026-10-26T18:00:00Z',side:'over'}]);
 assert.equal(picks.get('1').side,'under');
 const b=replay([...picks.values()],new Map([['1',{result:'win'}]]));assert.equal(b.bankroll,510);assert.equal(b.wins,1);
});
import {parseEvents} from '../scripts/totals-history.mjs';
test('ESPN history keeps only completed games with scores',()=>{
 const ev=(id,done)=>({id,date:'2026-01-10T01:00Z',competitions:[{status:{type:{completed:done}},neutralSite:true,competitors:[{homeAway:'home',score:'80',team:{id:'1'}},{homeAway:'away',score:'71',team:{id:'2'}}]}]});
 const g=parseEvents({events:[ev('9',true),ev('8',false)]});
 assert.equal(g.length,1);assert.equal(g[0].homeScore+g[0].awayScore,151);assert.equal(g[0].neutral,true);
});
test('basketball gap guard uses its own threshold',()=>{
 assert.equal(totalPick({sport:'nba',total:228,marketTotal:221}).check,null);
 assert.equal(totalPick({sport:'nba',total:232,marketTotal:221}).check.review,true);
});
