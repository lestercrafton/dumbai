import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseRecordVersion,matchesRecordResponse,recordVersionCounts} from './record-version.mjs';

test('a just-activated version with no graded games does not blank the season record', () => {
  const candidates = [
    {version: 'cfb-season-tuned-2026-10-16', graded: 0, recorded: 118},
    {version: 'cfb-weekly-tuned-2026-09-14', graded: 451, recorded: 570},
    {version: 'ridge-v1', graded: 380, recorded: 499},
  ];
  assert.equal(chooseRecordVersion(candidates).version, 'cfb-weekly-tuned-2026-09-14');
});

test('once the new version has graded games, the header follows it', () => {
  const candidates = [
    {version: 'new', graded: 12, recorded: 40},
    {version: 'old', graded: 451, recorded: 570},
  ];
  assert.equal(chooseRecordVersion(candidates).version, 'new');
});

test('with no graded games anywhere, the newest recorded version shows', () => {
  assert.equal(chooseRecordVersion([{version: 'a', graded: 0, recorded: 3}, {version: 'b', graded: 0, recorded: 9}]).version, 'a');
  assert.equal(chooseRecordVersion([]), null);
});

test('a retired-version baseline response is skipped without blanking valid records', () => {
  const latest={sport:'cfb',cohort:'live',version:'current',days:[],graded:0,recorded:4};
  const fallback={sport:'cfb',cohort:'live',version:'ridge-v1',days:[],graded:9,recorded:9};
  assert.equal(matchesRecordResponse(fallback,'cfb','retired'),false);
  const accepted=[[latest,'current'],[fallback,'retired'],[fallback,'ridge-v1']]
    .filter(([result,requested])=>matchesRecordResponse(result,'cfb',requested))
    .map(([result])=>result);
  assert.equal(chooseRecordVersion(accepted).version,'ridge-v1');
  assert.equal(matchesRecordResponse({...latest,sport:'nfl'},'cfb','current'),false);
  assert.equal(matchesRecordResponse({...latest,cohort:'research'},'cfb','current'),false);
  assert.equal(matchesRecordResponse({...latest,days:null},'cfb','current'),false);
});

test('seasonal formula fallback ignores prior-season wins and missing seasonal metadata',()=>{
 const current={version:'current',overall:{graded:0,recorded:4},seasonRecord:{season:2027,overall:{graded:0,recorded:4}}};
 const older={version:'older',overall:{graded:300,recorded:300},seasonRecord:{season:2027,overall:{graded:0,recorded:0}}};
 assert.equal(chooseRecordVersion([current,older].map(r=>({version:r.version,...recordVersionCounts(r,2027)}))).version,'current');
 assert.deepEqual(recordVersionCounts({overall:{graded:300,recorded:300}},2027),{graded:0,recorded:0});
 assert.deepEqual(recordVersionCounts({...older,seasonRecord:{season:2026,overall:{graded:300,recorded:300}}},2027),{graded:0,recorded:0});
 older.seasonRecord.overall={graded:12,recorded:20};
 assert.equal(chooseRecordVersion([current,older].map(r=>({version:r.version,...recordVersionCounts(r,2027)}))).version,'older');
});
