import test from 'node:test';
import assert from 'node:assert/strict';
import {gradeSpreadPick,summarizeSpreadPicks} from './spread-record.mjs';

const final=actualMargin=>({status:'completed',actualMargin});
const saved=(side,marketHomeSpread,actualMargin)=>({side,marketHomeSpread,result:final(actualMargin)});
const archived=(side,homeSpread,actualMargin)=>({origin:'cfb-reconstructed-2026-09-26',paperWager:{kind:'archived-opening-spread',side,homeSpread,odds:-110},result:final(actualMargin)});
const synthetic=(actualMargin,result=final(actualMargin))=>({origin:'cfb-reconstructed-2026-09-26',predictedMargin:4,paperWager:{kind:'synthetic-winner-even',side:'home',homeSpread:0,odds:100},result});

test('saved and archived sportsbook spreads share the ATS denominator; pushes do not',()=>{
 const records=[saved('home',-4.5,7),saved('away',-3.5,7),archived('home',-3,3),archived('away',-7,3),synthetic(12),synthetic(-4,{status:'pending'}),{side:'home',marketHomeSpread:-2,result:null}];
 assert.deepEqual(records.map(record=>gradeSpreadPick(record).outcome),['win','loss','push','win','no-line','no-line','pending']);
 const summary=summarizeSpreadPicks(records);
 assert.equal(summary.recorded,7);
 assert.equal(summary.offered,5);
 assert.equal(summary.graded,4);
 assert.equal(summary.wins,2);
 assert.equal(summary.losses,1);
 assert.equal(summary.pushes,1);
 assert.equal(summary.winRate,2/3);
 assert.equal(summary.pending,1);
 assert.equal(summary.syntheticGames,2);
 assert.equal(summary.syntheticFinals,1);
 assert.equal(summary.unlined,2);
});

test('a synthetic winner contract is never represented as sportsbook ATS, even after a final',()=>{
 const record=synthetic(28);
 assert.deepEqual(gradeSpreadPick(record),{outcome:'no-line',basis:'synthetic-winner-even'});
 assert.equal(summarizeSpreadPicks([record]).winRate,null);
 assert.equal(summarizeSpreadPicks([record]).wins,0);
});

test('completed scores can grade a spread when a cached result lacks actualMargin',()=>{
 const record={side:'away',marketHomeSpread:-4,result:{status:'completed',homeScore:20,awayScore:17}};
 assert.equal(gradeSpreadPick(record).outcome,'win');
});
