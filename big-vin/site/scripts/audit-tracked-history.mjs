import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import sep14 from '../lib/tuning-2026-09-14.json' with {type:'json'};
import oct16 from '../lib/tuning-2026-10-16.json' with {type:'json'};
import {selectTrackedHistory,summarizeTrackedHistory} from '../lib/tracked-history.mjs';
import {savedBoardHistory} from '../lib/saved-board-history.mjs';
import {gradeSpreadPick} from '../lib/spread-record.mjs';

const input=process.argv[2];
if(!input)throw new Error('Usage: node scripts/audit-tracked-history.mjs path/to/production-live-all-versions.json');
const source=fs.readFileSync(input,'utf8'),records=JSON.parse(source);
assert.ok(Array.isArray(records),'Expected an all-version saved-forecast array');
const membership=rows=>rows.map(row=>[row.id,row.cardRank]).sort(([a],[b])=>a.localeCompare(b));
const reports=[];
for(const sport of ['cfb','nfl','mlb','nba','nhl','wnba','cbb']){
 const models=[sep14[sport],oct16[sport]].filter(Boolean),rankPeriod=['cfb','nfl','cbb'].includes(sport)?'week':'day';
 const options={sport,models,rankPeriod,season:['nba','nhl','cbb'].includes(sport)?2027:2026};
 const selection=selectTrackedHistory(records,options),summary=summarizeTrackedHistory(records,options);
 assert.deepEqual(membership(selectTrackedHistory([...records].reverse(),options).records),membership(selection.records),'Input-order invariance');
 const swappedOutcomes=records.map(row=>({...row,result:row.result?{status:'completed',outcome:row.result.outcome==='win'?'loss':'win',actualMargin:1000,pnl:999}:null}));
 assert.deepEqual(membership(selectTrackedHistory(swappedOutcomes,options).records),membership(selection.records),'Outcome-blind membership and ranks');
 assert.equal(new Set(selection.records.map(row=>`${row.sport}:${row.gameId}`)).size,selection.records.length,'One pick per sport/game');
 const originals=new Map(records.map(row=>[row.id,row]));
 for(const row of selection.records){
  const original=originals.get(row.id);
  for(const field of ['capturedAt','predictedMargin','side','marketHomeSpread','odds','modelVersion','rank','result'])assert.deepEqual(row[field],original[field],'Preserved saved '+field);
 }
 assert.equal(summary.coverage.complete,false,'No full-season claim');
 for(const [card,view] of Object.entries({all:summary,...summary.rankedCards})){
  for(const field of ['recorded','wins','losses','pushes','pending','voids','unlined']){
   assert.equal(view.spreadDays.reduce((sum,row)=>sum+row[field],0),view.spreadOverall[field],card+' daily reconciliation');
   assert.equal(view.spreadWeeks.reduce((sum,row)=>sum+row[field],0),view.spreadOverall[field],card+' weekly reconciliation');
  }
 }
 const board=savedBoardHistory(records,{sport,models,date:'2026-10-17',days:rankPeriod==='day'?1:7});
 const boardHistory=selectTrackedHistory(records,{...options,rankAnchor:rankPeriod==='week'?'2026-10-17':null});
 assert.deepEqual(membership(board.records),membership(boardHistory.records),'Default board and history use identical saved picks');
 const baselineByGame=new Map(records.filter(row=>row.sport===sport&&row.modelVersion==='ridge-v1').map(row=>[row.gameId,row]));
 const changedHistoricGrades=selection.records.filter(row=>row.startTime<'2026-10-16'&&row.modelVersion!=='ridge-v1'&&baselineByGame.has(row.gameId)&&['win','loss','push'].includes(gradeSpreadPick(row).outcome)&&gradeSpreadPick(row).outcome!==gradeSpreadPick(baselineByGame.get(row.gameId)).outcome).length;
 reports.push({sport,spread:summary.spreadOverall,coverage:summary.coverage,season:summary.seasonRecord.season,seasonCoverage:summary.seasonRecord.coverage,
  cards:Object.fromEntries(Object.entries(summary.rankedCards).map(([card,view])=>[card,view.spreadOverall])),policy:selection.policy,
  historicGradesDifferentFromBaseline:changedHistoricGrades});
}
console.log(JSON.stringify({sourceSha256:crypto.createHash('sha256').update(source).digest('hex'),sourceRecords:records.length,
 checks:['outcome-blind selection','input-order invariance','unique sport/game','original pick/grade preservation','daily/weekly/card reconciliation','board/history selection agreement','incomplete coverage disclosure'],sports:reports},null,2));
