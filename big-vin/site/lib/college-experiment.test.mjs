import test from 'node:test';
import assert from 'node:assert/strict';
import cohort from './college-experiment-cohort-2026-09-26.json' with {type:'json'};
import {projectResearchGame,summarizeResearchGames} from './college-experiment.mjs';

const model={sport:'ncaaf',ratings:{H:4,A:-2},teamGames:{H:2,A:2},effectiveTeamGames:{H:2,A:2},homeAdvantage:2.5,config:{useRest:false}};
const source=(id,extra={})=>({id,date:'2026-09-26',category:'no-market-on-board',startTime:'2026-09-26T17:00:00Z',home:{id:'H',name:'Home'},away:{id:'A',name:'Away'},neutralSite:false,capturedStatus:'scheduled',capturedHomeScore:null,capturedAwayScore:null,lateMarketHomeSpread:3.5,lateMarketProvider:'Late source',sourceUrl:'https://site.api.espn.com/summary',sourceRetrievedAt:'2026-09-27T00:00:00Z',...extra});

test('retro model grades winner, margin and late spread separately without inventing a saved bet',()=>{
 const game=projectResearchGame(source('1'),model,{home:{id:'H'},away:{id:'A'},completed:true,homeScore:21,awayScore:14},'2026-09-27T00:00:00Z');
 assert.equal(game.modelHomeMargin,8.5);assert.equal(game.predictedWinner,'Home');assert.equal(game.outcome,'correct');assert.equal(game.absoluteError,1.5);
 assert.equal(game.researchSide,'home');assert.equal(game.coverOutcome,'win');assert.equal(game.forecastTiming,'late-entered-reconstruction');
 assert.equal(game.ratingCoverage,'both-rated');
});

test('unseen team receives an explicit low-confidence prior and mismatched current scores are rejected',()=>{
 const game=projectResearchGame(source('2',{away:{id:'NEW',name:'New'},lateMarketHomeSpread:null}),model,{home:{id:'H'},away:{id:'OTHER'},completed:true,homeScore:40,awayScore:0},'2026-09-27T00:00:00Z');
 assert.equal(game.modelHomeMargin,6.5);assert.equal(game.ratingCoverage,'one-prior');assert.equal(game.actualHomeScore,null);assert.equal(game.outcome,null);assert.equal(game.coverOutcome,null);
});

test('research summary reports denominators and robust error without mixing pending games',()=>{
 const games=[projectResearchGame(source('1'),model,{home:{id:'H'},away:{id:'A'},completed:true,homeScore:21,awayScore:14}),
  projectResearchGame(source('2'),model,{home:{id:'H'},away:{id:'A'},completed:true,homeScore:10,awayScore:20}),projectResearchGame(source('3'),model)];
 const summary=summarizeResearchGames(games);
 assert.equal(summary.evaluated,2);assert.equal(summary.winnerWins,1);assert.equal(summary.winnerLosses,1);assert.equal(summary.lateMarketCount,3);
 assert.equal(summary.mae,10);assert.equal(summary.medianAbsoluteError,10);
});

test('Sep 26 cohort accounts for every core event without duplicating saved pregame lines',()=>{
 assert.equal(cohort.coreDiscovered,116);assert.equal(cohort.boardGames,79);assert.equal(cohort.games.length,80);
 assert.equal(cohort.games.filter(game=>game.category==='no-market-on-board').length,33);
 assert.equal(cohort.games.filter(game=>game.category==='omitted-from-board').length,37);
 assert.equal(cohort.games.filter(game=>game.category==='priced-without-saved-forecast').length,10);
 assert.equal(cohort.savedBeforeKickoff,36);
 assert.equal(cohort.savedBeforeKickoff+cohort.games.length,cohort.coreDiscovered);
 assert.equal(new Set(cohort.games.map(game=>game.id)).size,80);
 assert.ok(cohort.games.every(game=>game.sourceUrl.endsWith(`event=${game.id}`)));
 assert.equal(cohort.model?.asOf,cohort.date);
 assert.equal(cohort.modelVersion,'cfb-weekly-tuned-2026-09-14');
});
