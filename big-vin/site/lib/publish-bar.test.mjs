import test from 'node:test';import assert from 'node:assert/strict';
import {publishDecision} from './rank-signal.mjs';
test('NBA and CBB issue every pick and star only documented edges',()=>{
 assert.equal(publishDecision({bucketGraded:10,winChance:0.5,breakEven:0.524},'nba').published,true);
 assert.equal(publishDecision(null,'cbb').published,true);
 assert.equal(publishDecision(null,'cbb',null,{neutralSite:true,edge:3.2}).advantage,true);
 assert.equal(publishDecision(null,'cbb',null,{neutralSite:false,edge:9}).advantage,false);
 assert.equal(publishDecision(null,'nba',null,{overUnder:{edge:-8.4}}).advantage,true);
 assert.equal(publishDecision(null,'nba',null,{edge:12,overUnder:{edge:2}}).advantage,false);
 assert.equal(publishDecision(null,'nfl').published,true);
});
