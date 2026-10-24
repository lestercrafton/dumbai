import test from 'node:test';
import assert from 'node:assert/strict';
import {slimTrackedHistoryForClient,slimHistoryRecord} from './results-client-payload.mjs';

test('summary mode drops records entirely',()=>{
 const fat={view:'tracked-history',sport:'cfb',spreadDays:[{date:'2026-10-24',wins:1}],records:[{id:'1',pickRevisions:[{id:'a'}]}]};
 const slim=slimTrackedHistoryForClient(fat,{summary:true});
 assert.equal('records' in slim,false);
 assert.equal(slim.spreadDays[0].wins,1);
 assert.equal(JSON.stringify(slim).includes('pickRevisions'),false);
});

test('full history keeps rows but strips revision lists and internals',()=>{
 const row={id:'1',home:'A',away:'B',pickRevision:{side:'home'},pickRevisions:[{id:'a'},{id:'b'}],parameters:{halfLife:10},recovery:{note:'x'},spreadGrade:{outcome:'win'}};
 const slim=slimHistoryRecord(row);
 assert.equal(slim.pickRevisions.length,0);
 assert.equal(slim.pickRevisionCount,2);
 assert.deepEqual(slim.pickRevision,{side:'home'});
 assert.equal(slim.parameters,undefined);
 assert.equal(slim.recovery,undefined);
 assert.equal(slim.spreadGrade.outcome,'win');
 const hist=slimTrackedHistoryForClient({view:'tracked-history',records:[row]});
 assert.equal(hist.records.length,1);
 assert.equal(hist.records[0].pickRevisions.length,0);
});
