import test from 'node:test';import assert from 'node:assert/strict';
import {publishDecision} from './rank-signal.mjs';
test('NBA and CBB publish only buckets that clear break-even on graded results',()=>{
 assert.equal(publishDecision({bucketGraded:10,winChance:0.6,breakEven:0.524},'nba').published,false);
 assert.equal(publishDecision({bucketGraded:60,winChance:0.53,breakEven:0.524},'nba').published,false);
 assert.equal(publishDecision({bucketGraded:60,winChance:0.56,breakEven:0.524},'cbb').published,true);
 assert.equal(publishDecision(null,'nba').published,false);
 assert.equal(publishDecision(null,'nfl').published,true);
});
