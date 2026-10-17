import test from 'node:test';
import assert from 'node:assert/strict';
import {fitRatings,projectCollegeGame,projectGame} from './ratings.mjs';

const completed=[
 {homeId:'rated-home',awayId:'rated-away',date:'2026-09-25',homeScore:24,awayScore:17,neutral:false},
 // A game on the projection date is excluded, regardless of whether its
 // result later becomes available in the history store.
 {homeId:'unseen',awayId:'rated-home',date:'2026-10-03',homeScore:80,awayScore:0,neutral:false},
];
const model=fitRatings(completed,{sport:'cfb',asOf:'2026-10-03',parameters:{fixedHomeAdvantage:4}});

test('a college prior uses only pre-cutoff fitted ratings and flags one or two unseen teams',()=>{
 assert.equal(model.trainingGames,1);
 assert.equal(projectGame({homeId:'unseen',awayId:'rated-home'},model).predictedHomeMargin,null);
 const one=projectCollegeGame({homeId:'unseen',awayId:'rated-home',marketHomeSpread:-3},model);
 assert.equal(one.ratingCoverage,'one-prior');
 assert.deepEqual(one.missingTeams,['unseen']);
 assert.equal(one.homeRating,0);
 assert.equal(one.awayRating,model.ratings['rated-home']);
 assert.equal(one.predictedHomeMargin,-model.ratings['rated-home']+4);
 assert.equal(one.homeEdgePoints,one.predictedHomeMargin-3);
 assert.match(one.coverageNote,/no completed pre-cutoff result/);
 const both=projectCollegeGame({homeId:'unseen',awayId:'other-unseen',marketHomeSpread:null},model);
 assert.equal(both.ratingCoverage,'both-prior');
 assert.equal(both.predictedHomeMargin,4);
 assert.equal(both.homeEdgePoints,null);
 assert.equal(projectCollegeGame({homeId:'unseen',awayId:'other-unseen',neutral:true},model).predictedHomeMargin,0);
});

test('market quote cannot change the projected margin and rated games retain incumbent projections',()=>{
 const input={homeId:'rated-home',awayId:'rated-away',marketHomeSpread:-7};
 const rated=projectCollegeGame(input,model);
 const incumbent=projectGame(input,model);
 assert.equal(rated.ratingCoverage,'both-rated');
 assert.equal(rated.predictedHomeMargin,incumbent.predictedHomeMargin);
 assert.equal(rated.homeEdgePoints,incumbent.homeEdgePoints);
 const first=projectCollegeGame({homeId:'unseen',awayId:'rated-home',marketHomeSpread:-7},model);
 const second=projectCollegeGame({homeId:'unseen',awayId:'rated-home',marketHomeSpread:20},model);
 assert.equal(first.predictedHomeMargin,second.predictedHomeMargin);
 assert.notEqual(first.homeEdgePoints,second.homeEdgePoints);
});
