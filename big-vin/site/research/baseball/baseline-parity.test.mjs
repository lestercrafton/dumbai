import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fitRatings,projectGame} from './ratings-runtime-at-study.mjs';
const read=n=>JSON.parse(fs.readFileSync(process.env.BIG_VIN_RESEARCH_DIR?path.join(process.env.BIG_VIN_RESEARCH_DIR,n):new URL(n,import.meta.url),'utf8'));
const input=read('./canonical-inputs.json');
const fixtureName=process.argv[2]||'baseline-parity-fixtures.json';
const fixtures=read('./'+fixtureName),results=[];
for(const f of fixtures){
 const day=Date.parse(f.date),training=input.games.filter(g=>!g.excludeReason&&Date.parse(g.date)<day-86400000);
 let coefficientDifference=0,predictionDifference=0;
 for(const key of ['active','ridgeV1']){
  const wanted=f[key],actual=fitRatings(training,{sport:'mlb',asOf:f.date,parameters:wanted.parameters});
  assert.equal(actual.trainingGames,wanted.trainingGames);assert.equal(actual.lastTrainingDate,wanted.lastTrainingDate);
  coefficientDifference=Math.max(coefficientDifference,Math.abs(actual.homeAdvantage-wanted.homeAdvantage));
  for(const [id,v] of Object.entries(wanted.ratings))coefficientDifference=Math.max(coefficientDifference,Math.abs(v-actual.ratings[id]));
  for(const g of input.games.filter(g=>g.date===f.date&&!g.excludeReason)){
   const expected=wanted.ratings[g.homeId]-wanted.ratings[g.awayId]+(g.neutral?0:wanted.homeAdvantage);
   predictionDifference=Math.max(predictionDifference,Math.abs(expected-projectGame(g,actual).predictedHomeMargin));
  }
 }
 assert.ok(coefficientDifference<1e-11);assert.ok(predictionDifference<1e-11);
 results.push({date:f.date,coefficientDifference,predictionDifference,activeTrainingGames:f.active.trainingGames,ridgeV1TrainingGames:f.ridgeV1.trainingGames,lastTrainingDate:f.active.lastTrainingDate});
}
const result={checkedAt:new Date().toISOString(),fixtureFile:fixtureName,sourceModuleSha256:createHash('sha256').update(fs.readFileSync(new URL('./ratings-runtime-at-study.mjs',import.meta.url))).digest('hex'),cutoffs:results,maxCoefficientDifference:Math.max(...results.map(r=>r.coefficientDifference)),maxPredictionDifference:Math.max(...results.map(r=>r.predictionDifference)),bothActiveAndRidgeV1Verified:true};
fs.writeFileSync(new URL('./baseline-parity-results.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
